import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ackOccurrence,
  apiLogout,
  apiMe,
  apiPairConfirm,
  createTask,
  createUser,
  deleteTask,
  deleteUser,
  fetchDevices,
  fetchLabels,
  fetchPending,
  fetchScheduleTemplates,
  fetchTaskResults,
  fetchTasks,
  fetchUsers,
  renameUser,
  revokeDevice,
  updateHome,
  updateTask,
  uploadAvatar,
  type Device,
  type Label,
  type Occurrence,
  type ScheduleTemplate,
  type Task,
  type TaskKind,
  type TaskResultDef,
  type User,
} from "./lib/api.ts";
import type { SessionInfo } from "./lib/session.ts";
import {
  currentPermission,
  isPushSupported,
  subscribePush,
  unsubscribePush,
} from "./lib/push.ts";
import { HowlerAvatar } from "./components/HowlerAvatar.tsx";
import { ProgressBar } from "./components/ProgressBar.tsx";
import { SegBtn } from "./components/SegBtn.tsx";
import { Sheet } from "./components/Sheet.tsx";
import { Btn } from "./components/Buttons.tsx";
import { DayRibbonRow } from "./components/DayRibbonRow.tsx";
import { ResultSlider } from "./components/ResultSlider.tsx";

type GroupBy = "time" | "label";

const GROUPBY_KEY = "howler.home.groupBy";

const loadGroupBy = (): GroupBy => {
  if (typeof localStorage === "undefined") return "time";
  return localStorage.getItem(GROUPBY_KEY) === "label" ? "label" : "time";
};

const fmtDayCaps = (d: Date): string =>
  d
    .toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    })
    .replace(",", " ·");

interface Props {
  session: SessionInfo;
  onLogout: () => void;
}

