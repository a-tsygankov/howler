import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  applyTheme,
  readTheme,
  watchSystemTheme,
  writeTheme,
  type Theme,
} from "./theme.ts";
import {
  apiLogout,
  apiMe,
  apiPairConfirm,
  createLabel,
  createScheduleTemplate,
  createTask,
  createUser,
  deleteLabel,
  deleteScheduleTemplate,
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
  updateLabel,
  updateScheduleTemplate,
  updateTask,
  uploadAvatar,
  type DashboardItem,
  type Device,
  type Label,
  type ScheduleRule,
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
import { Icon, type IconName } from "./components/Icon.tsx";
import { Btn } from "./components/Buttons.tsx";
import { Sheet } from "./components/Sheet.tsx";
import { BottomTabs } from "./components/BottomTabs.tsx";
import { ResultSlider } from "./components/ResultSlider.tsx";
import {
  completeTask,
  flushQueue,
  listQueue,
} from "./lib/executionQueue.ts";
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

// Tab routing — single Dashboard component renders different
// sections based on the `view` prop, driven by App.tsx routes.
// Trade-off vs. splitting into separate page files: the heavy
// shared sub-components (CreateTaskForm, TaskRow, LabelsBlock,
// the Sheet, the picker components) all live in this file and
// each page would otherwise import the same ones from here. One
// file with one render path stays easier to refactor.
export type DashboardView = "today" | "all" | "settings";

interface Props {
  session: SessionInfo;
  onLogout: () => void;
  view: DashboardView;
}

// Dashboard polls every 5 min while open; mutations (create/edit/
// delete task, edit schedule) invalidate ["dashboard"] alongside
// ["tasks"] so the urgency view refreshes immediately on user
// action. Spec: m-2026-05-06 (single source of truth, identical
// across web + dial).
const DASHBOARD_POLL_MS = 5 * 60 * 1000;

export const Dashboard = ({ session, onLogout, view }: Props) => {
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

  // Drain any queued executions (from a prior session that lost
  // network mid-submit) on mount, then every 60 s while the
  // dashboard stays open. Successful flushes invalidate the
  // dashboard query so the row's missed/urgent state updates.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const synced = await flushQueue();
      if (!cancelled && synced > 0) {
        void qc.invalidateQueries({ queryKey: ["dashboard"] });
        void qc.invalidateQueries({ queryKey: ["task-executions"] });
      }
    };
    void tick();
    const id = window.setInterval(tick, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [qc]);

  // Sheet target — either a DashboardItem (carries urgency / due
  // hint) or a bare Task (from the All Tasks list). Wrapping it in
  // a tagged union lets the sheet branch on whether to render the
  // due-time line.
  const [completeTarget, setCompleteTarget] = useState<
    | { kind: "dashboard"; item: DashboardItem }
    | { kind: "task"; task: Task }
    | null
  >(null);

  // CreateTaskForm starts collapsed — only the "+ Add task" CTA
  // is visible until the user opts in. Today view's CTA writes a
  // one-shot flag to sessionStorage, navigates to /all, and the
  // /all view consumes the flag in a `view`-keyed effect. Routing
  // between sibling routes here keeps the same Dashboard instance
  // (only the `view` prop changes), so the open-on-arrive trigger
  // has to fire from a `view` dependency, not a mount.
  const navigate = useNavigate();
  const ADD_KEY = "howler.openCreateTask.v1";
  const [addOpen, setAddOpen] = useState(false);
  useEffect(() => {
    if (view !== "all") return;
    try {
      if (sessionStorage.getItem(ADD_KEY) === "1") {
        sessionStorage.removeItem(ADD_KEY);
        setAddOpen(true);
      }
    } catch {
      /* private mode / quota — silently no-op */
    }
  }, [view]);

  return (
    <main
      data-testid="dashboard"
      data-view={view}
      // The bottom inset clears the floating BottomTabs (lg:hidden).
      // On iOS the tab bar floats above the home indicator via
      // env(safe-area-inset-bottom), so the page needs to reserve
      // that much extra space too — otherwise the last row sits
      // under the bar.
      style={{
        paddingBottom:
          "calc(6rem + env(safe-area-inset-bottom))",
      }}
      className="paper-grain mx-auto min-h-screen max-w-md lg:max-w-2xl lg:!pb-0"
    >
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

      {view === "today" && (
        <>
          {urgent.length > 0 && (
            <UrgencyGroup
              title="Urgent"
              items={urgent}
              labels={labels.data ?? []}
              serverNow={dashboard.data?.now}
              onMarkDone={(item) => setCompleteTarget({ kind: "dashboard", item })}
            />
          )}
          {nonUrgent.length > 0 && (
            <UrgencyGroup
              title="Coming up"
              items={nonUrgent}
              labels={labels.data ?? []}
              serverNow={dashboard.data?.now}
              onMarkDone={(item) => setCompleteTarget({ kind: "dashboard", item })}
            />
          )}
          {dashboard.isLoading && <Empty>Loading…</Empty>}
          {!dashboard.isLoading && dashboardItems.length === 0 && (
            <Empty>Nothing urgent. All caught up.</Empty>
          )}
          <div className="flex justify-center px-5 pb-4 pt-2">
            <Btn
              variant="outline"
              size="pillSm"
              data-testid="add-task-cta"
              onClick={() => {
                try {
                  sessionStorage.setItem(ADD_KEY, "1");
                } catch {
                  /* private mode — fall through, /all just won't auto-open */
                }
                navigate("/all");
              }}
            >
              + Add task
            </Btn>
          </div>
        </>
      )}

      {view === "all" && (
        <>
          <section className="px-5 py-4">
            {addOpen ? (
              <>
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="cap">New task</h2>
                  <button
                    type="button"
                    onClick={() => setAddOpen(false)}
                    aria-label="Close new-task form"
                    className="cap text-ink-3 hover:text-ink"
                  >
                    Close
                  </button>
                </div>
                <CreateTaskForm
                  labels={labels.data ?? []}
                  taskResults={taskResults.data ?? []}
                  templates={templates.data ?? []}
                  users={users.data ?? []}
                  onCreated={() => {
                    void qc.invalidateQueries({ queryKey: ["tasks"] });
                    void qc.invalidateQueries({ queryKey: ["dashboard"] });
                    // Collapse the form once a task is created so
                    // the page returns to the All Tasks list view.
                    setAddOpen(false);
                  }}
                />
              </>
            ) : (
              <Btn
                variant="primary"
                size="block"
                data-testid="add-task-cta"
                onClick={() => setAddOpen(true)}
              >
                + Add task
              </Btn>
            )}
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
                onMarkDone={() => setCompleteTarget({ kind: "task", task: t })}
                deleting={del.isPending && del.variables === t.id}
                onSaved={() => {
                  void qc.invalidateQueries({ queryKey: ["tasks"] });
                  void qc.invalidateQueries({ queryKey: ["dashboard"] });
                }}
              />
            ))}
          </Section>
        </>
      )}

      {view === "settings" && (
        <>
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

          <Section title="Schedule templates">
            <TemplatesBlock
              templates={templates.data ?? []}
              onChanged={() =>
                qc.invalidateQueries({ queryKey: ["templates"] })
              }
            />
          </Section>

          <Section title="Labels">
            <LabelsBlock
              labels={labels.data ?? []}
              onChanged={() => {
                void qc.invalidateQueries({ queryKey: ["labels"] });
                void qc.invalidateQueries({ queryKey: ["dashboard"] });
              }}
            />
          </Section>

          <Section title="Users">
            <UsersBlock
              users={users.data ?? []}
              sessionUserId={session.userId}
              onChanged={() => qc.invalidateQueries({ queryKey: ["users"] })}
            />
          </Section>

          <Section title="Theme">
            <ThemeBlock />
          </Section>

          <Section title="Sync activity">
            <SyncLogBlock
              devices={devices.data ?? []}
              onRefresh={() => qc.invalidateQueries({ queryKey: ["devices"] })}
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
        </>
      )}

      <BottomTabs />

      {completeTarget && (
        <CompleteTaskSheet
          task={
            completeTarget.kind === "dashboard"
              ? completeTarget.item.task
              : completeTarget.task
          }
          due={
            completeTarget.kind === "dashboard"
              ? completeTarget.item.isMissed
                ? "overdue"
                : completeTarget.item.nextDeadline
                  ? `due ${new Date(completeTarget.item.nextDeadline * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}`
                  : null
              : null
          }
          taskResults={taskResults.data ?? []}
          users={users.data ?? []}
          sessionUserId={session.userId}
          onCancel={() => setCompleteTarget(null)}
          onCompleted={() => {
            setCompleteTarget(null);
            void qc.invalidateQueries({ queryKey: ["dashboard"] });
            void qc.invalidateQueries({ queryKey: ["task-executions"] });
            void qc.invalidateQueries({ queryKey: ["executions"] });
            // Remote D1 reads can still see the just-recorded
            // execution one beat later than the just-fired insert
            // — schedule a second invalidation 1 s out so the
            // dashboard's `MAX(ts)` lookup definitely picks it up
            // and the task drops off if it's no longer urgent.
            window.setTimeout(() => {
              void qc.invalidateQueries({ queryKey: ["dashboard"] });
              void qc.invalidateQueries({ queryKey: ["task-executions"] });
              void qc.invalidateQueries({ queryKey: ["executions"] });
            }, 1000);
          }}
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
  onMarkDone,
}: {
  title: string;
  items: DashboardItem[];
  labels: Label[];
  serverNow: number | undefined;
  onMarkDone: (item: DashboardItem) => void;
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
          onMarkDone={() => onMarkDone(it)}
        />
      ))}
    </section>
  );
};

