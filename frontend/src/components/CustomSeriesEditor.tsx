import { useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Pencil, X } from "lucide-react";
import { Button, Eyebrow, FieldInput, Label } from "./ui";
import type { ComputedColumn } from "../types/chart";
import type { SchemaColumn } from "../types/dataset";

type Props = {
  columns: SchemaColumn[];
  computed: ComputedColumn[];
  onSave: (item: ComputedColumn, previousName?: string) => void;
  onRemove: (name: string) => void;
};

const emptyDraft = { name: "", expression: "", unit: "" };
const bareName = /^[A-Za-z_]\w*$/;

// The column name being typed at the cursor: either after an open backtick
// or the trailing identifier.
function tokenAt(text: string, cursor: number) {
  const before = text.slice(0, cursor);
  const tick = before.lastIndexOf("`");
  if (tick !== -1 && (before.slice(0, tick).split("`").length - 1) % 2 === 0) {
    return { start: tick, query: before.slice(tick + 1), quoted: true };
  }
  const match = /[A-Za-z_][\w.]*$/.exec(before);
  return match ? { start: match.index, query: match[0], quoted: false } : null;
}

export function CustomSeriesEditor({
  columns,
  computed,
  onSave,
  onRemove,
}: Props) {
  const [draft, setDraft] = useState(emptyDraft);
  const [editing, setEditing] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(0);
  const expressionRef = useRef<HTMLInputElement>(null);

  const name = draft.name.trim();
  const error = !draft.expression.trim()
    ? "Enter an expression."
    : !name
      ? "Enter a name."
      : columns.some((column) => column.name === name) ||
          computed.some((item) => item.name === name && item.name !== editing)
        ? `"${name}" is already a column name.`
        : null;

  const token = tokenAt(draft.expression, cursor);
  const suggestions =
    token && !dismissed && (token.quoted || token.query)
      ? columns
          .filter(
            (column) =>
              column.type === "numeric" &&
              column.name.toLowerCase().includes(token.query.toLowerCase()),
          )
          .sort(
            (a, b) =>
              Number(
                !a.name.toLowerCase().startsWith(token.query.toLowerCase()),
              ) -
              Number(
                !b.name.toLowerCase().startsWith(token.query.toLowerCase()),
              ),
          )
          .slice(0, 8)
      : [];
  const selected = Math.min(active, suggestions.length - 1);

  function accept(column: SchemaColumn) {
    if (!token) return;
    const wrapped =
      bareName.test(column.name) && !["abs", "sqrt"].includes(column.name)
        ? column.name
        : `\`${column.name}\``;
    const text = draft.expression;
    const rest = text.slice(cursor);
    const next =
      text.slice(0, token.start) +
      wrapped +
      (token.quoted && rest.startsWith("`") ? rest.slice(1) : rest);
    const position = token.start + wrapped.length;
    setDraft({ ...draft, expression: next });
    setCursor(position);
    setActive(0);
    requestAnimationFrame(() => {
      expressionRef.current?.focus();
      expressionRef.current?.setSelectionRange(position, position);
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape" && suggestions.length) {
      event.preventDefault();
      setDismissed(true);
    } else if (suggestions.length && event.key === "ArrowDown") {
      event.preventDefault();
      setActive((selected + 1) % suggestions.length);
    } else if (suggestions.length && event.key === "ArrowUp") {
      event.preventDefault();
      setActive((selected - 1 + suggestions.length) % suggestions.length);
    } else if (
      suggestions.length &&
      (event.key === "Enter" || event.key === "Tab")
    ) {
      event.preventDefault();
      accept(suggestions[selected]);
    }
  }

  function reset() {
    setDraft(emptyDraft);
    setEditing(null);
    setCursor(0);
  }

  function save() {
    if (error) return;
    onSave(
      {
        name,
        expression: draft.expression.trim(),
        ...(draft.unit.trim() ? { unit: draft.unit.trim() } : {}),
      },
      editing ?? undefined,
    );
    reset();
  }

  function edit(item: ComputedColumn) {
    setDraft({
      name: item.name,
      expression: item.expression,
      unit: item.unit || "",
    });
    setEditing(item.name);
    setCursor(item.expression.length);
    setDismissed(true);
  }

  const fieldClass = "w-full min-w-0";

  return (
    <div className="grid gap-3 border-t-2 border-accent-line pt-4">
      <Eyebrow className="text-text">Custom Series</Eyebrow>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,6rem)] gap-2">
        <Label className="grid min-w-0 gap-1">
          Name
          <FieldInput
            className={fieldClass}
            value={draft.name}
            onChange={(event) =>
              setDraft({ ...draft, name: event.target.value })
            }
            placeholder="Power"
            aria-label="Custom series name"
          />
        </Label>
        <Label className="grid min-w-0 gap-1">
          Unit
          <FieldInput
            className={fieldClass}
            value={draft.unit}
            onChange={(event) =>
              setDraft({ ...draft, unit: event.target.value })
            }
            placeholder="W"
            aria-label="Custom series unit"
          />
        </Label>
        <Label className="relative col-span-2 grid min-w-0 gap-1">
          Expression
          <FieldInput
            ref={expressionRef}
            className={fieldClass}
            value={draft.expression}
            onChange={(event) => {
              setDraft({ ...draft, expression: event.target.value });
              setCursor(
                event.target.selectionStart ?? event.target.value.length,
              );
              setDismissed(false);
              setActive(0);
            }}
            onSelect={(event) =>
              setCursor(event.currentTarget.selectionStart ?? 0)
            }
            onKeyDown={onKeyDown}
            onBlur={() => setDismissed(true)}
            onFocus={() => setDismissed(false)}
            placeholder="Current * Voltage"
            aria-label="Custom series expression"
            role="combobox"
            aria-expanded={suggestions.length > 0}
            aria-autocomplete="list"
            autoComplete="off"
          />
          {suggestions.length > 0 && (
            <ul
              role="listbox"
              aria-label="Matching channels"
              className="absolute left-0 right-0 top-full z-20 mt-1 max-h-48 overflow-auto rounded-md border border-border bg-panel p-1 text-sm font-normal normal-case tracking-normal text-text"
            >
              {suggestions.map((column, index) => (
                <li
                  key={column.name}
                  role="option"
                  aria-selected={index === selected}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    accept(column);
                  }}
                  className={`cursor-pointer truncate rounded px-2 py-1 ${index === selected ? "bg-text text-surface" : ""}`}
                >
                  {column.name}
                  {column.unit ? (
                    <span className="text-muted"> ({column.unit})</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Label>
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 text-xs text-muted">
          Use + - * / abs() sqrt() on numeric columns, in their original units.
        </p>
        <div className="flex shrink-0 gap-2">
          {editing && (
            <Button type="button" size="sm" variant="ghost" onClick={reset}>
              Cancel
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={Boolean(error)}
            title={error || undefined}
            onClick={save}
          >
            {editing ? "Save" : "Add"}
          </Button>
        </div>
      </div>
      {computed.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {computed.map((item) => (
            <span
              key={item.name}
              className={`inline-flex items-center rounded-md border bg-input text-xs font-medium text-text shadow-sm ${editing === item.name ? "border-button" : "border-input-border"}`}
            >
              <button
                type="button"
                onClick={() => edit(item)}
                className="inline-flex items-center gap-1 rounded-l-md px-2 py-1 transition hover:bg-surface"
                title="Edit custom series"
              >
                <Pencil size={11} aria-hidden="true" />
                {item.name} = {item.expression}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (editing === item.name) reset();
                  onRemove(item.name);
                }}
                className="rounded-r-md px-1.5 py-1 transition hover:bg-surface"
                aria-label={`Remove ${item.name}`}
                title="Remove custom series"
              >
                <X size={12} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
