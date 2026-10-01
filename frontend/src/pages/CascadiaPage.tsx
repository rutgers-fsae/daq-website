import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  FieldInput,
  FieldSelect,
  Panel,
} from "../components/ui";
import {
  Candapter,
  defaults,
  display,
  parameters,
  parseValue,
  serial,
} from "../cascadia/candapter";
import type { Parameter, SerialPort, Settings } from "../cascadia/candapter";

export function CascadiaPage() {
  const adapter = useRef<Candapter>();
  const [ports, setPorts] = useState<SerialPort[]>([]);
  const [portIndex, setPortIndex] = useState("0");
  const [settings, setSettings] = useState(defaults);
  const [base, setBase] = useState("0xA0");
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    "Connect, then read a parameter or read all.",
  );
  const [search, setSearch] = useState("");
  const [values, setValues] = useState<Record<number, number>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [edit, setEdit] = useState<{
    p: Parameter;
    baseline: number;
    text: string;
  } | null>(null);
  const [raw, setRaw] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [now, setNow] = useState(performance.now());
  const cancel = useRef(false);
  useEffect(() => {
    const api = serial;
    if (!api) return;
    const refresh = () => {
      void api
        .getPorts()
        .then(setPorts)
        .catch((error) => setMessage(String(error)));
    };
    refresh();
    api.addEventListener("connect", refresh);
    api.addEventListener("disconnect", refresh);
    const timer = setInterval(() => setNow(performance.now()), 250);
    return () => {
      clearInterval(timer);
      api.removeEventListener("connect", refresh);
      api.removeEventListener("disconnect", refresh);
      cancel.current = true;
      void adapter.current?.close().catch(() => {});
    };
  }, []);
  async function run(operation: () => Promise<void>) {
    setBusy(true);
    cancel.current = false;
    try {
      await operation();
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }
  async function connect(port: SerialPort) {
    const next = new Candapter(port, { ...settings, base: Number(base) });
    await next.open();
    adapter.current = next;
    setConnected(true);
    setValues({});
    setErrors({});
    setEdit(null);
    setMessage("Connected at 115200 baud. EEPROM has not been read.");
  }
  async function read(p: Parameter) {
    try {
      const value = await adapter.current!.read(p.address);
      setValues((old) => ({ ...old, [p.address]: value }));
      setErrors((old) => ({ ...old, [p.address]: "" }));
      return value;
    } catch (error) {
      setErrors((old) => ({ ...old, [p.address]: String(error) }));
      throw error;
    }
  }
  const status = adapter.current;
  const fresh =
    status?.enabled !== null &&
    status &&
    now - status.statusAt <= settings.freshness;
  const canWrite =
    connected && fresh && status?.enabled === false && !status.tainted;
  const rows = parameters.filter((p) =>
    `${p.address} ${p.name} ${p.alias}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <main className="grid gap-4">
      <Panel className="grid gap-4 p-4">
        <h1 className="text-xl font-semibold">Cascadia PM100DX EEPROM</h1>
        <p className="text-sm text-muted">
          USB connects to this computer. Use Chrome or Edge over HTTPS or
          localhost. Close other applications using the CANdapter. Only one CAN
          node should issue parameter requests.
        </p>
        {!serial && (
          <Alert tone="warning">
            Web Serial is unavailable. Open this page in a supported browser
            over HTTPS or localhost.
          </Alert>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <Button
            disabled={!serial || busy || connected}
            onClick={() =>
              void run(async () => {
                setPorts(await serial!.getPorts());
                setMessage(
                  "Checked previously authorized USB serial ports. Use Choose USB port for a new device.",
                );
              })
            }
          >
            Check USB ports
          </Button>
          <label className="grid gap-1 text-sm">
            Authorized port
            <FieldSelect
              value={portIndex}
              onChange={(e) => setPortIndex(e.target.value)}
              disabled={connected || busy}
            >
              {ports.length === 0 && <option>No authorized ports</option>}
              {ports.map((port, i) => {
                const info = port.getInfo();
                return (
                  <option key={i} value={i}>
                    Port {i + 1} · USB {info.usbVendorId?.toString(16) ?? "?"}:
                    {info.usbProductId?.toString(16) ?? "?"}
                  </option>
                );
              })}
            </FieldSelect>
          </label>
          <Button
            disabled={!serial || connected || busy || !ports[Number(portIndex)]}
            onClick={() => void run(() => connect(ports[Number(portIndex)]))}
          >
            Connect
          </Button>
          <Button
            disabled={!serial || connected || busy}
            onClick={() =>
              void run(async () => {
                const port = await serial!.requestPort();
                setPorts(await serial!.getPorts());
                await connect(port);
              })
            }
          >
            Choose USB port & connect
          </Button>
          <Button
            disabled={!connected || busy}
            onClick={() =>
              void run(async () => {
                await adapter.current!.close();
                adapter.current = undefined;
                setConnected(false);
                setValues({});
                setEdit(null);
                setMessage("Disconnected.");
              })
            }
          >
            Disconnect
          </Button>
        </div>
        <div className="flex flex-wrap gap-3">
          <label className="grid gap-1 text-sm">
            CAN base
            <FieldInput
              value={base}
              disabled={connected || busy}
              onChange={(e) => setBase(e.target.value)}
            />
          </label>
          <label className="grid gap-1 text-sm">
            CAN bitrate
            <FieldSelect
              value={settings.bitrate}
              disabled={connected || busy}
              onChange={(e) =>
                setSettings({ ...settings, bitrate: Number(e.target.value) })
              }
            >
              {[125, 250, 500, 1000].map((x) => (
                <option key={x} value={x}>
                  {x} kbit/s
                </option>
              ))}
            </FieldSelect>
          </label>
          <label className="grid gap-1 text-sm">
            Identifiers
            <FieldSelect
              value={settings.mode}
              disabled={connected || busy}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  mode: e.target.value as Settings["mode"],
                })
              }
            >
              {["standard", "extended", "j1939"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </FieldSelect>
          </label>
          {(["timeout", "freshness", "gap"] as const).map((key) => (
            <label className="grid gap-1 text-sm" key={key}>
              {key === "gap"
                ? "Request gap"
                : key === "freshness"
                  ? "Telemetry freshness"
                  : "Reply timeout"}{" "}
              (ms)
              <FieldInput
                type="number"
                min="1"
                value={settings[key]}
                disabled={connected || busy}
                onChange={(e) =>
                  setSettings({ ...settings, [key]: Number(e.target.value) })
                }
              />
            </label>
          ))}
        </div>
        <p role="status" className="text-sm">
          {connected ? "Connected" : "Disconnected"} · Inverter:{" "}
          {!fresh
            ? "unknown / stale"
            : status?.enabled
              ? "enabled"
              : "disabled"}
          {status?.tainted ? " · Reconnect required" : ""}
        </p>
        <Alert>{message}</Alert>
      </Panel>
      {edit && (
        <Panel className="grid gap-3 p-4">
          <h2 className="font-semibold">
            Review {edit.p.address}: {edit.p.name}
          </h2>
          <p>
            Observed: {display(edit.p, edit.baseline)} {edit.p.unit} · raw{" "}
            {edit.baseline}
          </p>
          <p className="text-sm text-muted">
            {edit.p.immediate
              ? "Takes effect immediately."
              : "Requires an operator-performed power cycle."}{" "}
            {edit.p.communication
              ? "This change can interrupt communication; verification may fail."
              : ""}{" "}
            {edit.p.address === 150
              ? "Motor parameter changes may reset flux and gamma; reread before further edits."
              : ""}
          </p>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={raw}
              disabled={busy}
              onChange={(e) => {
                setRaw(e.target.checked);
                setEdit({
                  ...edit,
                  text: e.target.checked
                    ? String(edit.baseline)
                    : display(edit.p, edit.baseline),
                });
                setConfirmation("");
              }}
            />
            Raw word
          </label>
          <label className="grid gap-1">
            New value {raw ? "(decimal or hex)" : edit.p.unit}
            <FieldInput
              value={edit.text}
              disabled={busy}
              onChange={(e) => {
                setEdit({ ...edit, text: e.target.value });
                setConfirmation("");
              }}
            />
          </label>
          <label className="grid gap-1">
            Type WRITE to apply this value
            <FieldInput
              value={confirmation}
              disabled={busy}
              onChange={(e) => setConfirmation(e.target.value)}
            />
          </label>
          <div className="flex gap-2">
            <Button
              variant="danger"
              disabled={busy || !canWrite || confirmation !== "WRITE"}
              onClick={() =>
                void run(async () => {
                  const desired = parseValue(edit.p, edit.text, raw);
                  if (desired === edit.baseline)
                    throw new Error("Value is unchanged.");
                  setMessage(`Writing ${edit.p.name}…`);
                  try {
                    const actual = await adapter.current!.write(
                      edit.p,
                      edit.baseline,
                      desired,
                    );
                    setValues((old) =>
                      edit.p.address === 150
                        ? { [150]: actual }
                        : { ...old, [edit.p.address]: actual },
                    );
                    setErrors((old) => ({ ...old, [edit.p.address]: "" }));
                    setEdit(null);
                    setMessage(
                      `Write verified: ${display(edit.p, actual)} ${edit.p.unit}. ${edit.p.immediate ? "Effective immediately." : "Power cycle required."}`,
                    );
                  } catch (error) {
                    setErrors((old) => ({
                      ...old,
                      [edit.p.address]: `Write not verified: ${String(error)}`,
                    }));
                    setConfirmation("");
                    throw error;
                  }
                })
              }
            >
              Write & verify
            </Button>
            <Button disabled={busy} onClick={() => setEdit(null)}>
              Cancel edit
            </Button>
          </div>
          {!canWrite && (
            <p className="text-sm text-muted">
              Writes require fresh inverter-disabled telemetry and a healthy
              connection.
            </p>
          )}
        </Panel>
      )}
      <Panel className="grid gap-3 overflow-hidden p-4">
        <div className="flex flex-wrap gap-3">
          <FieldInput
            aria-label="Search parameters"
            placeholder="Search address or name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button
            disabled={!connected || busy || status?.tainted}
            onClick={() =>
              void run(async () => {
                for (const [i, p] of parameters.entries()) {
                  if (cancel.current) {
                    setMessage("Read cancelled.");
                    return;
                  }
                  setMessage(
                    `Reading ${i + 1}/${parameters.length}: ${p.name}`,
                  );
                  try {
                    await read(p);
                  } catch (error) {
                    if (String(error).includes("unsupported")) continue;
                    throw error;
                  }
                }
                setMessage("Read all complete.");
              })
            }
          >
            Read all EEPROM
          </Button>
          {busy && (
            <Button
              onClick={() => {
                cancel.current = true;
              }}
            >
              Stop after current request
            </Button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="p-2">Address / parameter</th>
                <th className="p-2">Observed EEPROM</th>
                <th className="p-2">Effect</th>
                <th className="p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.address} className="border-b border-border">
                  <td className="p-2">
                    <span className="font-medium">
                      {p.address} · {p.name}
                    </span>
                    <p className="text-xs text-muted">{p.restriction}</p>
                  </td>
                  <td className="p-2">
                    {values[p.address] === undefined
                      ? "Not read"
                      : `${display(p, values[p.address])} ${p.unit} (raw ${values[p.address]})`}
                    {errors[p.address] && (
                      <p className="text-[var(--danger)]">
                        {errors[p.address]}
                      </p>
                    )}
                  </td>
                  <td className="p-2">
                    {p.immediate ? "Immediate" : "Power cycle"}
                  </td>
                  <td className="p-2">
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={!connected || busy || status?.tainted}
                        onClick={() =>
                          void run(async () => {
                            await read(p);
                            setMessage(`Read ${p.name}.`);
                          })
                        }
                      >
                        Read
                      </Button>
                      <Button
                        size="sm"
                        disabled={
                          !connected ||
                          busy ||
                          values[p.address] === undefined ||
                          Boolean(errors[p.address]) ||
                          status?.tainted
                        }
                        onClick={() => {
                          setRaw(false);
                          setConfirmation("");
                          setEdit({
                            p,
                            baseline: values[p.address],
                            text: display(p, values[p.address]),
                          });
                        }}
                      >
                        Edit
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </main>
  );
}
