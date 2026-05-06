import { useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  createTaskResult,
  deleteTaskResult,
  fetchTasks,
  fetchTaskResults,
  updateTaskResult,
  type TaskResultDef,
} from "./lib/api.ts";
import { Btn } from "./components/Buttons.tsx";
import { Icon } from "./components/Icon.tsx";

export const ResultTypesManager = () => {
  const qc = useQueryClient();
  const types = useQuery({
    queryKey: ["taskResults"],
    queryFn: fetchTaskResults,
  });
  const tasks = useQuery({ queryKey: ["tasks"], queryFn: fetchTasks });
  const [adding, setAdding] = useState(false);

  const refsByType = new Map<string, number>();
  for (const t of tasks.data ?? []) {
    if (t.resultTypeId) {
      refsByType.set(t.resultTypeId, (refsByType.get(t.resultTypeId) ?? 0) + 1);
    }
  }

  return (
    <main
      data-testid="result-types-manager"
      className="paper-grain mx-auto min-h-screen max-w-md px-5 py-6"
    >
      <Link
        to="/"
        className="cap inline-flex items-center gap-1 text-ink-3 hover:text-ink"
      >
        <Icon name="chevron-left" size={14} /> Back
      </Link>
      <h1 className="mt-3 font-display text-2xl">Result types</h1>
      <p className="mt-1 font-serif text-sm text-ink-2">
        Reusable numeric shapes for task results — pushups, grams of cat
        food, rating stars. Tasks pick one optionally; the slider in the
        Done sheet adapts to the type's range and step.
      </p>

      <section className="mt-6">
        {types.isLoading && <p className="cap py-2">Loading…</p>}
        {types.data?.map((t) => (
          <ResultRow
            key={t.id}
            result={t}
            referenceCount={refsByType.get(t.id) ?? 0}
            onChanged={() =>
              qc.invalidateQueries({ queryKey: ["taskResults"] })
            }
          />
        ))}
        {adding ? (
          <ResultEditor
            onCancel={() => setAdding(false)}
            onSubmit={async (input) => {
              await createTaskResult(input);
              setAdding(false);
              qc.invalidateQueries({ queryKey: ["taskResults"] });
            }}
          />
        ) : (
          <Btn
            variant="outline"
            size="pillSm"
            className="mt-4"
            onClick={() => setAdding(true)}
          >
            + Add result type
          </Btn>
        )}
      </section>
    </main>
  );
};

const fmtRange = (r: TaskResultDef): string => {
  const min = r.minValue ?? "−∞";
  const max = r.maxValue ?? "∞";
  return `${min}…${max}, step ${r.step}`;
};

const ResultRow = ({
  result,
  referenceCount,
  onChanged,
}: {
  result: TaskResultDef;
  referenceCount: number;
  onChanged: () => void;
}) => {
  const [editing, setEditing] = useState(false);

  const remove = useMutation({
    mutationFn: () => deleteTaskResult(result.id),
    onSuccess: onChanged,
  });

  const onDelete = () => {
    const msg =
      referenceCount > 0
        ? `${result.displayName} is used by ${referenceCount} task${referenceCount === 1 ? "" : "s"}. Delete anyway? (Tasks keep the FK; new acks behave as if no result type were set; history still shows the unit "${result.unitName}".)`
        : `Delete "${result.displayName}"?`;
    if (confirm(msg)) remove.mutate();
  };

  if (editing) {
    return (
      <ResultEditor
        initial={result}
        onCancel={() => setEditing(false)}
        onSubmit={async (input) => {
          await updateTaskResult(result.id, input);
          setEditing(false);
          onChanged();
        }}
      />
    );
  }

  return (
    <div className="flex items-center justify-between border-t border-line-soft py-3">
      <div className="min-w-0">
        <div className="text-[15px] font-medium">
          {result.displayName}
          <span className="ml-1 font-mono text-xs text-ink-3">
            {result.unitName}
          </span>
        </div>
        <div className="cap mt-0.5">
          {fmtRange(result)}
          {result.useLastValue && " · prefills last value"}
          {result.system && " · system"}
          {referenceCount > 0 &&
            ` · used by ${referenceCount} task${referenceCount === 1 ? "" : "s"}`}
        </div>
      </div>
      <div className="flex gap-1">
        {!result.system && (
          <Btn variant="ghost" size="pillSm" onClick={() => setEditing(true)}>
            Edit
          </Btn>
        )}
        {!result.system && (
          <Btn
            variant="danger"
            size="pillSm"
            onClick={onDelete}
            disabled={remove.isPending}
          >
            Delete
          </Btn>
        )}
      </div>
    </div>
  );
};

interface EditorInput {
  displayName: string;
  unitName: string;
  minValue: number | null;
  maxValue: number | null;
  step: number;
  defaultValue: number | null;
  useLastValue: boolean;
}

const ResultEditor = ({
  initial,
  onCancel,
  onSubmit,
}: {
  initial?: TaskResultDef;
  onCancel: () => void;
  onSubmit: (i: EditorInput) => Promise<void>;
}) => {
  const [displayName, setDisplayName] = useState(initial?.displayName ?? "");
  const [unitName, setUnitName] = useState(initial?.unitName ?? "");
  const [minValue, setMinValue] = useState<string>(
    initial?.minValue?.toString() ?? "0",
  );
  const [maxValue, setMaxValue] = useState<string>(
    initial?.maxValue?.toString() ?? "",
  );
  const [step, setStep] = useState<string>(initial?.step.toString() ?? "1");
  const [useLastValue, setUseLastValue] = useState(
    initial?.useLastValue ?? true,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!displayName.trim() || !unitName.trim()) {
      setError("display name and unit name required");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        displayName: displayName.trim(),
        unitName: unitName.trim(),
        minValue: minValue.trim() === "" ? null : Number(minValue),
        maxValue: maxValue.trim() === "" ? null : Number(maxValue),
        step: Number(step) || 1,
        defaultValue: null,
        useLastValue,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 rounded-lg border border-line bg-paper-2 p-3">
      <h3 className="cap mb-2">{initial ? "Edit type" : "New type"}</h3>
      <div className="grid grid-cols-2 gap-2">
        <Field
          label="Display name"
          value={displayName}
          onChange={setDisplayName}
          placeholder="Pushups"
        />
        <Field
          label="Unit"
          value={unitName}
          onChange={setUnitName}
          placeholder="times"
        />
        <Field label="Min" value={minValue} onChange={setMinValue} type="number" />
        <Field label="Max" value={maxValue} onChange={setMaxValue} type="number" placeholder="(open)" />
        <Field label="Step" value={step} onChange={setStep} type="number" />
        <label className="mt-5 flex items-center gap-2 text-xs text-ink-2">
          <input
            type="checkbox"
            checked={useLastValue}
            onChange={(e) => setUseLastValue(e.target.checked)}
          />
          Pre-fill last value
        </label>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Btn variant="ghost" size="pillSm" onClick={onCancel} disabled={busy}>
          Cancel
        </Btn>
        <Btn variant="sage" size="pillSm" onClick={submit} disabled={busy}>
          {busy ? "…" : "Save"}
        </Btn>
      </div>
      {error && <p className="error mt-2">{error}</p>}
    </div>
  );
};

const Field = ({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) => (
  <label className="block text-xs">
    <span className="cap mb-1 block">{label}</span>
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-md border border-line bg-paper px-2 py-1.5 text-sm focus:border-ink focus:outline-none"
    />
  </label>
);
