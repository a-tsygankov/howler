import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  fetchLabels,
  fetchTask,
  fetchTaskExecutions,
  fetchTaskResults,
  fetchUsers,
} from "./lib/api.ts";
import { Btn } from "./components/Buttons.tsx";
import { HowlerAvatar } from "./components/HowlerAvatar.tsx";
import { Sparkline } from "./components/Sparkline.tsx";
import { Icon } from "./components/Icon.tsx";
import {
  completeTask,
  isParked,
  queuedForTask,
  type QueuedExecution,
} from "./lib/executionQueue.ts";

const fmtTs = (sec: number): string => {
  const d = new Date(sec * 1000);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
};

export const TaskDetail = () => {
  const { taskId = "" } = useParams<{ taskId: string }>();

  const taskQ = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => fetchTask(taskId),
    enabled: !!taskId,
  });
  const execsQ = useQuery({
    queryKey: ["executions", taskId],
    queryFn: () => fetchTaskExecutions(taskId, 30),
    enabled: !!taskId,
  });
  const labelsQ = useQuery({ queryKey: ["labels"], queryFn: fetchLabels });
  const taskResultsQ = useQuery({
    queryKey: ["taskResults"],
    queryFn: fetchTaskResults,
  });
  const usersQ = useQuery({ queryKey: ["users"], queryFn: fetchUsers });

  if (taskQ.isLoading) {
    return <div className="px-5 py-10 text-center text-ink-3">Loading…</div>;
  }
  if (!taskQ.data) {
    return (
      <main className="paper-grain mx-auto min-h-screen max-w-md lg:max-w-2xl px-5 py-10">
        <Link to="/" className="cap inline-flex items-center gap-1 text-ink-3">
          <Icon name="chevron-left" size={14} /> Back
        </Link>
        <p className="mt-6 font-serif text-lg">Task not found.</p>
      </main>
    );
  }

  const task = taskQ.data;
  const label = labelsQ.data?.find((l) => l.id === task.labelId);
  const result = taskResultsQ.data?.find((r) => r.id === task.resultTypeId);
  const heroTint = label?.color ?? "#6E6557";

  // Inline mark-done. The dashboard's CompleteTaskSheet is the
  // richer flow (slider + user picker); from history we go for a
  // one-tap confirm that pre-fills sensible defaults — same code
  // path, just less interactive surface. Notes + value remain
  // editable inline when relevant.

  const executions = execsQ.data ?? [];
  const userById = new Map((usersQ.data ?? []).map((u) => [u.id, u]));
  // Local queue: events the user has marked done but haven't
  // synced yet. Surfaced inline at the top of History so the user
  // sees their action took effect immediately.
  const queued = queuedForTask(taskId);
  // Filter out queued items that have already synced (server has
  // them) — INSERT OR IGNORE keeps server idempotent so the queue
  // and server lists overlap briefly mid-sync; dedupe by id.
  const serverIds = new Set(executions.map((e) => e.id));
  const pendingQueue = queued.filter((q) => !serverIds.has(q.id));

  return (
    <main
      data-testid="task-detail"
      className="paper-grain mx-auto min-h-screen max-w-md lg:max-w-2xl"
    >
      <header
        className="relative px-5 pb-5 pt-6"
        style={{
          background: `linear-gradient(180deg, ${heroTint}1f 0%, transparent 100%)`,
        }}
      >
        <Link
          to="/"
          className="cap inline-flex items-center gap-1 text-ink-3 hover:text-ink"
        >
          <Icon name="chevron-left" size={14} /> Back
        </Link>
        <div className="mt-3 flex items-center gap-3">
          <HowlerAvatar
            avatarId={task.avatarId}
            seed={task.id}
            initials={task.title.slice(0, 2).toUpperCase()}
            size={48}
          />
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-2xl">{task.title}</h1>
            <p className="cap mt-0.5">
              {task.kind === "DAILY"
                ? "daily"
                : task.kind === "PERIODIC"
                  ? "every N days"
                  : "one-time"}
              {label && ` · ${label.displayName}`}
              {result && ` · ${result.displayName}`}
              {task.isPrivate && " · private"}
            </p>
          </div>
          <CompleteFromHistory
            taskId={task.id}
            taskTitle={task.title}
            resultUnit={result?.unitName ?? null}
            resultLabel={result?.displayName ?? null}
          />
        </div>
        {task.description && (
          <p className="mt-3 font-serif text-base text-ink-2">
            {task.description}
          </p>
        )}
      </header>

      {result && (
        <section className="border-t border-line-soft px-5 py-4">
          <h2 className="cap mb-2">
            Last {executions.length} {result.displayName} ({result.unitName})
          </h2>
          <div className="text-ink">
            <Sparkline
              points={executions.map((e) => ({ ts: e.ts, value: e.resultValue }))}
              width={340}
              height={56}
            />
          </div>
        </section>
      )}

      <section className="border-t border-line-soft px-5 py-4">
        <h2 className="cap mb-2">History</h2>
        {pendingQueue.map((q) => (
          <PendingExecutionRow key={q.id} ev={q} />
        ))}
        {execsQ.isLoading && <p className="cap py-2">Loading…</p>}
        {!execsQ.isLoading &&
          executions.length === 0 &&
          pendingQueue.length === 0 && (
            <p className="cap py-2">No executions yet.</p>
          )}
        {executions.map((e) => {
          const u = e.userId ? userById.get(e.userId) : undefined;
          const initials = (u?.displayName ?? "?")
            .slice(0, 2)
            .toUpperCase();
          return (
            <div
              key={e.id}
              className="flex items-start gap-3 border-t border-line-soft py-2.5"
            >
              {/* Pass avatarId + bgColor so an execution attributed
                  to a user with a custom avatar (icon preset OR
                  uploaded photo) renders that avatar instead of the
                  generic seed-derived swatch. The legacy
                  initials+seed fallback still kicks in for the
                  unattributed-execution case (`e.userId` null —
                  e.g. device acks before pairing the actor) and
                  for users who never picked an avatar. */}
              <HowlerAvatar
                avatarId={u?.avatarId ?? null}
                seed={u?.id ?? e.id}
                initials={initials}
                size={28}
                backgroundColor={u?.bgColor ?? undefined}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm">
                    {e.resultValue !== null
                      ? `${e.resultValue} ${e.resultUnit ?? ""}`.trim()
                      : "✓"}
                  </span>
                  <span className="cap shrink-0">{fmtTs(e.ts)}</span>
                </div>
                {/* User attribution line — small caption naming who
                    completed the task. Suppressed when the row has
                    no userId (anonymous device ack) so the column
                    doesn't show "Unknown" entries. */}
                {u?.displayName && (
                  <p className="cap mt-0.5">{u.displayName}</p>
                )}
                {e.notes && (
                  <p className="mt-0.5 text-xs italic text-ink-3">{e.notes}</p>
                )}
              </div>
            </div>
          );
        })}
      </section>
    </main>
  );
};

