import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ackOccurrence,
  apiLogout,
  apiMe,
  apiPairConfirm,
  avatarUrl,
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

const fmtDue = (dueAt: number): string => {
  const ms = dueAt * 1000;
  const delta = ms - Date.now();
  const abs = Math.abs(delta);
  const m = Math.round(abs / 60_000);
  if (m < 1) return delta >= 0 ? "now" : "just now";
  if (m < 60) return delta >= 0 ? `in ${m} min` : `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return delta >= 0 ? `in ${h} h` : `${h} h ago`;
  const d = Math.round(h / 24);
  return delta >= 0 ? `in ${d} d` : `${d} d ago`;
};

const kindLabel = (k: TaskKind) =>
  k === "DAILY" ? "daily" : k === "PERIODIC" ? "every N days" : "one-time";

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
  const taskResults = useQuery({ queryKey: ["taskResults"], queryFn: fetchTaskResults });
  const users = useQuery({ queryKey: ["users"], queryFn: fetchUsers });
  const devices = useQuery({ queryKey: ["devices"], queryFn: fetchDevices });
  const templates = useQuery({ queryKey: ["templates"], queryFn: fetchScheduleTemplates });

  const [ackTarget, setAckTarget] = useState<Occurrence | null>(null);

  const ack = useMutation({
    mutationFn: (args: { id: string; resultValue?: number | null; notes?: string | null }) => {
      const body: { resultValue?: number | null; notes?: string | null } = {};
      if (args.resultValue !== undefined) body.resultValue = args.resultValue;
      if (args.notes !== undefined) body.notes = args.notes;
      return ackOccurrence(args.id, body);
    },
    onSuccess: () => {
      setAckTarget(null);
      void qc.invalidateQueries({ queryKey: ["pending"] });
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
    // If the task has a result type, open the modal so the user can
    // enter the value. Otherwise just ack.
    if (task?.resultTypeId) setAckTarget(occ);
    else ack.mutate({ id: occ.id });
  };

  return (
    <main data-testid="dashboard">
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <HomeAvatar
            avatarId={me.data?.homeAvatarId ?? null}
            onChanged={() => qc.invalidateQueries({ queryKey: ["me"] })}
          />
          <h1 style={{ margin: 0 }}>{me.data?.homeDisplayName ?? "Howler"}</h1>
        </div>
        <div style={{ fontSize: 13, opacity: 0.7 }}>
          {me.data?.userDisplayName ?? session.userId.slice(0, 8) + "…"}
          <button
            type="button"
            onClick={handleLogout}
            style={{
              marginLeft: 12,
              background: "transparent",
              border: "1px solid #1e293b",
              color: "inherit",
              borderRadius: 6,
              padding: "4px 8px",
              cursor: "pointer",
            }}
          >
            Log out
          </button>
        </div>
      </header>

      <PushToggle />


      <section style={{ marginTop: 8 }}>
        <h2 style={{ fontSize: 16, margin: "0 0 8px" }}>Pending</h2>
        {pending.isLoading && <div className="empty">Loading…</div>}
        {pending.isError && (
          <div className="error">{(pending.error as Error).message}</div>
        )}
        {!pending.isLoading && pending.data?.length === 0 && (
          <div className="empty">Nothing due.</div>
        )}
        {pending.data?.map((o) => (
          <PendingCard
            key={o.id}
            occurrence={o}
            task={(tasks.data ?? []).find((t) => t.id === o.taskId)}
            labels={labels.data ?? []}
            onAck={() => handleAckClick(o)}
            busy={ack.isPending && ack.variables?.id === o.id}
          />
        ))}
      </section>

      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 16, margin: "0 0 8px" }}>New task</h2>
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

      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 16, margin: "0 0 8px" }}>All tasks</h2>
        {tasks.isLoading && <div className="empty">Loading…</div>}
        {tasks.data?.length === 0 && <div className="empty">No tasks yet.</div>}
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
      </section>

      <UsersSection
        users={users.data ?? []}
        sessionUserId={session.userId}
        onChanged={() => qc.invalidateQueries({ queryKey: ["users"] })}
      />

      <DevicesSection
        devices={devices.data ?? []}
        onChanged={() => qc.invalidateQueries({ queryKey: ["devices"] })}
      />

      <PairDevice
        onPaired={() => qc.invalidateQueries({ queryKey: ["devices"] })}
      />

      {ackTarget && (
        <AckModal
          occurrence={ackTarget}
          task={(tasks.data ?? []).find((t) => t.id === ackTarget.taskId)!}
          taskResults={taskResults.data ?? []}
          onCancel={() => setAckTarget(null)}
          onSubmit={(value, notes) => {
            const args: { id: string; resultValue?: number | null; notes?: string | null } = { id: ackTarget.id };
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
      <div className="task" style={{ display: "grid", gap: 6 }}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={inputStyle}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Select
            value={labelId ?? ""}
            onChange={(v) => setLabelId(v || null)}
            options={[{ value: "", label: "— no label —" }, ...labels.map((l) => ({ value: l.id, label: l.displayName }))]}
          />
          <Select
            value={resultTypeId ?? ""}
            onChange={(v) => setResultTypeId(v || null)}
            options={[{ value: "", label: "— no result —" }, ...taskResults.map((r) => ({ value: r.id, label: `${r.displayName} (${r.unitName})` }))]}
          />
          <span className="meta">priority</span>
          <select
            value={priority}
            onChange={(e) => setPriority(parseInt(e.target.value, 10))}
            style={selectStyle}
          >
            {[0, 1, 2, 3].map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={() => setEditing(false)} style={iconBtn}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => m.mutate()}
            disabled={m.isPending}
            style={{ ...iconBtn, color: "#22c55e", borderColor: "#15803d" }}
          >
            {m.isPending ? "…" : "Save"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="task"
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}
    >
      <div>
        <div>{task.title}</div>
        <div className="meta">
          {kindLabel(task.kind)} · priority {task.priority}
          {labelName && ` · ${labelName}`}
          {resultName && ` · ${resultName}`}
          {!task.active && " · paused"}
        </div>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button type="button" onClick={() => setEditing(true)} style={iconBtn}>
          Edit
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={deleting}
          style={{ ...iconBtn, color: "#f87171" }}
        >
          Delete
        </button>
      </div>
    </div>
  );
};

const PendingCard = ({
  occurrence,
  task,
  labels,
  onAck,
  busy,
}: {
  occurrence: Occurrence;
  task: Task | undefined;
  labels: Label[];
  onAck: () => void;
  busy: boolean;
}) => {
  const labelName = labels.find((l) => l.id === task?.labelId)?.displayName;
  return (
    <div
      className="task"
      style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
    >
      <div>
        <div>{task?.title ?? "(unknown task)"}</div>
        <div className="meta">
          due {fmtDue(occurrence.dueAt)}
          {labelName && ` · ${labelName}`}
        </div>
      </div>
      <button
        type="button"
        onClick={onAck}
        disabled={busy}
        style={{
          padding: "8px 14px",
          borderRadius: 8,
          border: "none",
          background: "#16a34a",
          color: "white",
          fontWeight: 600,
          cursor: busy ? "default" : "pointer",
          opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? "…" : "Done"}
      </button>
    </div>
  );
};

const AckModal = ({
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
  const [value, setValue] = useState<string>("");
  const [notes, setNotes] = useState("");
  void occurrence;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 100,
      }}
    >
      <div
        style={{
          background: "#0f172a",
          border: "1px solid #1e293b",
          borderRadius: 12,
          padding: 20,
          maxWidth: 400,
          width: "100%",
        }}
      >
        <h3 style={{ margin: "0 0 8px" }}>{task.title}</h3>
        {rt && (
          <label style={{ display: "block", marginBottom: 12 }}>
            <div className="meta" style={{ marginBottom: 4 }}>
              {rt.displayName} ({rt.unitName})
              {rt.minValue !== null && rt.maxValue !== null
                ? ` — ${rt.minValue}…${rt.maxValue}`
                : rt.minValue !== null
                  ? ` — min ${rt.minValue}`
                  : ""}
            </div>
            <input
              type="number"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              step={rt.step}
              min={rt.minValue ?? undefined}
              max={rt.maxValue ?? undefined}
              placeholder="(skip)"
              style={inputStyle}
            />
          </label>
        )}
        <label style={{ display: "block", marginBottom: 12 }}>
          <div className="meta" style={{ marginBottom: 4 }}>
            Notes (optional)
          </div>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            style={inputStyle}
          />
        </label>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" onClick={onCancel} style={iconBtn} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const num = value.trim() === "" ? undefined : Number(value);
              onSubmit(num, notes.trim() || undefined);
            }}
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              border: "none",
              background: "#16a34a",
              color: "white",
              fontWeight: 600,
              cursor: busy ? "default" : "pointer",
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? "…" : "Done"}
          </button>
        </div>
      </div>
    </div>
  );
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
      // Template overrides kind + rule fields server-side.
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
    <div
      style={{
        padding: 12,
        border: "1px solid #1e293b",
        borderRadius: 12,
        background: "#111827",
      }}
    >
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="What do you want to remember?"
        style={inputStyle}
      />
      <div style={{ display: "flex", gap: 6, margin: "8px 0" }}>
        {(["DAILY", "PERIODIC", "ONESHOT"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            style={{
              flex: 1,
              padding: "6px 8px",
              borderRadius: 8,
              border: "1px solid #1e293b",
              background: kind === k ? "#1e293b" : "transparent",
              color: "inherit",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            {kindLabel(k)}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <Select
          value={labelId}
          onChange={setLabelId}
          options={[
            { value: "", label: "— no label —" },
            ...labels.map((l) => ({ value: l.id, label: l.displayName })),
          ]}
        />
        <Select
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
        {users.length > 1 && (
          <Select
            value={assigneeId}
            onChange={setAssigneeId}
            options={[
              { value: "", label: "— anyone —" },
              ...users.map((u) => ({ value: u.id, label: u.displayName })),
            ]}
          />
        )}
        <Select
          value={templateId}
          onChange={setTemplateId}
          options={[
            { value: "", label: "— custom schedule —" },
            ...templates.map((t) => ({ value: t.id, label: t.displayName })),
          ]}
        />
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, opacity: 0.8, marginBottom: 6 }}>
        <input
          type="checkbox"
          checked={isPrivate}
          onChange={(e) => setIsPrivate(e.target.checked)}
        />
        Private (only assignees + creator see)
      </label>

      {!templateId && kind === "DAILY" && (
        <div className="meta" style={{ marginBottom: 6 }}>
          Times (UTC HH:MM, comma-separated)
          <input
            value={times}
            onChange={(e) => setTimes(e.target.value)}
            style={inputStyle}
            placeholder="08:00, 14:00, 22:00"
          />
        </div>
      )}
      {!templateId && kind === "PERIODIC" && (
        <div className="meta" style={{ marginBottom: 6 }}>
          Every
          <input
            type="number"
            min={1}
            value={intervalDays}
            onChange={(e) => setIntervalDays(parseInt(e.target.value, 10) || 1)}
            style={{ ...inputStyle, width: 80, display: "inline-block", marginLeft: 8 }}
          />
          days
        </div>
      )}
      {!templateId && kind === "ONESHOT" && (
        <div className="meta" style={{ marginBottom: 6 }}>
          Remind in
          <input
            type="number"
            min={1}
            value={deadlineMins}
            onChange={(e) => setDeadlineMins(parseInt(e.target.value, 10) || 1)}
            style={{ ...inputStyle, width: 80, display: "inline-block", marginLeft: 8 }}
          />
          minutes
        </div>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={create.isPending}
        style={{
          width: "100%",
          marginTop: 8,
          padding: "10px",
          borderRadius: 8,
          border: "none",
          background: "#2563eb",
          color: "white",
          fontWeight: 600,
          cursor: create.isPending ? "default" : "pointer",
          opacity: create.isPending ? 0.6 : 1,
        }}
      >
        {create.isPending ? "…" : "Add"}
      </button>
      {error && <div className="error" style={{ marginTop: 6 }}>{error}</div>}
    </div>
  );
};

const UsersSection = ({
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
    <section style={{ marginTop: 24 }}>
      <h2 style={{ fontSize: 16, margin: "0 0 8px" }}>Users in this home</h2>
      {users.map((u) => (
        <UserRow
          key={u.id}
          user={u}
          isSelf={u.id === sessionUserId}
          onRename={(displayName) => rename.mutate({ id: u.id, displayName })}
          onRemove={() => {
            if (confirm(`Remove ${u.displayName}? Private tasks where they're the only assignee will be deleted.`)) {
              remove.mutate(u.id);
            }
          }}
          removing={remove.isPending && remove.variables === u.id}
        />
      ))}
      {adding ? (
        <div className="task" style={{ display: "flex", gap: 8 }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Display name"
            style={{ ...inputStyle, marginTop: 0 }}
          />
          <button type="button" onClick={() => setAdding(false)} style={iconBtn}>
            Cancel
          </button>
          <button
            type="button"
            disabled={add.isPending || !name.trim()}
            onClick={() => add.mutate()}
            style={{ ...iconBtn, color: "#22c55e", borderColor: "#15803d" }}
          >
            {add.isPending ? "…" : "Add"}
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)} style={iconBtn}>
          + Add user
        </button>
      )}
    </section>
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
  onRename: (displayName: string) => void;
  onRemove: () => void;
  removing: boolean;
}) => {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user.displayName);
  return (
    <div
      className="task"
      style={{
        display: "flex",
        gap: 8,
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      {editing ? (
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ ...inputStyle, marginTop: 0 }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onRename(name.trim());
              setEditing(false);
            }
          }}
        />
      ) : (
        <div>
          {user.displayName}
          {isSelf && <span className="meta"> · you</span>}
        </div>
      )}
      <div style={{ display: "flex", gap: 6 }}>
        {editing ? (
          <>
            <button type="button" onClick={() => setEditing(false)} style={iconBtn}>
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                onRename(name.trim());
                setEditing(false);
              }}
              style={{ ...iconBtn, color: "#22c55e", borderColor: "#15803d" }}
            >
              Save
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => setEditing(true)} style={iconBtn}>
              Rename
            </button>
            {!isSelf && (
              <button
                type="button"
                disabled={removing}
                onClick={onRemove}
                style={{ ...iconBtn, color: "#f87171" }}
              >
                Remove
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
};

const DevicesSection = ({
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
  if (devices.length === 0) return null;
  return (
    <section style={{ marginTop: 24 }}>
      <h2 style={{ fontSize: 16, margin: "0 0 8px" }}>Paired devices</h2>
      {devices.map((d) => (
        <div
          key={d.id}
          className="task"
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
        >
          <div>
            <div>{d.hwModel || "Unnamed device"}</div>
            <div className="meta">
              {d.id.slice(0, 8)}… · last seen {fmtSeen(d.lastSeenAt)}
              {d.fwVersion && ` · fw ${d.fwVersion}`}
            </div>
          </div>
          <button
            type="button"
            disabled={m.isPending && m.variables === d.id}
            onClick={() => {
              if (confirm("Revoke this device?")) m.mutate(d.id);
            }}
            style={{ ...iconBtn, color: "#f87171" }}
          >
            Revoke
          </button>
        </div>
      ))}
    </section>
  );
};

const PairDevice = ({ onPaired }: { onPaired: () => void }) => {
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const m = useMutation({
    mutationFn: apiPairConfirm,
    onSuccess: () => {
      setMsg({ kind: "ok", text: "Device paired." });
      setCode("");
      onPaired();
    },
    onError: (e) =>
      setMsg({ kind: "error", text: e instanceof Error ? e.message : String(e) }),
  });
  return (
    <section style={{ marginTop: 24 }}>
      <h2 style={{ fontSize: 16, margin: "0 0 8px" }}>Pair a device</h2>
      <div
        style={{
          padding: 12,
          border: "1px solid #1e293b",
          borderRadius: 12,
          background: "#111827",
          display: "flex",
          gap: 8,
        }}
      >
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="6-digit code shown on your dial"
          style={{ ...inputStyle, marginTop: 0 }}
        />
        <button
          type="button"
          onClick={() => m.mutate(code.trim())}
          disabled={m.isPending || code.trim().length === 0}
          style={{
            padding: "8px 14px",
            borderRadius: 8,
            border: "none",
            background: "#2563eb",
            color: "white",
            fontWeight: 600,
            cursor: m.isPending ? "default" : "pointer",
            opacity: m.isPending ? 0.6 : 1,
          }}
        >
          {m.isPending ? "…" : "Pair"}
        </button>
      </div>
      {msg && (
        <div
          className={msg.kind === "ok" ? "meta" : "error"}
          style={{ marginTop: 6 }}
        >
          {msg.text}
        </div>
      )}
    </section>
  );
};

const HomeAvatar = ({
  avatarId,
  onChanged,
}: {
  avatarId: string | null;
  onChanged: () => void;
}) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = avatarUrl(avatarId);
  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const { id } = await uploadAvatar(file);
      await updateHome({ avatarId: id });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  };
  return (
    <label
      style={{
        cursor: busy ? "default" : "pointer",
        opacity: busy ? 0.6 : 1,
        position: "relative",
      }}
      title={error ?? "Click to change home avatar"}
    >
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={onPick}
        disabled={busy}
        style={{ display: "none" }}
      />
      {url ? (
        <img
          src={url}
          alt=""
          width={48}
          height={48}
          style={{
            borderRadius: "50%",
            objectFit: "cover",
            border: "2px solid #1e293b",
          }}
        />
      ) : (
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: "50%",
            background: "#1e293b",
            display: "grid",
            placeItems: "center",
            fontSize: 20,
            border: "2px dashed #334155",
            color: "#94a3b8",
          }}
        >
          +
        </div>
      )}
    </label>
  );
};

