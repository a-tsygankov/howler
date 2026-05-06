import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ackOccurrence,
  apiLogout,
  apiPairConfirm,
  createTask,
  deleteTask,
  fetchPending,
  fetchTasks,
  updateTask,
  type Occurrence,
  type Task,
  type TaskKind,
} from "./lib/api.ts";
import type { SessionUser } from "./lib/session.ts";

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
  user: SessionUser;
  onLogout: () => void;
}

export const Dashboard = ({ user, onLogout }: Props) => {
  const qc = useQueryClient();
  const tasks = useQuery({ queryKey: ["tasks"], queryFn: fetchTasks });
  const pending = useQuery({
    queryKey: ["pending"],
    queryFn: fetchPending,
    refetchInterval: 15_000,
  });

  const ack = useMutation({
    mutationFn: ackOccurrence,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pending"] }),
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

  return (
    <main>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <h1 style={{ margin: 0 }}>Howler</h1>
        <div style={{ fontSize: 13, opacity: 0.7 }}>
          {user.username ?? user.userId.slice(0, 8) + "…"}
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
            tasks={tasks.data ?? []}
            onAck={() => ack.mutate(o.id)}
            busy={ack.isPending && ack.variables === o.id}
          />
        ))}
      </section>

      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 16, margin: "0 0 8px" }}>New task</h2>
        <CreateTaskForm
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
            onDelete={() => {
              if (confirm(`Delete "${t.title}"?`)) del.mutate(t.id);
            }}
            deleting={del.isPending && del.variables === t.id}
            onSaved={() => qc.invalidateQueries({ queryKey: ["tasks"] })}
          />
        ))}
      </section>

      <PairDevice />
    </main>
  );
};

const PairDevice = () => {
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(
    null,
  );
  const m = useMutation({
    mutationFn: apiPairConfirm,
    onSuccess: () => {
      setMsg({ kind: "ok", text: "Device paired." });
      setCode("");
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
          style={{
            flex: 1,
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid #1e293b",
            background: "#0f172a",
            color: "inherit",
          }}
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

const TaskRow = ({
  task,
  onDelete,
  deleting,
  onSaved,
}: {
  task: Task;
  onDelete: () => void;
  deleting: boolean;
  onSaved: () => void;
}) => {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [priority, setPriority] = useState(task.priority);
  const m = useMutation({
    mutationFn: () =>
      updateTask(task.id, { title: title.trim(), priority }),
    onSuccess: () => {
      setEditing(false);
      onSaved();
    },
  });

  if (editing) {
    return (
      <div
        className="task"
        style={{ display: "grid", gap: 6 }}
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={{
            padding: "6px 8px",
            borderRadius: 6,
            border: "1px solid #1e293b",
            background: "#0f172a",
            color: "inherit",
          }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="meta">priority</span>
          <select
            value={priority}
            onChange={(e) => setPriority(parseInt(e.target.value, 10))}
            style={{
              padding: "4px 6px",
              borderRadius: 6,
              border: "1px solid #1e293b",
              background: "#0f172a",
              color: "inherit",
            }}
          >
            {[0, 1, 2, 3].map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={() => setEditing(false)}
            style={iconBtn}
          >
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

const iconBtn: React.CSSProperties = {
  background: "transparent",
  border: "1px solid #1e293b",
  color: "inherit",
  borderRadius: 6,
  padding: "4px 10px",
  cursor: "pointer",
  fontSize: 12,
};

const PendingCard = ({
  occurrence,
  tasks,
  onAck,
  busy,
}: {
  occurrence: Occurrence;
  tasks: Task[];
  onAck: () => void;
  busy: boolean;
}) => {
  const task = tasks.find((t) => t.id === occurrence.taskId);
  return (
    <div
      className="task"
      style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
    >
      <div>
        <div>{task?.title ?? "(unknown task)"}</div>
        <div className="meta">due {fmtDue(occurrence.dueAt)}</div>
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

const CreateTaskForm = ({ onCreated }: { onCreated: () => void }) => {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<TaskKind>("DAILY");
  const [times, setTimes] = useState("09:00");
  const [intervalDays, setIntervalDays] = useState(7);
  const [deadlineMins, setDeadlineMins] = useState(60);
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
    const base = { title: title.trim(), kind };
    if (kind === "DAILY") {
      const arr = times
        .split(/[, ]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      create.mutate({ ...base, times: arr });
    } else if (kind === "PERIODIC") {
      create.mutate({ ...base, intervalDays });
    } else {
      const due = Math.floor(Date.now() / 1000) + deadlineMins * 60;
      create.mutate({ ...base, deadlineHint: due });
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

      {kind === "DAILY" && (
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
      {kind === "PERIODIC" && (
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
      {kind === "ONESHOT" && (
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

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid #1e293b",
  background: "#0f172a",
  color: "inherit",
  marginTop: 4,
};