export const Dashboard = ({ session, onLogout }: Props) => {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: apiMe });
  const tasks = useQuery({ queryKey: ["tasks"], queryFn: fetchTasks });
  const pending = useQuery({
    queryKey: ["pending"],
    queryFn: fetchPending,
    refetchInterval: 15_000,
  });
  const labels = useQuery({ queryKey: ["labels"], queryFn: fetchLabels });
  const taskResults = useQuery({
    queryKey: ["taskResults"],
    queryFn: fetchTaskResults,
  });
  const users = useQuery({ queryKey: ["users"], queryFn: fetchUsers });
  const devices = useQuery({ queryKey: ["devices"], queryFn: fetchDevices });
  const templates = useQuery({
    queryKey: ["templates"],
    queryFn: fetchScheduleTemplates,
  });

  const [groupBy, setGroupByState] = useState<GroupBy>(loadGroupBy);
  const setGroupBy = (g: GroupBy) => {
    setGroupByState(g);
    try {
      localStorage.setItem(GROUPBY_KEY, g);
    } catch {
      /* ignore */
    }
  };

  const [ackTarget, setAckTarget] = useState<Occurrence | null>(null);
  const [recentlyAcked, setRecentlyAcked] = useState<Set<string>>(new Set());

  const ack = useMutation({
    mutationFn: (args: {
      id: string;
      resultValue?: number | null;
      notes?: string | null;
    }) => {
      const body: { resultValue?: number | null; notes?: string | null } = {};
      if (args.resultValue !== undefined) body.resultValue = args.resultValue;
      if (args.notes !== undefined) body.notes = args.notes;
      return ackOccurrence(args.id, body);
    },
    onSuccess: (_data, vars) => {
      setAckTarget(null);
      setRecentlyAcked((s) => new Set(s).add(vars.id));
      setTimeout(() => {
        void qc.invalidateQueries({ queryKey: ["pending"] });
        setRecentlyAcked((s) => {
          const next = new Set(s);
          next.delete(vars.id);
          return next;
        });
      }, 350);
    },
  });

  const del = useMutation({
    mutationFn: deleteTask,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["pending"] });
    },
  });

  const handleLogout = async () => {
    try {
      await apiLogout();
    } finally {
      onLogout();
    }
  };

  const handleAckClick = (occ: Occurrence) => {
    const task = (tasks.data ?? []).find((t) => t.id === occ.taskId);
    if (task?.resultTypeId) setAckTarget(occ);
    else ack.mutate({ id: occ.id });
  };

  const todayPending = pending.data ?? [];
  const totalToday = todayPending.length + recentlyAcked.size;
  const doneToday = recentlyAcked.size;

  return (
    <main data-testid="dashboard" className="paper-grain mx-auto min-h-screen max-w-md">
      <Header
        homeName={me.data?.homeDisplayName ?? "Howler"}
        homeAvatarId={me.data?.homeAvatarId ?? null}
        userName={me.data?.userDisplayName}
        userIdSlug={session.userId.slice(0, 8)}
        onAvatarChanged={() => qc.invalidateQueries({ queryKey: ["me"] })}
        onLogout={handleLogout}
        leftCount={todayPending.length}
      />

      <section className="px-5 pb-3 pt-1">
        <ProgressBar done={doneToday} total={Math.max(totalToday, 1)} />
      </section>

      <section className="flex items-center justify-between px-5 pb-2">
        <SegBtn
          options={[
            { value: "time" as const, label: "By time" },
            { value: "label" as const, label: "By label" },
          ]}
          value={groupBy}
          onChange={setGroupBy}
        />
        <PushPill />
      </section>

      <PendingGroups
        groupBy={groupBy}
        pending={todayPending}
        tasks={tasks.data ?? []}
        labels={labels.data ?? []}
        recentlyAcked={recentlyAcked}
        onAckClick={handleAckClick}
        ackBusyId={ack.isPending ? ack.variables?.id ?? null : null}
      />
      {pending.isLoading && <Empty>Loading…</Empty>}
      {!pending.isLoading && todayPending.length === 0 && (
        <Empty>Nothing due. Quiet day.</Empty>
      )}

      <section className="px-5 py-6">
        <h2 className="cap mb-2">New task</h2>
        <CreateTaskForm
          labels={labels.data ?? []}
          taskResults={taskResults.data ?? []}
          templates={templates.data ?? []}
          users={users.data ?? []}
          onCreated={() => {
            void qc.invalidateQueries({ queryKey: ["tasks"] });
            void qc.invalidateQueries({ queryKey: ["pending"] });
          }}
        />
      </section>

      <section className="border-t border-line-soft px-5 py-5">
        <div className="flex items-center justify-between">
          <h2 className="cap">Result types</h2>
          <Link
            to="/settings/result-types"
            className="cap text-ink-3 hover:text-ink"
          >
            Manage →
          </Link>
        </div>
        <p className="mt-1 text-xs text-ink-3">
          Numeric shapes (Grams, Pushups, Rating) tasks can opt into.
        </p>
      </section>

      <Section title="All tasks">
        {tasks.isLoading && <Empty>Loading…</Empty>}
        {tasks.data?.length === 0 && <Empty>No tasks yet.</Empty>}
        {tasks.data?.map((t) => (
          <TaskRow
            key={t.id}
            task={t}
            labels={labels.data ?? []}
            taskResults={taskResults.data ?? []}
            onDelete={() => {
              if (confirm(`Delete "${t.title}"?`)) del.mutate(t.id);
            }}
            deleting={del.isPending && del.variables === t.id}
            onSaved={() => qc.invalidateQueries({ queryKey: ["tasks"] })}
          />
        ))}
      </Section>

      <Section title="Users">
        <UsersBlock
          users={users.data ?? []}
          sessionUserId={session.userId}
          onChanged={() => qc.invalidateQueries({ queryKey: ["users"] })}
        />
      </Section>

      <Section title="Devices">
        <DevicesBlock
          devices={devices.data ?? []}
          onChanged={() => qc.invalidateQueries({ queryKey: ["devices"] })}
        />
        <PairTile
          onPaired={() => qc.invalidateQueries({ queryKey: ["devices"] })}
        />
      </Section>

      {ackTarget && (
        <AckSheet
          occurrence={ackTarget}
          task={
            (tasks.data ?? []).find((t) => t.id === ackTarget.taskId)!
          }
          taskResults={taskResults.data ?? []}
          onCancel={() => setAckTarget(null)}
          onSubmit={(value, notes) => {
            const args: {
              id: string;
              resultValue?: number | null;
              notes?: string | null;
            } = { id: ackTarget.id };
            if (value !== undefined) args.resultValue = value;
            if (notes !== undefined) args.notes = notes;
            ack.mutate(args);
          }}
          busy={ack.isPending}
        />
      )}
    </main>
  );
};

