import { Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchLabels } from "../lib/api.ts";

// Thin desktop baseline (plan §18 / 2.8c). Hidden on mobile via
// `hidden lg:flex` — the phone layout is primary; the sidebar is
// purely a desktop comfort.

const NAV: Array<{
  label: string;
  to: string;
  // Active match: exact path or any path that starts with `match`.
  match: string;
}> = [
  { label: "Today", to: "/", match: "/" },
  { label: "All tasks", to: "/all", match: "/all" },
  { label: "Settings", to: "/settings", match: "/settings" },
];

export const Sidebar = () => {
  const { pathname } = useLocation();
  const labels = useQuery({ queryKey: ["labels"], queryFn: fetchLabels });
  return (
    <aside
      data-testid="sidebar"
      className="hidden w-60 shrink-0 flex-col gap-5 border-r border-line-soft bg-[#FBF7EC] px-4 py-6 lg:flex"
    >
      <Link to="/" className="font-display text-xl">
        Howler
      </Link>

      <nav className="flex flex-col gap-0.5">
        {NAV.map((n) => {
          const active = n.match === "/"
            ? pathname === "/"
            : pathname.startsWith(n.match);
          return (
            <Link
              key={n.to}
              to={n.to}
              className={`rounded-lg px-3 py-2 text-sm transition-colors ${
                active
                  ? "bg-paper-3 font-semibold text-ink"
                  : "text-ink-2 hover:bg-paper-2"
              }`}
            >
              {n.label}
            </Link>
          );
        })}
      </nav>

      {labels.data && labels.data.length > 0 && (
        <>
          <div className="cap pt-2">Labels</div>
          <div className="flex flex-col gap-1">
            {labels.data.map((l) => (
              <div
                key={l.id}
                className="flex items-center gap-2 px-2 text-xs text-ink-2"
              >
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: l.color ?? "#7A7060" }}
                  aria-hidden
                />
                {l.displayName}
              </div>
            ))}
          </div>
        </>
      )}
    </aside>
  );
};
