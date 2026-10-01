import { describe, expect, it } from "vitest";
import {
  Candapter,
  defaults,
  display,
  parameters,
  parseFrame,
  parseValue,
} from "./candapter";
import type { SerialPort } from "./candapter";

const parameter = (address: number) =>
  parameters.find((p) => p.address === address)!;
function fakeAdapter(
  options: {
    enabled?: boolean;
    conflict?: boolean;
    mismatch?: boolean;
    dropWrite?: boolean;
  } = {},
) {
  let input: ReadableStreamDefaultController<Uint8Array>;
  const commands: string[] = [];
  let word = 1500;
  const port: SerialPort = {
    readable: new ReadableStream({
      start(controller) {
        input = controller;
      },
    }),
    writable: new WritableStream({
      write(bytes) {
        const command = new TextDecoder().decode(bytes).trim();
        commands.push(command);
        const emit = (text: string) =>
          input.enqueue(new TextEncoder().encode(text));
        if (!command.startsWith("T")) {
          emit("\r");
          return;
        }
        const frame = parseFrame(command)!;
        const write = frame.data[2] === 1;
        if (write) word = frame.data[4] | (frame.data[5] << 8);
        if (write && options.dropWrite) return;
        const returned =
          options.conflict && !write
            ? 1600
            : options.mismatch &&
                !write &&
                commands.some(
                  (c) => c.startsWith("T") && parseFrame(c)!.data[2] === 1,
                )
              ? word + 1
              : word;
        const data = [...frame.data];
        data[2] = write ? 1 : 0;
        data[4] = returned & 255;
        data[5] = returned >> 8;
        const reply =
          "t0C28" +
          data.map((b) => b.toString(16).padStart(2, "0")).join("") +
          "\r";
        emit(reply.slice(0, 7));
        emit(reply.slice(7));
        if (options.enabled !== undefined)
          emit(`t0AA8000000000000${options.enabled ? "01" : "00"}00\r`);
      },
    }),
    async open() {},
    async close() {},
    getInfo() {
      return {};
    },
  };
  const adapter = new Candapter(port, { ...defaults, gap: 1, timeout: 25 });
  return { adapter, commands };
}

describe("CANdapter EEPROM", () => {
  it("uses the firmware catalog and exact engineering scaling", () => {
    expect(parameters).toHaveLength(85);
    expect(parseValue(parameter(152), "-98.4", false)).toBe(64552);
    expect(display(parameter(152), 64552)).toBe("-98.4");
    expect(parseValue(parameter(129), "150", false)).toBe(1500);
    expect(parseValue(parameter(152), "0xFC28", true)).toBe(64552);
    expect(() =>
      parseValue(parameter(129), "150.00000000001", false),
    ).toThrow();
    expect(() => parseValue(parameter(235), "2", false)).toThrow();
    expect(() => parseValue(parameter(132), "2", true)).toThrow();
    expect(parseFrame("T000000C280000000000000000")).toMatchObject({
      id: 0xc2,
      extended: true,
    });
    expect(parseFrame("tFFF80000000000000000")).toBeNull();
  });
  it("initializes, reads fragmented replies, writes and independently verifies", async () => {
    const { adapter, commands } = fakeAdapter({ enabled: false });
    await adapter.open();
    expect(commands.slice(0, 3)).toEqual(["C", "S6", "O"]);
    expect(await adapter.read(129)).toBe(1500);
    expect(await adapter.write(parameter(129), 1500, 1600)).toBe(1600);
    expect(
      commands.filter((c) => c.startsWith("T") && parseFrame(c)!.data[2] === 1),
    ).toHaveLength(1);
    await adapter.close();
  });
  it("blocks enabled, missing, stale telemetry and conflicts before sending writes", async () => {
    for (const options of [
      { enabled: true },
      {},
      { enabled: false, conflict: true },
    ]) {
      const { adapter, commands } = fakeAdapter(options);
      await adapter.open();
      await expect(adapter.write(parameter(129), 1500, 1600)).rejects.toThrow();
      expect(
        commands.some((c) => c.startsWith("T") && parseFrame(c)!.data[2] === 1),
      ).toBe(false);
      await adapter.close();
    }
    const { adapter } = fakeAdapter();
    adapter.enabled = false;
    adapter.statusAt = performance.now() - 2000;
    expect(() => adapter.disabled()).toThrow();
  });
  it("does not retry uncertain writes and requires reconnect after timeout or mismatch", async () => {
    for (const options of [
      { enabled: false, dropWrite: true },
      { enabled: false, mismatch: true },
    ]) {
      const { adapter, commands } = fakeAdapter(options);
      await adapter.open();
      await expect(adapter.write(parameter(129), 1500, 1600)).rejects.toThrow();
      expect(
        commands.filter(
          (c) => c.startsWith("T") && parseFrame(c)!.data[2] === 1,
        ),
      ).toHaveLength(1);
      expect(adapter.tainted).toBe(true);
      await expect(adapter.read(129)).rejects.toThrow("Reconnect");
      await adapter.close();
    }
  });
});
