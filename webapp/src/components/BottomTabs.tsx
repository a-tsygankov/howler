import { Link, useLocation } from "react-router-dom";
import { Icon, type IconName } from "./Icon.tsx";

// Mobile-only floating pill nav (design canvas: BottomTabs). The
// desktop sidebar handles navigation on lg+ viewports — see
// Sidebar.tsx and the lg:hidden gate below.

interface Tab {
  to: string;
  match: (pathname: string) => boolean;
  icon: IconName;
  label: string;
  testid: string;
}

const TABS: Tab[] = [
  {
    to: "/",
    match: (p) => p === "/",
    icon: "home",
    label: "Today",
    testid: "tab-today",
  },
  {
    to: "/all",
    match: (p) => p === "/all" || p.startsWith("/tasks"),
    icon: "calendar",
    label: "All",
    testid: "tab-all",
  },
  {
    to: "/settings",
    match: (p) => p.startsWith("/settings"),
    icon: "more",
    label: "Settings",
    testid: "tab-settings",
  },
];

export const BottomTabs = () => {
  const { pathname } = useLocation();
  return (
    <nav
      data-testid="bottom-tabs"
      aria-label="Main"
      className="fixed bottom-3 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-full border border-line bg-paper/95 px-2 py-1.5 shadow-tabbar backdrop-blur-md lg:hidden"
    >
      {TABS.map((t) => {
        const active = t.match(pathname);
        return (
          <Link
            key={t.to}
            to={t.to}
            data-testid={t.testid}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-colors ${
              active
                ? "bg-ink text-paper"
                : "text-ink-2 hover:text-ink"
            }`}
          >
            <Icon name={t.icon} size={14} />
            <span className="font-medium">{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
};