// ── Header ────────────────────────────────────────────────────────

const Header = ({
  homeName,
  homeAvatarId,
  userName,
  userIdSlug,
  onAvatarChanged,
  onLogout,
  leftCount,
}: {
  homeName: string;
  homeAvatarId: string | null;
  userName: string | undefined;
  userIdSlug: string;
  onAvatarChanged: () => void;
  onLogout: () => void;
  leftCount: number;
}) => {
  const today = new Date();
  return (
    <header className="flex items-start justify-between gap-3 px-5 pb-1.5 pt-5">
      <div className="min-w-0 flex-1">
        <div className="cap mb-1">{fmtDayCaps(today)}</div>
        <h1 className="font-display text-[26px] leading-tight">{homeName}</h1>
        <p className="font-serif text-[18px] text-ink-2">
          {leftCount === 0 ? "all clear" : `${leftCount} left today`}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <HomeAvatarTile
          avatarId={homeAvatarId}
          onChanged={onAvatarChanged}
          seed={homeName}
        />
        <button
          type="button"
          onClick={onLogout}
          className="ml-1 rounded-full border border-line px-2 py-1 text-[11px] text-ink-3 hover:bg-paper-2"
          title={`Log out ${userName ?? userIdSlug}`}
          aria-label="Log out"
        >
          ⏻
        </button>
      </div>
    </header>
  );
};

const HomeAvatarTile = ({
  avatarId,
  onChanged,
  seed,
}: {
  avatarId: string | null;
  onChanged: () => void;
  seed: string;
}) => {
  const [busy, setBusy] = useState(false);
  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const { id } = await uploadAvatar(file);
      await updateHome({ avatarId: id });
      onChanged();
    } catch (err) {
      console.warn(err);
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  };
  return (
    <label
      className={`cursor-pointer ${busy ? "opacity-60" : ""}`}
      title="Change home avatar"
    >
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={onPick}
        disabled={busy}
        className="hidden"
      />
      <HowlerAvatar
        avatarId={avatarId}
        seed={seed}
        initials={seed.slice(0, 2).toUpperCase()}
        size={42}
      />
    </label>
  );
};

// ── PushPill ──────────────────────────────────────────────────────