/// One-tap mark-done from the task history view. For tasks with a
/// result type the user gets an inline value + notes form; for those
/// without, a plain confirm. Reuses `completeTask` so the offline
/// queue + retry path is identical to the dashboard's flow.
const CompleteFromHistory = ({
  taskId,
  taskTitle,
  resultUnit,
  resultLabel,
}: {
  taskId: string;
  taskTitle: string;
  resultUnit: string | null;
  resultLabel: string | null;
}) => {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    const payload: Parameters<typeof completeTask>[0] = {
      taskId,
      taskTitle,
      resultUnit,
    };
    const v = value.trim();
    if (v.length > 0) {
      const n = Number(v);
      if (!Number.isNaN(n)) payload.resultValue = n;
    }
    const t = notes.trim();
    if (t) payload.notes = t;
    await completeTask(payload);
    setBusy(false);
    setOpen(false);
    setValue("");
    setNotes("");
    void qc.invalidateQueries({ queryKey: ["executions", taskId] });
    void qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`Mark "${taskTitle}" done`}
        aria-label={`Mark "${taskTitle}" done`}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line bg-paper text-ink-2 hover:border-ink hover:text-ink"
      >
        <Icon name="check" size={18} />
      </button>
    );
  }

  return (
    <div className="absolute right-5 top-16 w-[260px] rounded-lg border border-line bg-paper-2 p-3 shadow-md">
      {resultLabel && (
        <label className="block">
          <div className="cap mb-1">
            {resultLabel}
            {resultUnit ? ` (${resultUnit})` : ""}
          </div>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="value"
            inputMode="decimal"
            className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm focus:border-ink focus:outline-none"
          />
        </label>
      )}
      <label className="mt-2 block">
        <div className="cap mb-1">Notes (optional)</div>
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm focus:border-ink focus:outline-none"
        />
      </label>
      <div className="mt-3 flex justify-end gap-1">
        <Btn variant="ghost" size="pillSm" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </Btn>
        <Btn variant="primary" size="pillSm" onClick={submit} disabled={busy}>
          {busy ? "…" : "Mark done"}
        </Btn>
      </div>
    </div>
  );
};

// Renders a queued (not-yet-synced) execution — same row layout as
// the server-confirmed list, with a "queued" / "retrying…" /
// "stalled" state hint. Parked rows (over the per-session attempt
// cap) read "stalled — retry on next app start".
const PendingExecutionRow = ({ ev }: { ev: QueuedExecution }) => {
  const stalled = isParked(ev.id);
  const stateLabel = stalled
    ? "stalled — retries on next app start"
    : ev.attempts > 0
      ? `retrying (${ev.attempts})`
      : "queued";
  return (
    <div className="flex items-start gap-3 border-t border-line-soft py-2.5 opacity-80">
      <HowlerAvatar seed={ev.id} initials="•" size={28} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm">
            {ev.resultValue !== null && ev.resultValue !== undefined
              ? `${ev.resultValue} ${ev.resultUnit ?? ""}`.trim()
              : "✓"}
          </span>
          <span className="cap shrink-0">{fmtTs(ev.ts)}</span>
        </div>
        <p className="mt-0.5 text-xs italic text-ink-3">
          {stateLabel}
          {ev.notes ? ` · ${ev.notes}` : ""}
        </p>
      </div>
    </div>
  );
};