const UrgentTaskRow = ({
  item,
  label,
  serverNow,
  onMarkDone,
}: {
  item: DashboardItem;
  label: Label | undefined;
  serverNow: number | undefined;
  onMarkDone: () => void;
}) => {
  const { task, urgency, isMissed } = item;
  const ringUrgency = isMissed ? 3 : urgency === "URGENT" ? 2 : 1;
  return (
    <div className="flex items-center gap-3 border-t border-line-soft px-5 py-2.5 hover:bg-paper-2">
      <Link to={`/tasks/${task.id}`} className="flex min-w-0 flex-1 items-center gap-3">
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
      <button
        type="button"
        onClick={onMarkDone}
        aria-label={`Mark "${task.title}" done`}
        title="Mark done"
        className="flex h-8 w-8 items-center justify-center rounded-full border border-line text-ink-3 hover:border-ink hover:text-ink"
      >
        <Icon name="check" size={16} />
      </button>
    </div>
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

// ── Complete task sheet (offline-queued) ──────────────────────────

const CompleteTaskSheet = ({
  task,
  taskResults,
  users,
  sessionUserId,
  due,
  onCancel,
  onCompleted,
}: {
  task: Task;
  taskResults: TaskResultDef[];
  users: User[];
  sessionUserId: string;
  // Optional context line — "due 14:00" / "overdue".
  due: string | null;
  onCancel: () => void;
  onCompleted: () => void;
}) => {
  const rt = taskResults.find((r) => r.id === task.resultTypeId);
  const [value, setValue] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [actorId, setActorId] = useState<string>(sessionUserId);
  const [busy, setBusy] = useState(false);
  const [statusHint, setStatusHint] = useState<string | null>(null);

  // Show the user picker only when the home actually has multiple
  // members; for single-user homes the session user is unambiguous.
  const multiUser = users.length > 1;

  const submit = async (skipValue: boolean) => {
    setBusy(true);
    setStatusHint(null);
    const payload: Parameters<typeof completeTask>[0] = {
      taskId: task.id,
      taskTitle: task.title,
      resultUnit: rt?.unitName ?? null,
    };
    if (actorId !== sessionUserId) payload.userId = actorId;
    if (!skipValue && value !== null) payload.resultValue = value;
    if (notes.trim()) payload.notes = notes.trim();
    const { status } = await completeTask(payload);
    setStatusHint(
      status === "synced" ? null : "Saved locally — will retry on next sync",
    );
    setBusy(false);
    onCompleted();
  };

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
          {due && <div className="cap">{due}</div>}
          <div className="font-serif text-lg leading-tight">{task.title}</div>
        </div>
      </div>

      {rt && (
        <div className="mt-5">
          <div className="cap mb-2 flex items-baseline justify-between">
            <span>{rt.displayName}</span>
            <span>
              {rt.minValue ?? 0}–{rt.maxValue ?? "∞"} {rt.unitName} · step {rt.step}
            </span>
          </div>
          <ResultSlider result={rt} onChange={setValue} />
        </div>
      )}

      {multiUser && (
        <label className="mt-4 block">
          <div className="cap mb-1">Completed by</div>
          <select
            value={actorId}
            onChange={(e) => setActorId(e.target.value)}
            className="w-full rounded-md border border-line bg-paper-2 px-3 py-2 text-sm focus:border-ink focus:outline-none"
          >
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName}
                {u.id === sessionUserId ? " (you)" : ""}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="mt-4 block">
        <div className="cap mb-1">Notes (optional)</div>
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full rounded-md border border-line bg-paper-2 px-3 py-2 text-sm focus:border-ink focus:outline-none"
        />
      </label>

      {statusHint && (
        <p className="mt-3 text-xs italic text-ink-3">{statusHint}</p>
      )}

      <div className="mt-5 flex gap-2">
        <Btn variant="outline" onClick={() => submit(true)} disabled={busy}>
          Skip value
        </Btn>
        <Btn
          variant="primary"
          onClick={() => submit(false)}
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
  // Local-timezone "HH:MM" strings; converted to UTC on submit.
  const [localTimes, setLocalTimes] = useState<string[]>(["09:00"]);
  const [intervalDays, setIntervalDays] = useState(7);
  // ONESHOT: pick a deadline date + an optional reminder cadence
  // (so the dashboard nudges the user every N days until the
  // deadline). Default 7 days from now, no cadence.
  const todayIso = new Date(Date.now() + 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const [oneshotDate, setOneshotDate] = useState(todayIso);
  const [oneshotCadence, setOneshotCadence] = useState(0); // 0 = no cadence
  const [labelId, setLabelId] = useState("");
  const [resultTypeId, setResultTypeId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Task avatar — "icon:<name>" or null. When null we let the
  // server fall back to the selected label's icon. The user can
  // override via the picker (and a manual override sticks even if
  // they later change the label).
  const [avatarOverride, setAvatarOverride] = useState<string | null>(null);
  // Mirror of the picker's "default from label" state — when true
  // we render a faded preview of the label's icon and submit
  // avatarId: undefined so the server picks it up.
  const labelPick = labels.find((l) => l.id === labelId);
  const effectiveAvatar =
    avatarOverride ?? (labelPick?.icon ? `icon:${labelPick.icon}` : null);

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
      ...(avatarOverride !== null ? { avatarId: avatarOverride } : {}),
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
      // ONESHOT — `oneshotDate` is local-tz YYYY-MM-DD; convert to
      // an end-of-day epoch so the deadline is "by midnight" of the
      // chosen day. `oneshotCadence > 0` adds a reminder cadence.
      const dt = new Date(`${oneshotDate}T23:59:59`);
      if (Number.isNaN(dt.getTime())) return setError("invalid deadline date");
      const due = Math.floor(dt.getTime() / 1000);
      const payload: Parameters<typeof createTask>[0] = {
        ...common,
        kind,
        deadlineHint: due,
      };
      if (oneshotCadence > 0) payload.intervalDays = oneshotCadence;
      create.mutate(payload);
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
      <div className="mt-2">
        <span className="cap mb-1 block">
          Avatar{" "}
          {avatarOverride === null && labelPick?.icon && (
            <span className="opacity-60">(from label · {labelPick.displayName})</span>
          )}
        </span>
        <TaskAvatarPicker
          value={effectiveAvatar}
          inheritedFromLabel={avatarOverride === null && !!labelPick?.icon}
          onPick={setAvatarOverride}
        />
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
        <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
          <label className="block">
            <span className="cap mb-1 block">Deadline</span>
            <input
              type="date"
              value={oneshotDate}
              onChange={(e) => setOneshotDate(e.target.value)}
              className="w-full rounded-md border border-line bg-paper px-3 py-2 text-sm focus:border-ink focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="cap mb-1 block">Remind every (days)</span>
            <input
              type="number"
              min={0}
              value={oneshotCadence}
              onChange={(e) => setOneshotCadence(Math.max(0, parseInt(e.target.value, 10) || 0))}
              placeholder="0 = no reminders"
              className="w-full rounded-md border border-line bg-paper px-3 py-2 text-sm focus:border-ink focus:outline-none"
            />
          </label>
        </div>
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
  // ONESHOT
  const dueLabel = task.deadlineHint
    ? `by ${new Date(task.deadlineHint * 1000).toLocaleDateString()}`
    : "one-time";
  if (task.rule.intervalDays && task.rule.intervalDays > 0) {
    return `${dueLabel} · every ${task.rule.intervalDays}d`;
  }
  return dueLabel;
};

const TaskRow = ({
  task,
  labels,
  taskResults,
  onDelete,
  onMarkDone,
  deleting,
  onSaved,
}: {
  task: Task;
  labels: Label[];
  taskResults: TaskResultDef[];
  onDelete: () => void;
  onMarkDone: () => void;
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
        <button
          type="button"
          onClick={onMarkDone}
          aria-label={`Mark "${task.title}" done`}
          title="Mark done"
          className="flex h-7 w-7 items-center justify-center rounded-full border border-line text-ink-3 hover:border-ink hover:text-ink"
        >
          <Icon name="check" size={14} />
        </button>
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

// ── Schedule templates (per-home; system + custom) ────────────────

const describeTemplateRule = (rule: ScheduleRule): string => {
  if (rule.kind === "DAILY") {
    if (rule.times.length === 0) return "daily";
    const local = rule.times
      .map((t) => utcToLocal(t))
      .filter((t): t is string => !!t);
    return `daily ${local.join(", ")}`;
  }
  if (rule.kind === "PERIODIC") {
    return `every ${rule.intervalDays} day${rule.intervalDays === 1 ? "" : "s"}`;
  }
  return rule.intervalDays
    ? `one-time · remind every ${rule.intervalDays} day${rule.intervalDays === 1 ? "" : "s"}`
    : "one-time";
};

const TemplatesBlock = ({
  templates,
  onChanged,
}: {
  templates: ScheduleTemplate[];
  onChanged: () => void;
}) => {
  const [adding, setAdding] = useState(false);
  return (
    <div>
      {templates.length === 0 && (
        <p className="cap py-2">No templates yet.</p>
      )}
      {templates.map((t) => (
        <TemplateRow key={t.id} template={t} onChanged={onChanged} />
      ))}
      {adding ? (
        <TemplateEditor
          initial={{
            displayName: "",
            description: "",
            rule: { version: 1, kind: "DAILY", times: ["09:00"] },
          }}
          isNew
          onCancel={() => setAdding(false)}
          onSave={async (payload) => {
            await createScheduleTemplate(payload);
            setAdding(false);
            onChanged();
          }}
        />
      ) : (
        <Btn
          variant="outline"
          size="pillSm"
          className="mt-2"
          onClick={() => setAdding(true)}
        >
          + Add template
        </Btn>
      )}
    </div>
  );
};

const TemplateRow = ({
  template,
  onChanged,
}: {
  template: ScheduleTemplate;
  onChanged: () => void;
}) => {
  const [editing, setEditing] = useState(false);
  const remove = useMutation({
    mutationFn: () => deleteScheduleTemplate(template.id),
    onSuccess: onChanged,
  });
  if (editing) {
    return (
      <TemplateEditor
        initial={{
          displayName: template.displayName,
          description: template.description ?? "",
          rule: template.rule,
        }}
        isNew={false}
        onCancel={() => setEditing(false)}
        onSave={async (payload) => {
          await updateScheduleTemplate(template.id, payload);
          setEditing(false);
          onChanged();
        }}
      />
    );
  }
  return (
    <div className="flex items-center justify-between border-t border-line-soft py-2">
      <div className="min-w-0 flex-1">
        <div className="text-sm">
          {template.displayName}
          {template.system && <span className="cap ml-2">default</span>}
        </div>
        <div className="cap mt-0.5">{describeTemplateRule(template.rule)}</div>
      </div>
      <div className="flex gap-1">
        {!template.system && (
          <>
            <Btn variant="ghost" size="pillSm" onClick={() => setEditing(true)}>
              Edit
            </Btn>
            <Btn
              variant="danger"
              size="pillSm"
              disabled={remove.isPending}
              onClick={() => {
                if (confirm(`Delete template "${template.displayName}"?`)) {
                  remove.mutate();
                }
              }}
            >
              Delete
            </Btn>
          </>
        )}
      </div>
    </div>
  );
};

interface TemplateEditorPayload {
  displayName: string;
  description: string | null;
  rule: ScheduleRule;
}

const TemplateEditor = ({
  initial,
  isNew,
  onCancel,
  onSave,
}: {
  initial: { displayName: string; description: string; rule: ScheduleRule };
  isNew: boolean;
  onCancel: () => void;
  onSave: (payload: TemplateEditorPayload) => Promise<void>;
}) => {
  const [name, setName] = useState(initial.displayName);
  const [desc, setDesc] = useState(initial.description);
  const [kind, setKind] = useState<TaskKind>(initial.rule.kind);
  const [localTimes, setLocalTimes] = useState<string[]>(
    initial.rule.kind === "DAILY"
      ? initial.rule.times
          .map((t) => utcToLocal(t))
          .filter((t): t is string => !!t)
      : ["09:00"],
  );
  const [intervalDays, setIntervalDays] = useState<number>(
    initial.rule.kind === "PERIODIC" ? initial.rule.intervalDays : 7,
  );
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!name.trim()) return;
    let rule: ScheduleRule;
    if (kind === "DAILY") {
      const utc = localTimes
        .map((t) => localToUTC(t))
        .filter((t): t is string => !!t);
      if (utc.length === 0) return;
      rule = { version: 1, kind: "DAILY", times: utc };
    } else if (kind === "PERIODIC") {
      rule = { version: 1, kind: "PERIODIC", intervalDays };
    } else {
      rule = { version: 1, kind: "ONESHOT" };
    }
    setBusy(true);
    try {
      await onSave({
        displayName: name.trim(),
        description: desc.trim() || null,
        rule,
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="border-t border-line-soft py-3">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Template name"
        className="mb-2 w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm focus:border-ink focus:outline-none"
      />
      <input
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        placeholder="Description (optional)"
        className="mb-2 w-full rounded-md border border-line bg-paper px-3 py-1.5 text-xs focus:border-ink focus:outline-none"
      />
      <div className="mb-2 flex gap-1.5">
        {(["DAILY", "PERIODIC", "ONESHOT"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={`flex-1 rounded-md px-2 py-1 text-xs ${
              kind === k
                ? "bg-ink text-paper"
                : "border border-line text-ink-2 hover:text-ink"
            }`}
          >
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>
      {kind === "DAILY" && (
        <div className="mb-2">
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
      {kind === "PERIODIC" && (
        <label className="mb-2 block text-xs">
          <span className="cap mb-1 block">Every N days</span>
          <input
            type="number"
            min={1}
            value={intervalDays}
            onChange={(e) =>
              setIntervalDays(parseInt(e.target.value, 10) || 1)
            }
            className="w-24 rounded-md border border-line bg-paper px-3 py-1.5 text-sm focus:border-ink focus:outline-none"
          />
        </label>
      )}
      <div className="flex justify-end gap-2">
        <Btn variant="ghost" size="pillSm" onClick={onCancel} disabled={busy}>
          Cancel
        </Btn>
        <Btn
          variant="sage"
          size="pillSm"
          onClick={submit}
          disabled={busy || !name.trim()}
        >
          {busy ? "…" : isNew ? "Add" : "Save"}
        </Btn>
      </div>
    </div>
  );
};

// ── Labels (per-home; system + custom) ────────────────────────────

// Curated subset of the Icon barrel surfaced in the picker. We
// don't expose every name — chevrons / trash / edit etc. are UI
// chrome, not category icons.
const LABEL_ICON_CHOICES: IconName[] = [
  "paw", "dog", "cat", "broom", "home", "bowl",
  "heart", "sparkle", "star", "plant", "flame", "bell",
  "briefcase", "book", "run", "pill", "tooth", "clock",
  "calendar", "check",
];

const IconPicker = ({
  value,
  onChange,
}: {
  value: string | null | undefined;
  onChange: (next: string | null) => void;
}) => (
  <div className="grid grid-cols-10 gap-1">
    <button
      type="button"
      title="No icon"
      onClick={() => onChange(null)}
      className={`flex h-7 w-7 items-center justify-center rounded-md border text-[10px] ${
        value ? "border-line text-ink-3 hover:border-ink" : "border-ink bg-paper-3 text-ink"
      }`}
    >
      —
    </button>
    {LABEL_ICON_CHOICES.map((name) => {
      const active = value === name;
      return (
        <button
          key={name}
          type="button"
          title={name}
          onClick={() => onChange(name)}
          className={`flex h-7 w-7 items-center justify-center rounded-md border ${
            active
              ? "border-ink bg-paper-3 text-ink"
              : "border-line text-ink-3 hover:border-ink hover:text-ink"
          }`}
        >
          <Icon name={name} size={16} />
        </button>
      );
    })}
  </div>
);

// Task-side avatar picker. Same icon-set surface as labels, plus a
// "use label's icon" reset button. Photo upload + AI conversion is
// stubbed: clicking the upload button surfaces a clear "coming soon"
// message rather than silently uploading something we don't yet
// know how to convert into an icon.
const TaskAvatarPicker = ({
  value,
  inheritedFromLabel,
  onPick,
}: {
  value: string | null;
  inheritedFromLabel: boolean;
  onPick: (next: string | null) => void;
}) => {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-10 gap-1">
        <button
          type="button"
          title={inheritedFromLabel ? "Currently inherited from label" : "Use label's icon"}
          onClick={() => onPick(null)}
          className={`flex h-7 w-7 items-center justify-center rounded-md border text-[10px] ${
            value === null
              ? "border-ink bg-paper-3 text-ink"
              : "border-line text-ink-3 hover:border-ink"
          }`}
        >
          ↺
        </button>
        {LABEL_ICON_CHOICES.map((name) => {
          const id = `icon:${name}`;
          const active = value === id;
          return (
            <button
              key={name}
              type="button"
              title={name}
              onClick={() => onPick(id)}
              className={`flex h-7 w-7 items-center justify-center rounded-md border ${
                active
                  ? "border-ink bg-paper-3 text-ink"
                  : "border-line text-ink-3 hover:border-ink hover:text-ink"
              } ${inheritedFromLabel && value === id ? "opacity-60" : ""}`}
            >
              <Icon name={name} size={16} />
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-ink-3">
        Upload a photo →{" "}
        <span className="italic">
          AI conversion to icon coming soon (Phase 7).
        </span>
      </p>
    </div>
  );
};

const LabelsBlock = ({
  labels,
  onChanged,
}: {
  labels: Label[];
  onChanged: () => void;
}) => {
  const [adding, setAdding] = useState(false);
  return (
    <div>
      {labels.length === 0 && <p className="cap py-2">No labels yet.</p>}
      {labels.map((l) => (
        <LabelRow key={l.id} label={l} onChanged={onChanged} />
      ))}
      {adding ? (
        <LabelEditor
          initial={{ displayName: "", color: "#7A7060", icon: null }}
          isNew
          onCancel={() => setAdding(false)}
          onSave={async (patch) => {
            await createLabel(patch);
            setAdding(false);
            onChanged();
          }}
        />
      ) : (
        <Btn
          variant="outline"
          size="pillSm"
          className="mt-2"
          onClick={() => setAdding(true)}
        >
          + Add label
        </Btn>
      )}
    </div>
  );
};

const LabelRow = ({
  label,
  onChanged,
}: {
  label: Label;
  onChanged: () => void;
}) => {
  const [editing, setEditing] = useState(false);
  const remove = useMutation({
    mutationFn: () => deleteLabel(label.id),
    onSuccess: onChanged,
  });
  if (editing) {
    return (
      <LabelEditor
        initial={{
          displayName: label.displayName,
          color: label.color ?? "#7A7060",
          icon: label.icon ?? null,
        }}
        isNew={false}
        onCancel={() => setEditing(false)}
        onSave={async (patch) => {
          await updateLabel(label.id, patch);
          setEditing(false);
          onChanged();
        }}
      />
    );
  }
  return (
    <div className="flex items-center justify-between border-t border-line-soft py-2">
      <div className="flex min-w-0 items-center gap-2">
        <span
          className="flex h-7 w-7 items-center justify-center rounded-full"
          style={{ background: label.color ?? "#7A7060", color: "#fff" }}
        >
          {label.icon ? (
            <Icon name={label.icon as IconName} size={14} color="#fff" />
          ) : (
            <span className="font-mono text-[10px]">
              {label.displayName.slice(0, 2).toUpperCase()}
            </span>
          )}
        </span>
        <span className="truncate text-sm">{label.displayName}</span>
        {label.system && <span className="cap">default</span>}
      </div>
      <div className="flex gap-1">
        <Btn variant="ghost" size="pillSm" onClick={() => setEditing(true)}>
          Edit
        </Btn>
        {!label.system && (
          <Btn
            variant="danger"
            size="pillSm"
            disabled={remove.isPending}
            onClick={() => {
              if (confirm(`Delete label "${label.displayName}"?`)) remove.mutate();
            }}
          >
            Delete
          </Btn>
        )}
      </div>
    </div>
  );
};

const LabelEditor = ({
  initial,
  isNew,
  onCancel,
  onSave,
}: {
  initial: { displayName: string; color: string; icon: string | null };
  isNew: boolean;
  onCancel: () => void;
  onSave: (patch: { displayName: string; color: string; icon: string | null }) => Promise<void>;
}) => {
  const [name, setName] = useState(initial.displayName);
  const [color, setColor] = useState(initial.color);
  const [icon, setIcon] = useState<string | null>(initial.icon);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await onSave({ displayName: name.trim(), color, icon });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="border-t border-line-soft py-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Display name"
          className="flex-1 rounded-md border border-line bg-paper px-3 py-1.5 text-sm focus:border-ink focus:outline-none"
        />
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          aria-label="Label color"
          className="h-7 w-9 cursor-pointer rounded-md border border-line"
        />
      </div>
      <div className="mt-2">
        <span className="cap mb-1 block">Icon</span>
        <IconPicker value={icon} onChange={setIcon} />
      </div>
      <div className="mt-2 flex justify-end gap-2">
        <Btn variant="ghost" size="pillSm" onClick={onCancel} disabled={busy}>
          Cancel
        </Btn>
        <Btn variant="sage" size="pillSm" onClick={submit} disabled={busy || !name.trim()}>
          {busy ? "…" : isNew ? "Add" : "Save"}
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

/// Three-button theme switcher. Reads/writes the persisted choice
/// via `theme.ts`; subscribes to system color-scheme changes so the
/// "system" mode flips live when the user toggles their OS theme.
const ThemeBlock = () => {
  const [theme, setTheme] = useState<Theme>(() => readTheme());
  useEffect(() => {
    // Re-apply on every change so a user toggling System ↔ explicit
    // takes effect on the active page (no reload required).
    applyTheme(theme);
  }, [theme]);
  useEffect(() => {
    if (theme !== "system") return;
    return watchSystemTheme(() => applyTheme("system"));
  }, [theme]);
  const choose = (t: Theme) => {
    setTheme(t);
    writeTheme(t);
  };
  const opt = (
    value: Theme,
    label: string,
  ) => (
    <button
      key={value}
      type="button"
      onClick={() => choose(value)}
      className={
        "flex-1 rounded-lg border px-3 py-2 text-sm transition-colors " +
        (theme === value
          ? "border-ink bg-ink text-paper"
          : "border-line-soft bg-paper-2 text-ink-2 hover:border-line")
      }
    >
      {label}
    </button>
  );
  return (
    <div className="flex flex-col gap-2 py-1">
      <div className="flex gap-2">
        {opt("light", "Light")}
        {opt("dark", "Dark")}
        {opt("system", "System")}
      </div>
      <p className="cap">
        System follows the OS color-scheme preference.
      </p>
    </div>
  );
};

/// Sync-health pill — visible answer to "is the dial actually
/// reaching the server?". The backend bumps `device.last_seen_at`
/// every time it serves a request bearing a device token (see
/// `markDeviceAlive` middleware), so a recent timestamp = the dial
/// is alive. Three buckets:
///   < 5 min    → green ("just now" / "N min ago")
///   < 30 min   → amber ("N min ago")
///   else       → red   ("hours ago" / "never")
/// On a healthy sync interval (~30 s default) the green band is
/// where every paired device should sit while in active use.
const SyncLogBlock = ({
  devices,
  onRefresh,
}: {
  devices: Device[];
  onRefresh: () => void;
}) => {
  const now = Math.floor(Date.now() / 1000);
  const fmtAgo = (ts: number | null) => {
    if (ts === null) return "never";
    const dSec = now - ts;
    if (dSec < 60) return "just now";
    if (dSec < 3600) return `${Math.round(dSec / 60)} min ago`;
    if (dSec < 86400) return `${Math.round(dSec / 3600)} h ago`;
    return `${Math.round(dSec / 86400)} d ago`;
  };
  const tier = (ts: number | null): "ok" | "stale" | "lost" => {
    if (ts === null) return "lost";
    const dSec = now - ts;
    if (dSec < 5 * 60) return "ok";
    if (dSec < 30 * 60) return "stale";
    return "lost";
  };
  const dot = (t: "ok" | "stale" | "lost") =>
    t === "ok"
      ? "bg-[#2C774B]"
      : t === "stale"
        ? "bg-[#C88310]"
        : "bg-[#C13D1E]";

  return (
    <>
      {devices.length === 0 ? (
        <p className="cap py-2">No paired devices yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {devices.map((d) => {
            const t = tier(d.lastSeenAt);
            return (
              <div
                key={d.id}
                className="flex items-center gap-3 rounded-lg border border-line-soft bg-paper-2 px-3 py-2"
              >
                <span
                  className={`inline-block h-2.5 w-2.5 rounded-full ${dot(t)}`}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm">
                    {d.hwModel || "Unnamed device"}
                  </div>
                  <div className="cap mt-0.5">
                    last sync {fmtAgo(d.lastSeenAt)}
                    {d.fwVersion && ` · fw ${d.fwVersion}`}
                  </div>
                </div>
                <span
                  className={
                    "cap " +
                    (t === "ok"
                      ? "text-[#2C774B]"
                      : t === "stale"
                        ? "text-[#C88310]"
                        : "text-[#C13D1E]")
                  }
                >
                  {t === "ok" ? "live" : t === "stale" ? "idle" : "offline"}
                </span>
              </div>
            );
          })}
        </div>
      )}
      <div className="mt-3 flex items-center justify-between">
        <p className="cap">Updates each time a device hits the API.</p>
        <Btn variant="outline" size="pillSm" onClick={onRefresh}>
          Refresh
        </Btn>
      </div>
    </>
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
  // Pre-fill from `?pair=CODE` so the QR shown on a fresh dial drops
  // the user straight into a one-tap confirm. Cleaned out of the URL
  // on first render so a refresh doesn't re-trigger. Done in an
  // effect rather than a lazy useState initializer because StrictMode
  // double-invokes initializers — a side-effecting init would lose
  // the value on the second pass.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const fromQs = url.searchParams.get("pair");
    if (!fromQs) return;
    url.searchParams.delete("pair");
    window.history.replaceState({}, "", url.toString());
    setCode(fromQs.replace(/\D/g, "").slice(0, 6));
  }, []);
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
