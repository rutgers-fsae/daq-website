import parameters from "./parameters.json";

export { parameters };
export type Parameter = (typeof parameters)[number];
export interface SerialPort {
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  getInfo(): { usbVendorId?: number; usbProductId?: number };
}
export const serial = (
  navigator as Navigator & {
    serial?: {
      getPorts(): Promise<SerialPort[]>;
      requestPort(): Promise<SerialPort>;
      addEventListener(type: string, listener: EventListener): void;
      removeEventListener(type: string, listener: EventListener): void;
    };
  }
).serial;
export type Settings = {
  base: number;
  bitrate: number;
  mode: "standard" | "extended" | "j1939";
  timeout: number;
  freshness: number;
  gap: number;
};
export const defaults: Settings = {
  base: 0xa0,
  bitrate: 500,
  mode: "standard",
  timeout: 2000,
  freshness: 1000,
  gap: 100,
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export const integer = (p: Parameter, word: number) =>
  p.signed && word >= 32768 ? word - 65536 : word;
export const display = (p: Parameter, word: number) =>
  String((integer(p, word) * p.multiplier) / p.scale);
export function validate(p: Parameter, word: number) {
  const value = integer(p, word);
  if (
    !Number.isInteger(word) ||
    word < 0 ||
    word > 65535 ||
    value < (p.minimum ?? (p.signed ? -32768 : 0)) ||
    value > (p.maximum ?? (p.signed ? 32767 : 65535)) ||
    (p.choices.length && !(p.choices as number[]).includes(value)) ||
    (p.address === 233 && value > 0 && value < 0x22) ||
    ([235, 236].includes(p.address) && value > 0 && value < 3)
  )
    throw new Error("Value is outside the documented limits.");
  return word;
}
export function parseValue(p: Parameter, text: string, raw: boolean) {
  if (
    !text.trim() ||
    text.length > 128 ||
    !(raw ? /^-?(?:0x[\da-f]+|\d+)$/i : /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/).test(
      text.trim(),
    )
  )
    throw new Error("Enter a valid number.");
  text = text.trim();
  let value: number;
  if (raw) value = /^-0x/i.test(text) ? -Number(text.slice(1)) : Number(text);
  else {
    const [whole, fraction = ""] = text.replace(/^[+-]/, "").split(".");
    const denominator =
      BigInt(10) ** BigInt(fraction.length) * BigInt(p.multiplier);
    const numerator =
      BigInt((whole || "0") + fraction) *
      BigInt(p.scale) *
      (text.startsWith("-") ? BigInt(-1) : BigInt(1));
    if (numerator % denominator !== BigInt(0))
      throw new Error(
        `Value must be an exact multiple of ${p.multiplier / p.scale}.`,
      );
    value = Number(numerator / denominator);
  }
  if (!Number.isInteger(value) || (value < 0 && (!p.signed || value < -32768)))
    throw new Error(
      `Value must be an exact multiple of ${p.multiplier / p.scale}.`,
    );
  return validate(p, value < 0 ? value + 65536 : value);
}
export function parseFrame(text: string) {
  if (!/^[tTxX]/.test(text)) return null;
  for (const width of text[0] === "t"
    ? [3]
    : /[xX]/.test(text[0])
      ? [8]
      : [3, 8]) {
    if (!/^[\da-f]+$/i.test(text.slice(1))) continue;
    const length = parseInt(text[width + 1], 16),
      end = width + 2 + length * 2;
    const id = parseInt(text.slice(1, width + 1), 16);
    if (
      length > 8 ||
      ![end, end + 4].includes(text.length) ||
      id > (width === 3 ? 0x7ff : 0x1fffffff)
    )
      continue;
    return {
      id,
      extended: width === 8,
      data: Uint8Array.from(
        text.slice(width + 2, end).match(/../g) ?? [],
        (x) => parseInt(x, 16),
      ),
    };
  }
  return null;
}
export class Candapter {
  enabled: boolean | null = null;
  statusAt = 0;
  tainted = false;
  private reader?: ReadableStreamDefaultReader<Uint8Array>;
  private writer?: WritableStreamDefaultWriter<Uint8Array>;
  private loop?: Promise<void>;
  private buffer = "";
  private tokens: number[] = [];
  private frames: NonNullable<ReturnType<typeof parseFrame>>[] = [];
  private failure = "";
  private busy = false;
  private closing = false;
  constructor(
    public port: SerialPort,
    public settings: Settings,
    private changed: () => void = () => {},
  ) {}
  identifier(relative: number) {
    const id = this.settings.base + relative;
    return this.settings.mode === "j1939" ? (0x0cff0001 | (id << 8)) >>> 0 : id;
  }
  feed(bytes: Uint8Array) {
    for (const byte of bytes) {
      if (byte === 10) continue;
      if (!this.buffer && (byte === 6 || byte === 7)) {
        this.tokens.push(byte);
        continue;
      }
      if (byte !== 13) {
        this.buffer += String.fromCharCode(byte);
        if (this.buffer.length > 128) this.buffer = "";
        continue;
      }
      if (!this.buffer) this.tokens.push(6);
      const frame = parseFrame(this.buffer);
      this.buffer = "";
      if (!frame) continue;
      if (
        frame.extended === (this.settings.mode !== "standard") &&
        frame.id === this.identifier(0x0a) &&
        frame.data.length === 8
      ) {
        this.enabled = Boolean(frame.data[6] & 1);
        this.statusAt = performance.now();
        this.changed();
      }
      this.frames.push(frame);
      if (this.frames.length > 256) this.frames.shift();
    }
  }
  private check() {
    if (this.failure) throw new Error(this.failure);
    if (this.tainted) throw new Error("Reconnect before further requests.");
  }
  private async send(text: string) {
    this.check();
    if (!this.writer) throw new Error("Not connected.");
    await this.writer.write(new TextEncoder().encode(text + "\r"));
  }
  private async command(text: string, allowBell = false) {
    this.tokens = [];
    await this.send(text);
    const deadline = performance.now() + this.settings.timeout;
    while (performance.now() < deadline) {
      this.check();
      if (this.tokens.length) {
        const rejected = this.tokens.includes(7);
        this.tokens = [];
        if (rejected && !allowBell)
          throw new Error(`CANdapter rejected ${text}.`);
        return;
      }
      await sleep(2);
    }
    throw new Error(`CANdapter did not acknowledge ${text}.`);
  }
  async open() {
    const s = this.settings;
    if (
      !Number.isInteger(s.base) ||
      s.base < 0 ||
      s.base >
        (s.mode === "j1939" ? 0xc0 : s.mode === "standard" ? 0x7c0 : 0xffc0) ||
      ![125, 250, 500, 1000].includes(s.bitrate) ||
      ![s.timeout, s.freshness, s.gap].every((x) => Number.isFinite(x) && x > 0)
    )
      throw new Error("Invalid connection settings.");
    await this.port.open({ baudRate: 115200 });
    try {
      if (!this.port.readable || !this.port.writable)
        throw new Error("Serial streams unavailable.");
      this.reader = this.port.readable.getReader();
      this.writer = this.port.writable.getWriter();
      this.loop = (async () => {
        try {
          while (!this.closing) {
            const { value, done } = await this.reader!.read();
            if (done) {
              if (!this.closing) throw new Error("USB disconnected.");
              break;
            }
            if (value) this.feed(value);
          }
        } catch (error) {
          this.failure = String(error);
          this.enabled = null;
          this.changed();
        } finally {
          this.reader?.releaseLock();
        }
      })();
      await this.command("C", true);
      await this.command(
        `S${({ 125: 4, 250: 5, 500: 6, 1000: 8 } as Record<number, number>)[s.bitrate]}`,
      );
      await this.command("O");
    } catch (error) {
      await this.close();
      throw error;
    }
  }
  async close() {
    try {
      if (this.writer && !this.failure && !this.tainted)
        await this.command("C", true);
    } catch {
      /* Release USB even when the adapter cannot acknowledge cleanup. */
    }
    this.closing = true;
    await this.reader?.cancel().catch(() => {});
    await this.loop;
    this.writer?.releaseLock();
    this.writer = undefined;
    await this.port.close();
    this.enabled = null;
    this.statusAt = 0;
  }
  disabled() {
    this.check();
    if (
      this.enabled !== false ||
      performance.now() - this.statusAt > this.settings.freshness
    )
      throw new Error(
        "Write blocked: inverter enabled, or disabled-state telemetry missing/stale.",
      );
  }
  private async transaction(address: number, word?: number) {
    this.check();
    const p = parameters.find((p) => p.address === address);
    if (!p) throw new Error("Undocumented address.");
    if (word !== undefined) validate(p, word);
    await sleep(this.settings.gap);
    this.check();
    this.frames = [];
    this.tokens = [];
    if (word !== undefined) this.disabled();
    const data = new Uint8Array(8);
    const view = new DataView(data.buffer);
    view.setUint16(0, address, true);
    data[2] = Number(word !== undefined);
    view.setUint16(4, word ?? 0, true);
    const extended = this.settings.mode !== "standard";
    const request = `${extended ? "X" : "T"}${this.identifier(0x21)
      .toString(16)
      .padStart(
        extended ? 8 : 3,
        "0",
      )}8${Array.from(data, (b) => b.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
    try {
      for (let attempt = 0; attempt < (word === undefined ? 3 : 1); attempt++) {
        await this.send(request);
        const deadline = performance.now() + this.settings.timeout;
        while (performance.now() < deadline) {
          this.check();
          if (this.tokens.includes(7)) {
            this.tokens = [];
            if (word !== undefined)
              throw new Error(
                "CANdapter rejected write; value may be unverified.",
              );
            await sleep(100);
            break;
          }
          this.tokens = [];
          for (const frame of this.frames.splice(0)) {
            if (
              frame.id !== this.identifier(0x22) ||
              frame.extended !== extended ||
              frame.data.length !== 8
            )
              continue;
            const result = new DataView(
                frame.data.buffer,
                frame.data.byteOffset,
                8,
              ),
              returned = result.getUint16(0, true);
            if (returned === 0)
              throw new Error("Parameter unsupported by this inverter.");
            if (returned !== address) continue;
            if (word !== undefined && frame.data[2] !== 1)
              throw new Error("Inverter rejected write.");
            return result.getUint16(4, true);
          }
          await sleep(2);
        }
      }
      throw new Error("Request timed out. Writes are never retried.");
    } catch (error) {
      if (
        !(
          error instanceof Error &&
          error.message === "Parameter unsupported by this inverter."
        )
      )
        this.tainted = true;
      throw error;
    }
  }
  private async exclusive<T>(operation: () => Promise<T>) {
    if (this.busy) throw new Error("Another operation is running.");
    this.busy = true;
    try {
      return await operation();
    } finally {
      this.busy = false;
    }
  }
  read(address: number) {
    return this.exclusive(() => this.transaction(address));
  }
  write(p: Parameter, baseline: number, desired: number) {
    return this.exclusive(async () => {
      validate(p, desired);
      if ((await this.transaction(p.address)) !== baseline)
        throw new Error("Conflict: EEPROM changed. Read and review again.");
      if ([113, 114, 115].includes(p.address)) {
        const values = [];
        for (const address of [115, 114, 113])
          values.push(
            integer(
              parameters.find((p) => p.address === address)!,
              address === p.address ? desired : await this.transaction(address),
            ),
          );
        if (!(values[0] < values[1] && values[1] < values[2]))
          throw new Error(
            "Full torque temperature must be below zero torque, below motor overtemperature.",
          );
      }
      if ([141, 144, 171].includes(p.address)) {
        const values: Record<number, number> = {};
        for (const address of [141, 144, 171])
          values[address] =
            address === p.address ? desired : await this.transaction(address);
        if (
          (values[171] && !values[144]) ||
          values[141] > (values[171] ? 0xc0 : values[144] ? 0xffc0 : 0x7c0)
        )
          throw new Error("Invalid resulting CAN identifier configuration.");
      }
      await this.transaction(p.address, desired);
      const actual = await this.transaction(p.address);
      if (actual !== desired) {
        this.tainted = true;
        throw new Error(
          "Write unverified: readback mismatch. Reconnect and read EEPROM.",
        );
      }
      return actual;
    });
  }
}
