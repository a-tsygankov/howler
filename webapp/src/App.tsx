import { useQuery } from "@tanstack/react-query";
import { fetchHealth, fetchTasks } from "./lib/api.ts";

export const App = () => {
  const health = useQuery({ queryKey: ["health"], queryFn: fetchHealth });
  const tasks = useQuery({ queryKey: ["tasks"], queryFn: fetchTasks });

  return (
    <main>
      <h1>Howler</h1>
      <p style={{ opacity: 0.7, marginTop: -8 }}>
        Phase 0 scaffold — see <code>handoff.md</code>.
      </p>

      <section style={{ marginTop: 24 }}>
        <strong>API health:</strong>{" "}
        {health.isLoading ? "checking…" : health.isError ? (
          <span className="error">unreachable</span>
        ) : (
          <span>ok</span>
        )}
      </section>

      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 18, margin: "0 0 12px" }}>Tasks</h2>
        {tasks.isLoading && <div className="empty">Loading…</div>}
        {tasks.isError && <div className="error">Failed to load tasks.</div>}
        {tasks.data?.length === 0 && (
          <div className="empty">No tasks yet.</div>
        )}
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