const PushPill = () => {
  const [perm, setPerm] = useState(currentPermission());
  const [busy, setBusy] = useState(false);
  if (!isPushSupported()) return null;
  if (perm === "denied") return null;
  if (perm === "granted") {
    return (
      <button
        type="button"
        onClick={async () => {
          await unsubscribePush();
          setPerm(currentPermission());
        }}
        className="cap rounded-full border border-line px-3 py-1 hover:bg-paper-2"
      >
        🔔 on
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={async () => {
        setBusy(true);
        await subscribePush();
        setPerm(currentPermission());
        setBusy(false);
      }}
      disabled={busy}
      className="cap rounded-full border border-line px-3 py-1 hover:bg-paper-2 disabled:opacity-50"
    >
      Notify me
    </button>
  );
};

// ── Pending grouped ────────────────────────────────────────────────

const TIME_GROUPS = [
  { id: "morning",   label: "Morning",   hours: [0, 11] as const,  caps: "07:00–11:00" },
  { id: "afternoon", label: "Afternoon", hours: [12, 16] as const, caps: "12:00–17:00" },
  { id: "evening",   label: "Evening",   hours: [17, 23] as const, caps: "17:00–22:00" },
] as const;

const PendingGroups = ({
  groupBy,
  pending,
  tasks,
  labels,
  recentlyAcked,
  onAckClick,
  ackBusyId,
}: {
  groupBy: GroupBy;
  pending: Occurrence[];
  tasks: Task[];
  labels: Label[];
  recentlyAcked: Set<string>;
  onAckClick: (o: Occurrence) => void;
  ackBusyId: string | null;
}) => {
  const taskById = useMemo(
    () => new Map(tasks.map((t) => [t.id, t])),
    [tasks],
  );
  const labelById = useMemo(
    () => new Map(labels.map((l) => [l.id, l])),
    [labels],
  );

  if (groupBy === "time") {
    const groups = TIME_GROUPS.map((g) => ({
      ...g,
      items: pending.filter((o) => {
        const h = new Date(o.dueAt * 1000).getHours();
        return h >= g.hours[0] && h <= g.hours[1];
      }),
    })).filter((g) => g.items.length > 0);

    return (
      <>
        {groups.map((g) => (
          <section key={g.id} className="mt-4">
            <header className="flex items-baseline justify-between px-5 pb-1">
              <h3 className="font-serif text-base">{g.label}</h3>
              <span className="cap">{g.caps}</span>
              <span className="font-mono text-xs text-ink-3 tabular-nums">
                {g.items.length}
              </span>
            </header>
            {g.items.map((o) => (
              <DayRibbonRow
                key={o.id}
                occurrence={o}
                task={taskById.get(o.taskId)}
                label={labelById.get(taskById.get(o.taskId)?.labelId ?? "")}
                acked={recentlyAcked.has(o.id)}
                busy={ackBusyId === o.id}
                onAck={() => onAckClick(o)}
              />
            ))}
          </section>
        ))}
      </>
    );
  }

  const byLabel = new Map<string | null, Occurrence[]>();
  for (const o of pending) {
    const t = taskById.get(o.taskId);
    const k = t?.labelId ?? null;
    const arr = byLabel.get(k) ?? [];
    arr.push(o);
    byLabel.set(k, arr);
  }

  return (
    <>
      {[...byLabel.entries()].map(([labelId, items]) => {
        const label = labelId ? labelById.get(labelId) : undefined;
        const swatchColor = label?.color ?? "#7A7060";
        return (
          <section key={labelId ?? "unlabeled"} className="mt-4">
            <header className="flex items-center justify-between px-5 pb-1">
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: swatchColor }}
                  aria-hidden
                />
                <h3 className="font-serif text-base">
                  {label?.displayName ?? "No label"}
                </h3>
              </div>
              <span className="font-mono text-xs text-ink-3 tabular-nums">
                {items.length}
              </span>
            </header>
            {items.map((o) => (
              <DayRibbonRow
                key={o.id}
                occurrence={o}
                task={taskById.get(o.taskId)}
                label={label}
                acked={recentlyAcked.has(o.id)}
                busy={ackBusyId === o.id}
                onAck={() => onAckClick(o)}
              />
            ))}
          </section>
        );
      })}
    </>
  );
};

const Empty = ({ children }: { children: React.ReactNode }) => (
  <div className="px-5 py-10 text-center text-sm italic text-ink-3">
    {children}
  </div>
);

const Section = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) => (
  <section className="border-t border-line-soft px-5 py-5">
    <h2 className="cap mb-2">{title}</h2>
    {children}
  </section>
);

// ── Ack sheet (Slider variant B) ──────────────────────────────────

