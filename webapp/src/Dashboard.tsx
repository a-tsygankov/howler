import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  apiLogout,
  apiMe,
  apiPairConfirm,
  createTask,
  createUser,
  deleteTask,
  deleteUser,
  fetchDashboard,
  fetchDevices,
  fetchLabels,
  fetchScheduleTemplates,
  fetchTaskResults,
  fetchTasks,
  fetchUsers,
  renameUser,
  revokeDevice,
  updateHome,
  updateTask,
  uploadAvatar,
  type DashboardItem,
  type Device,
  type Label,
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
import { Btn } from "./components/Buttons.tsx";
import {
  DailyTimePicker,
  getLocalTimezone,
  localToUTC,
  utcToLocal,
} from "./components/daily-time-picker";
import { fetchTaskSchedule } from "./lib/api.ts";

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

// Dashboard polls every 5 min while open; mutations (create/edit/
// delete task, edit schedule) invalidate ["dashboard"] alongside
// ["tasks"] so the urgency view refreshes immediately on user
// action. Spec: m-2026-05-06 (single source of truth, identical
// across web + dial).
const DASHBOARD_POLL_MS = 5 * 60 * 1000;

export const Dashboard = ({ session, onLogout }: Props) => {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: apiMe });
  const tasks = useQuery({ queryKey: ["tasks"], queryFn: fetchTasks });
  const dashboard = useQuery({
    queryKey: ["dashboard"],
    queryFn: fetchDashboard,
    refetchInterval: DASHBOARD_POLL_MS,
    refetchOnWindowFocus: true,
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

  const del = useMutation({
    mutationFn: deleteTask,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  const handleLogout = async () => {
    try {
      await apiLogout();
    } finally {
      onLogout();
    }
  };

  const dashboardItems = dashboard.data?.tasks ?? [];
  const urgent = dashboardItems.filter((it) => it.urgency === "URGENT");
  const nonUrgent = dashboardItems.filter((it) => it.urgency === "NON_URGENT");

  return (
    <main data-testid="dashboard" className="paper-grain mx-auto min-h-screen max-w-md lg:max-w-2xl">
      <Header
        homeName={me.data?.homeDisplayName ?? "Howler"}
        homeAvatarId={me.data?.homeAvatarId ?? null}
        userName={me.data?.userDisplayName}
        userIdSlug={session.userId.slice(0, 8)}
        onAvatarChanged={() => qc.invalidateQueries({ queryKey: ["me"] })}
        onHomeRenamed={() => qc.invalidateQueries({ queryKey: ["me"] })}
        onLogout={handleLogout}
        leftCount={urgent.length}
      />

      <section className="flex items-center justify-end px-5 pb-2 pt-1">
        <PushPill />
      </section>

      {urgent.length > 0 && (
        <UrgencyGroup
          title="Urgent"
          items={urgent}
          labels={labels.data ?? []}
          serverNow={dashboard.data?.now}
        />
      )}
      {nonUrgent.length > 0 && (
        <UrgencyGroup
          title="Coming up"
          items={nonUrgent}
          labels={labels.data ?? []}
          serverNow={dashboard.data?.now}
        />
      )}
      {dashboard.isLoading && <Empty>Loading…</Empty>}
      {!dashboard.isLoading && dashboardItems.length === 0 && (
        <Empty>Nothing urgent. All caught up.</Empty>
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
            void qc.invalidateQueries({ queryKey: ["dashboard"] });
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
            onSaved={() => {
              void qc.invalidateQueries({ queryKey: ["tasks"] });
              void qc.invalidateQueries({ queryKey: ["dashboard"] });
            }}
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
  onHomeRenamed,
  onLogout,
  leftCount,
}: {
  homeName: string;
  homeAvatarId: string | null;
  userName: string | undefined;
  userIdSlug: string;
  onAvatarChanged: () => void;
  onHomeRenamed: () => void;
  onLogout: () => void;
  leftCount: number;
}) => {
  const today = new Date();
  return (
    <header className="flex items-start justify-between gap-3 px-5 pb-1.5 pt-5">
      <div className="min-w-0 flex-1">
        <div className="cap mb-1">{fmtDayCaps(today)}</div>
        <HomeNameField name={homeName} onSaved={onHomeRenamed} />
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

// Click-to-rename home display name. Uses the same `["me"]`
// invalidation chain as avatar uploads so the heading reflects the
// new value immediately after save.
const HomeNameField = ({
  name,
  onSaved,
}: {
  name: string;
  onSaved: () => void;
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const m = useMutation({
    mutationFn: (next: string) => updateHome({ displayName: next }),
    onSuccess: () => {
      setEditing(false);
      onSaved();
    },
  });
  const start = () => {
    setDraft(name);
    setEditing(true);
  };
  const commit = () => {
    const next = draft.trim();
    if (!next || next === name) {
      setEditing(false);
      return;
    }
    m.mutate(next);
  };
  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
        disabled={m.isPending}
        className="w-full rounded-md border border-line bg-paper px-2 py-1 font-display text-[26px] leading-tight focus:border-ink focus:outline-none"
        aria-label="Home name"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={start}
      title="Rename home"
      className="text-left font-display text-[26px] leading-tight hover:opacity-80"
    >
      {name}
    </button>
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

// Renders an urgency-classified group of dashboard items. Each row
// shows the task title, schedule summary, and a relative
// "in 14 m / 2 h overdue" hint computed against the server's `now`
// (passed in from the dashboard query). Server-driven so the dial
// firmware will render the same rows.
const UrgencyGroup = ({
  title,
  items,
  labels,
  serverNow,
}: {
  title: string;
  items: DashboardItem[];
  labels: Label[];
  serverNow: number | undefined;
}) => {
  const labelById = new Map(labels.map((l) => [l.id, l]));
  return (
    <section className="mt-3">
      <header className="flex items-baseline justify-between px-5 pb-1">
        <h3 className="font-serif text-base">{title}</h3>
        <span className="font-mono text-xs text-ink-3 tabular-nums">
          {items.length}
        </span>
      </header>
      {items.map((it) => (
        <UrgentTaskRow
          key={it.task.id}
          item={it}
          label={it.task.labelId ? labelById.get(it.task.labelId) : undefined}
          serverNow={serverNow}
        />
      ))}
    </section>
  );
};

const UrgentTaskRow = ({
  item,
  label,
  serverNow,
}: {
  item: DashboardItem;
  label: Label | undefined;
  serverNow: number | undefined;
}) => {
  const { task, urgency, isMissed, prevDeadline, nextDeadline, secondsUntilNext } = item;
  const ringUrgency = isMissed ? 3 : urgency === "URGENT" ? 2 : 1;
  return (
    <Link
      to={`/tasks/${task.id}`}
      className="flex items-center gap-3 border-t border-line-soft px-5 py-2.5 hover:bg-paper-2"
    >
      <HowlerAvatar
        avatarId={task.avatarId}
        seed={task.id}
        initials={task.title.slice(0, 2).toUpperCase()}
        urgency={ringUrgency}
        size={38}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-medium">{task.title}</div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-3">
          <span className="font-mono">
            {fmtDeadline(item, serverNow)}
          </span>
          {label && (
            <span style={{ color: label.color ?? "#7A7060" }}>
              · {label.displayName}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
};

// Relative time rendering for the dashboard rows. The unit picked
// depends on the schedule's period — a 3-days-cycle task shows
// "1 d overdue", a half-hour cycle shows "12 m overdue" — so the
// number stays meaningful for the rhythm of the task. Server's
// `now` drives the math so all clients agree even if device
// clocks drift. Spec: m-2026-05-06.
const fmtDeadline = (
  item: DashboardItem,
  serverNow: number | undefined,
): string => {
  const { isMissed, prevDeadline, secondsUntilNext, periodSec } = item;
  if (isMissed) {
    if (prevDeadline !== null && serverNow !== undefined) {
      const delta = serverNow - prevDeadline;
      return delta > 0 ? `${formatForPeriod(delta, periodSec)} overdue` : "overdue";
    }
    return "overdue";
  }
  if (secondsUntilNext === null || secondsUntilNext < 0) return "—";
  return `in ${formatForPeriod(secondsUntilNext, periodSec)}`;
};

// Period-driven unit selection. Thresholds match the user's spec:
// > 1 day → days, > 1 hour → hours, > 1 minute → minutes, else
// seconds. Fall back to magnitude-based formatting when periodSec
// isn't available (e.g. malformed rule).
const formatForPeriod = (
  deltaSec: number,
  periodSec: number | null,
): string => {
  const abs = Math.max(0, Math.round(deltaSec));
  if (periodSec !== null && periodSec > 0) {
    if (periodSec > 86400) return `${Math.max(1, Math.round(abs / 86400))} d`;
    if (periodSec > 3600) return `${Math.max(1, Math.round(abs / 3600))} h`;
    if (periodSec > 60) return `${Math.max(1, Math.round(abs / 60))} m`;
    return `${abs} s`;
  }
  if (abs < 60) return `${abs} s`;
  if (abs < 3600) return `${Math.round(abs / 60)} m`;
  if (abs < 86400) return `${Math.round(abs / 3600)} h`;
  return `${Math.round(abs / 86400)} d`;
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
  // Local-timezone "HH:MM" strings; converted to UTC on submit.
  const [localTimes, setLocalTimes] = useState<string[]>(["09:00"]);
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
      // Times displayed/edited locally; persisted as UTC.
      const utc = localTimes
        .map((t) => localToUTC(t))
        .filter((t): t is string => !!t);
      if (utc.length === 0) return setError("at least one time required");
      create.mutate({ ...common, kind, times: utc });
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
        <div className="mt-2">
          <span className="cap mb-1 block">
            Times <span className="opacity-60">({getLocalTimezone()})</span>
          </span>
          <DailyTimePicker
            value={localTimes}
            onChange={setLocalTimes}
            maxSlots={6}
          />
        </div>
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

// Schedule summary rendered under each task title. UTC times from the
// embedded rule are converted to the viewer's local TZ so the user
// sees the same wall-clock times they entered.
const describeSchedule = (task: Task): string => {
  if (!task.rule) return KIND_LABEL[task.kind];
  if (task.rule.kind === "DAILY") {
    if (task.rule.times.length === 0) return "daily";
    const local = task.rule.times
      .map((t) => utcToLocal(t))
      .filter((t): t is string => !!t);
    return `daily ${local.join(", ")}`;
  }
  if (task.rule.kind === "PERIODIC") {
    return `every ${task.rule.intervalDays} day${task.rule.intervalDays === 1 ? "" : "s"}`;
  }
  return "one-time";
};

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
  // DAILY-only: local-time strings populated when edit mode opens.
  // null until the schedule fetch resolves.
  const [localTimes, setLocalTimes] = useState<string[] | null>(null);
  const [intervalDays, setIntervalDays] = useState<number | null>(null);

  const qc = useQueryClient();
  // Lazy-load the schedule when the user enters edit mode.
  const scheduleQ = useQuery({
    queryKey: ["task-schedule", task.id],
    queryFn: () => fetchTaskSchedule(task.id),
    enabled: editing,
  });
  // Hydrate local state once the fetch resolves (only on first run
  // for this edit session).
  if (
    scheduleQ.data &&
    localTimes === null &&
    scheduleQ.data.rule.kind === "DAILY"
  ) {
    setLocalTimes(
      scheduleQ.data.rule.times
        .map((t) => utcToLocal(t))
        .filter((t): t is string => !!t),
    );
  }
  if (
    scheduleQ.data &&
    intervalDays === null &&
    scheduleQ.data.rule.kind === "PERIODIC"
  ) {
    setIntervalDays(scheduleQ.data.rule.intervalDays);
  }

  const m = useMutation({
    mutationFn: () => {
      const patch: Parameters<typeof updateTask>[1] = {
        title: title.trim(),
        priority,
        labelId,
        resultTypeId,
      };
      if (task.kind === "DAILY" && localTimes && localTimes.length > 0) {
        patch.times = localTimes
          .map((t) => localToUTC(t))
          .filter((t): t is string => !!t);
      }
      if (task.kind === "PERIODIC" && intervalDays !== null) {
        patch.intervalDays = intervalDays;
      }
      return updateTask(task.id, patch);
    },
    onSuccess: () => {
      setEditing(false);
      setLocalTimes(null);
      setIntervalDays(null);
      // The schedule's rule_json + cached single-task fetch are now
      // stale — refetch so a re-open of edit mode shows the new rule
      // and any other open detail view picks up the change.
      void qc.invalidateQueries({ queryKey: ["task-schedule", task.id] });
      void qc.invalidateQueries({ queryKey: ["task", task.id] });
      onSaved();
    },
  });
  const labelName = labels.find((l) => l.id === task.labelId)?.displayName;
  const resultName = taskResults.find((r) => r.id === task.resultTypeId)?.displayName;
  const scheduleSummary = describeSchedule(task);

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

        {task.kind === "DAILY" && (
          <div className="mt-3">
            <span className="cap mb-1 block">
              Times <span className="opacity-60">({getLocalTimezone()})</span>
            </span>
            {localTimes === null ? (
              <p className="cap py-2">Loading…</p>
            ) : (
              <DailyTimePicker
                value={localTimes}
                onChange={setLocalTimes}
                maxSlots={6}
              />
            )}
          </div>
        )}
        {task.kind === "PERIODIC" && (
          <label className="mt-3 block text-xs">
            <span className="cap mb-1 block">Every N days</span>
            <input
              type="number"
              min={1}
              value={intervalDays ?? ""}
              onChange={(e) =>
                setIntervalDays(parseInt(e.target.value, 10) || 1)
              }
              className="w-24 rounded-md border border-line bg-paper px-2 py-1.5 text-sm focus:border-ink focus:outline-none"
              disabled={intervalDays === null}
            />
          </label>
        )}

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
          {scheduleSummary} · pri {task.priority}
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
  const qc = useQueryClient();
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
    onSuccess: (_data, vars) => {
      onChanged();
      // If the user renamed themselves, the session-scoped /auth/me
      // payload (header greeting) is now stale.
      if (vars.id === sessionUserId) {
        void qc.invalidateQueries({ queryKey: ["me"] });
      }
    },
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
