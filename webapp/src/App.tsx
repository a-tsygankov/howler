import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiLogout, fetchHealth, fetchTasks } from "./lib/api.ts";
import { getUser, type SessionUser } from "./lib/session.ts";
import { Login } from "./Login.tsx";

export const App = () => {
  const [user, setUser] = useState<SessionUser | null>(getUser);

  if (!user) return <Login onLoggedIn={setUser} />;
  return <Dashboard user={user} onLogout={() => setUser(null)} />;
};

const Dashboard = ({
  user,
  onLogout,
}: {
  user: SessionUser;
  onLogout: () => void;
}) => {
  const health = useQuery({ queryKey: ["health"], queryFn: fetchHealth });
  const tasks = useQuery({ queryKey: ["tasks"], queryFn: fetchTasks });

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
        <strong>API health:</strong>{" "}
        {health.isLoading ? (
          "checking…"
        ) : health.isError ? (
          <span className="error">unreachable</span>
        ) : (
          <span>ok</span>
        )}
      </section>

      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 18, margin: "0 0 12px" }}>Tasks</h2>
        {tasks.isLoading && <div className="empty">Loading…</div>}
        {tasks.isError && <div className="error">{(tasks.error as Error).message}</div>}
        {tasks.data?.length === 0 && <div className="empty">No tasks yet.</div>}
        {tasks.data?.map((t) => (
          <div className="task" key={t.id}>
            <div>{t.title}</div>
            <div className="meta">
              {t.kind} · priority {t.priority}
            </div>
          </div>
        ))}
      </section>
    </main>
  );
};