const AckSheet = ({
  occurrence,
  task,
  taskResults,
  onCancel,
  onSubmit,
  busy,
}: {
  occurrence: Occurrence;
  task: Task;
  taskResults: TaskResultDef[];
  onCancel: () => void;
  onSubmit: (value: number | undefined, notes: string | undefined) => void;
  busy: boolean;
}) => {
  const rt = taskResults.find((r) => r.id === task.resultTypeId);
  const [value, setValue] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const fmtDue = new Date(occurrence.dueAt * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  return (
    <Sheet open onClose={onCancel} ariaLabel={`Mark "${task.title}" done`}>
      <div className="flex items-center gap-3">
        <HowlerAvatar
          avatarId={task.avatarId}
          seed={task.id}
          initials={task.title.slice(0, 2).toUpperCase()}
          size={44}
        />
        <div className="min-w-0 flex-1">
          <div className="cap">due {fmtDue}</div>
          <div className="font-serif text-lg leading-tight">{task.title}</div>
        </div>
      </div>

      {rt && (
        <div className="mt-5">
          <ResultSlider result={rt} onChange={setValue} />
        </div>
      )}

      <label className="mt-4 block">
        <div className="cap mb-1">Notes (optional)</div>
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full rounded-md border border-line bg-paper-2 px-3 py-2 text-sm focus:border-ink focus:outline-none"
        />
      </label>

      <div className="mt-5 flex gap-2">
        <Btn variant="outline" onClick={onCancel} disabled={busy}>
          Skip value
        </Btn>
        <Btn
          variant="primary"
          onClick={() => onSubmit(value ?? undefined, notes.trim() || undefined)}
          disabled={busy}
          className="flex-1"
        >
          {busy ? "…" : "Mark done"}
        </Btn>
      </div>
    </Sheet>
  );
};

// ── Create task form ──────────────────────────────────────────────

const KIND_LABEL: Record<TaskKind, string> = {
  DAILY: "daily",
  PERIODIC: "every N days",
  ONESHOT: "one-time",
};

const CreateTaskForm = ({
  labels,
  taskResults,
  templates,
  users,
  onCreated,
}: {
  labels: Label[];
  taskResults: TaskResultDef[];
  templates: ScheduleTemplate[];
  users: User[];
  onCreated: () => void;
}) => {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<TaskKind>("DAILY");
  const [times, setTimes] = useState("09:00");
  const [intervalDays, setIntervalDays] = useState(7);
  const [deadlineMins, setDeadlineMins] = useState(60);
  const [labelId, setLabelId] = useState("");
  const [resultTypeId, setResultTypeId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: createTask,
    onSuccess: () => {
      setTitle("");
      setError(null);
      onCreated();
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  const submit = () => {
    if (!title.trim()) return setError("title required");
    const common = {
      title: title.trim(),
      labelId: labelId || null,
      resultTypeId: resultTypeId || null,
      isPrivate,
      ...(assigneeId ? { assignees: [assigneeId] } : {}),
    };
    if (templateId) {
      create.mutate({ ...common, kind, templateId });
      return;
    }
    if (kind === "DAILY") {
      const arr = times.split(/[, ]+/).map((s) => s.trim()).filter(Boolean);
      create.mutate({ ...common, kind, times: arr });
    } else if (kind === "PERIODIC") {
      create.mutate({ ...common, kind, intervalDays });
    } else {
      const due = Math.floor(Date.now() / 1000) + deadlineMins * 60;
      create.mutate({ ...common, kind, deadlineHint: due });
    }
  };

  return (
    <div className="rounded-lg border border-line bg-paper-2 p-3">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="What do you want to remember?"
        className="w-full rounded-md border border-line bg-paper px-3 py-2 text-sm focus:border-ink focus:outline-none"
      />
      <div className="mt-2 flex gap-1.5">
        {(["DAILY", "PERIODIC", "ONESHOT"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={`flex-1 rounded-md px-2 py-1.5 text-xs ${
              kind === k
                ? "bg-ink text-paper"
                : "border border-line bg-transparent text-ink-2 hover:text-ink"
            }`}
          >
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
        <SelectInline
          value={labelId}
          onChange={setLabelId}
          options={[
            { value: "", label: "— no label —" },
            ...labels.map((l) => ({ value: l.id, label: l.displayName })),
          ]}
        />
        <SelectInline
          value={resultTypeId}
          onChange={setResultTypeId}
          options={[
            { value: "", label: "— no result —" },
            ...taskResults.map((r) => ({
              value: r.id,
              label: `${r.displayName} (${r.unitName})`,
            })),
          ]}
        />
        <SelectInline
          value={templateId}
          onChange={setTemplateId}
          options={[
            { value: "", label: "— custom schedule —" },
            ...templates.map((t) => ({ value: t.id, label: t.displayName })),
          ]}
        />
        {users.length > 1 && (
          <SelectInline
            value={assigneeId}
            onChange={setAssigneeId}
            options={[
              { value: "", label: "— anyone —" },
              ...users.map((u) => ({ value: u.id, label: u.displayName })),
            ]}
          />
        )}
      </div>
      {!templateId && kind === "DAILY" && (
        <label className="mt-2 block text-xs">
          <span className="cap mb-1 block">Times (UTC HH:MM, comma-separated)</span>
          <input
            value={times}
            onChange={(e) => setTimes(e.target.value)}
            placeholder="08:00, 14:00, 22:00"
            className="w-full rounded-md border border-line bg-paper px-3 py-2 text-sm focus:border-ink focus:outline-none"
          />
        </label>
      )}
      {!templateId && kind === "PERIODIC" && (
        <label className="mt-2 block text-xs">
          <span className="cap mb-1 block">Every N days</span>
          <input
            type="number"
            min={1}
            value={intervalDays}
            onChange={(e) => setIntervalDays(parseInt(e.target.value, 10) || 1)}
            className="w-24 rounded-md border border-line bg-paper px-3 py-2 text-sm focus:border-ink focus:outline-none"
          />
        </label>
      )}
      {!templateId && kind === "ONESHOT" && (
        <label className="mt-2 block text-xs">
          <span className="cap mb-1 block">Remind in (minutes)</span>
          <input
            type="number"
            min={1}
            value={deadlineMins}
            onChange={(e) => setDeadlineMins(parseInt(e.target.value, 10) || 1)}
            className="w-24 rounded-md border border-line bg-paper px-3 py-2 text-sm focus:border-ink focus:outline-none"
          />
        </label>
      )}
      <label className="mt-2 flex items-center gap-2 text-xs text-ink-2">
        <input
          type="checkbox"
          checked={isPrivate}
          onChange={(e) => setIsPrivate(e.target.checked)}
        />
        Private (only assignees + creator see)
      </label>
      <Btn
        size="block"
        variant="primary"
        onClick={submit}
        disabled={create.isPending}
        className="mt-3"
      >
        {create.isPending ? "…" : "Add"}
      </Btn>
      {error && <p className="error mt-2">{error}</p>}
    </div>
  );
};

const SelectInline = ({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) => (
  <select
    value={value}
    onChange={(e) => onChange(e.target.value)}
    className="rounded-md border border-line bg-paper px-2 py-1.5 focus:border-ink focus:outline-none"
  >
    {options.map((o) => (
      <option key={o.value} value={o.value}>
        {o.label}
      </option>
    ))}
  </select>
);

// ── Task row (All tasks list) ─────────────────────────────────────

const TaskRow = ({
  task,
  labels,
  taskResults,
  onDelete,
  deleting,
  onSaved,
}: {
  task: Task;
  labels: Label[];
  taskResults: TaskResultDef[];
  onDelete: () => void;
  deleting: boolean;
  onSaved: () => void;
}) => {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [priority, setPriority] = useState(task.priority);
  const [labelId, setLabelId] = useState<string | null>(task.labelId);
  const [resultTypeId, setResultTypeId] = useState<string | null>(task.resultTypeId);
  const m = useMutation({
    mutationFn: () =>
      updateTask(task.id, {
        title: title.trim(),
        priority,
        labelId,
        resultTypeId,
      }),
    onSuccess: () => {
      setEditing(false);
      onSaved();
    },
  });
  const labelName = labels.find((l) => l.id === task.labelId)?.displayName;
  const resultName = taskResults.find((r) => r.id === task.resultTypeId)?.displayName;

  if (editing) {
    return (
      <div className="task border-t border-line-soft px-1 py-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="mb-1 w-full rounded-md border border-line bg-paper px-3 py-2 text-sm focus:border-ink focus:outline-none"
        />
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <SelectInline
            value={labelId ?? ""}
            onChange={(v) => setLabelId(v || null)}
            options={[
              { value: "", label: "— no label —" },
              ...labels.map((l) => ({ value: l.id, label: l.displayName })),
            ]}
          />
          <SelectInline
            value={resultTypeId ?? ""}
            onChange={(v) => setResultTypeId(v || null)}
            options={[
              { value: "", label: "— no result —" },
              ...taskResults.map((r) => ({
                value: r.id,
                label: `${r.displayName} (${r.unitName})`,
              })),
            ]}
          />
          <span className="cap">priority</span>
          <select
            value={priority}
            onChange={(e) => setPriority(parseInt(e.target.value, 10))}
            className="rounded-md border border-line bg-paper px-2 py-1 text-xs focus:border-ink focus:outline-none"
          >
            {[0, 1, 2, 3].map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-2 flex justify-end gap-2">
          <Btn variant="ghost" size="pillSm" onClick={() => setEditing(false)}>
            Cancel
          </Btn>
          <Btn
            variant="sage"
            size="pillSm"
            onClick={() => m.mutate()}
            disabled={m.isPending}
          >
            {m.isPending ? "…" : "Save"}
          </Btn>
        </div>
      </div>
    );
  }

  return (
    <div className="task flex items-center justify-between border-t border-line-soft py-2.5">
      <Link
        to={`/tasks/${task.id}`}
        className="min-w-0 flex-1 hover:opacity-80"
      >
        <div className="text-[15px] font-medium">{task.title}</div>
        <div className="cap mt-0.5">
          {KIND_LABEL[task.kind]} · pri {task.priority}
          {labelName && ` · ${labelName}`}
          {resultName && ` · ${resultName}`}
          {!task.active && " · paused"}
        </div>
      </Link>
      <div className="flex gap-1">
        <Btn variant="ghost" size="pillSm" onClick={() => setEditing(true)}>
          Edit
        </Btn>
        <Btn
          variant="danger"
          size="pillSm"
          onClick={onDelete}
          disabled={deleting}
        >
          Delete
        </Btn>
      </div>
    </div>
  );
};

// ── Users + Devices + Pair tile ───────────────────────────────────

const UsersBlock = ({
  users,
  sessionUserId,
  onChanged,
}: {
  users: User[];
  sessionUserId: string;
  onChanged: () => void;
}) => {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const add = useMutation({
    mutationFn: () => createUser({ displayName: name.trim() }),
    onSuccess: () => {
      setAdding(false);
      setName("");
      onChanged();
    },
  });
  const rename = useMutation({
    mutationFn: (args: { id: string; displayName: string }) =>
      renameUser(args.id, args.displayName),
    onSuccess: onChanged,
  });
  const remove = useMutation({
    mutationFn: deleteUser,
    onSuccess: onChanged,
  });

  return (
    <>
      {users.map((u) => (
        <UserRow
          key={u.id}
          user={u}
          isSelf={u.id === sessionUserId}
          onRename={(n) => rename.mutate({ id: u.id, displayName: n })}
          onRemove={() => {
            if (
              confirm(
                `Remove ${u.displayName}? Private tasks where they're the only assignee will be deleted.`,
              )
            ) {
              remove.mutate(u.id);
            }
          }}
          removing={remove.isPending && remove.variables === u.id}
        />
      ))}
      {adding ? (
        <div className="flex gap-2 py-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Display name"
            className="flex-1 rounded-md border border-line bg-paper px-3 py-2 text-sm focus:border-ink focus:outline-none"
          />
          <Btn variant="ghost" size="pillSm" onClick={() => setAdding(false)}>
            Cancel
          </Btn>
          <Btn
            variant="sage"
            size="pillSm"
            onClick={() => add.mutate()}
            disabled={!name.trim() || add.isPending}
          >
            Add
          </Btn>
        </div>
      ) : (
        <Btn
          variant="outline"
          size="pillSm"
          className="mt-2"
          onClick={() => setAdding(true)}
        >
          + Add user
        </Btn>
      )}
    </>
  );
};

const UserRow = ({
  user,
  isSelf,
  onRename,
  onRemove,
  removing,
}: {
  user: User;
  isSelf: boolean;
  onRename: (n: string) => void;
  onRemove: () => void;
  removing: boolean;
}) => {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user.displayName);
  return (
    <div className="flex items-center justify-between border-t border-line-soft py-2">
      {editing ? (
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mr-2 flex-1 rounded-md border border-line bg-paper px-3 py-1.5 text-sm focus:border-ink focus:outline-none"
        />
      ) : (
        <div className="flex items-center gap-2">
          <HowlerAvatar
            avatarId={user.avatarId}
            seed={user.id}
            initials={user.displayName.slice(0, 2).toUpperCase()}
            size={28}
          />
          <span className="text-sm">{user.displayName}</span>
          {isSelf && <span className="cap">you</span>}
        </div>
      )}
      <div className="flex gap-1">
        {editing ? (
          <>
            <Btn variant="ghost" size="pillSm" onClick={() => setEditing(false)}>
              Cancel
            </Btn>
            <Btn
              variant="sage"
              size="pillSm"
              onClick={() => {
                onRename(name.trim());
                setEditing(false);
              }}
            >
              Save
            </Btn>
          </>
        ) : (
          <>
            <Btn variant="ghost" size="pillSm" onClick={() => setEditing(true)}>
              Rename
            </Btn>
            {!isSelf && (
              <Btn
                variant="danger"
                size="pillSm"
                onClick={onRemove}
                disabled={removing}
              >
                Remove
              </Btn>
            )}
          </>
        )}
      </div>
    </div>
  );
};

const DevicesBlock = ({
  devices,
  onChanged,
}: {
  devices: Device[];
  onChanged: () => void;
}) => {
  const m = useMutation({ mutationFn: revokeDevice, onSuccess: onChanged });
  const fmtSeen = (ts: number | null) => {
    if (ts === null) return "never";
    const dMin = Math.round((Date.now() / 1000 - ts) / 60);
    if (dMin < 1) return "just now";
    if (dMin < 60) return `${dMin} min ago`;
    return `${Math.round(dMin / 60)} h ago`;
  };
  if (devices.length === 0)
    return <p className="cap py-2">No paired devices yet.</p>;
  return (
    <>
      {devices.map((d) => (
        <div
          key={d.id}
          className="flex items-center justify-between border-t border-line-soft py-2"
        >
          <div className="min-w-0">
            <div className="text-sm">{d.hwModel || "Unnamed device"}</div>
            <div className="cap mt-0.5">
              {d.id.slice(0, 8)}… · last seen {fmtSeen(d.lastSeenAt)}
              {d.fwVersion && ` · fw ${d.fwVersion}`}
            </div>
          </div>
          <Btn
            variant="danger"
            size="pillSm"
            disabled={m.isPending && m.variables === d.id}
            onClick={() => {
              if (confirm("Revoke this device?")) m.mutate(d.id);
            }}
          >
            Revoke
          </Btn>
        </div>
      ))}
    </>
  );
};

const PairTile = ({ onPaired }: { onPaired: () => void }) => {
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(
    null,
  );
  const m = useMutation({
    mutationFn: apiPairConfirm,
    onSuccess: () => {
      setMsg({ kind: "ok", text: "Device paired." });
      setCode("");
      onPaired();
    },
    onError: (e) =>
      setMsg({
        kind: "error",
        text: e instanceof Error ? e.message : String(e),
      }),
  });
  return (
    <div className="mt-3 rounded-lg border border-line bg-paper-2 p-3">
      <h3 className="cap mb-2">Pair a new dial</h3>
      <div className="flex gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="6-digit code shown on your dial"
          className="flex-1 rounded-md border border-line bg-paper px-3 py-2 text-sm focus:border-ink focus:outline-none"
        />
        <Btn
          variant="primary"
          onClick={() => m.mutate(code.trim())}
          disabled={m.isPending || code.trim().length === 0}
        >
          {m.isPending ? "…" : "Pair"}
        </Btn>
      </div>
      {msg && (
        <p className={`mt-1.5 text-xs ${msg.kind === "ok" ? "text-ink-2" : "text-accent-rose"}`}>
          {msg.text}
        </p>
      )}
    </div>
  );
};