const PushToggle = () => {
  const [perm, setPerm] = useState(currentPermission());
  const [enabling, setEnabling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!isPushSupported()) return null;

  const enable = async () => {
    setEnabling(true);
    setError(null);
    const r = await subscribePush();
    if (!r.ok) {
      setError(
        r.reason === "vapid-not-configured"
          ? "Push not configured on the server yet (Phase 2.6b)"
          : r.reason ?? "failed",
      );
    } else {
      setPerm(currentPermission());
    }
    setEnabling(false);
  };
  const disable = async () => {
    await unsubscribePush();
    setPerm(currentPermission());
  };

  if (perm === "granted") {
    return (
      <div className="meta" style={{ marginBottom: 8, opacity: 0.7 }}>
        Notifications enabled.{" "}
        <button type="button" onClick={disable} style={{ ...iconBtn, marginLeft: 6 }}>
          Disable
        </button>
      </div>
    );
  }
  if (perm === "denied") {
    return (
      <div className="meta" style={{ marginBottom: 8, opacity: 0.6 }}>
        Notifications blocked in browser settings.
      </div>
    );
  }
  return (
    <div style={{ marginBottom: 8 }}>
      <button
        type="button"
        onClick={enable}
        disabled={enabling}
        style={{ ...iconBtn, fontSize: 13 }}
      >
        {enabling ? "…" : "Enable notifications"}
      </button>
      {error && <span className="error" style={{ marginLeft: 8 }}>{error}</span>}
    </div>
  );
};

const Select = ({
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
    style={selectStyle}
  >
    {options.map((o) => (
      <option key={o.value} value={o.value}>
        {o.label}
      </option>
    ))}
  </select>
);

const iconBtn: React.CSSProperties = {
  background: "transparent",
  border: "1px solid #1e293b",
  color: "inherit",
  borderRadius: 6,
  padding: "4px 10px",
  cursor: "pointer",
  fontSize: 12,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid #1e293b",
  background: "#0f172a",
  color: "inherit",
  marginTop: 4,
};

const selectStyle: React.CSSProperties = {
  padding: "6px 8px",
  borderRadius: 6,
  border: "1px solid #1e293b",
  background: "#0f172a",
  color: "inherit",
  fontSize: 13,
};
