import { useEffect, useState } from "react";
import {
  apiLogin,
  apiLoginQr,
  apiQuickSetup,
  apiSelectUser,
  apiSetup,
  type LoginOutcome,
} from "./lib/api.ts";
import { setSession, type SessionInfo } from "./lib/session.ts";

type Mode = "login" | "setup" | "quick" | "qr";

interface Props {
  onLoggedIn: (s: SessionInfo) => void;
}

interface SelectorState {
  selectorToken: string;
  homeId: string;
  users: { id: string; displayName: string }[];
}

export const Login = ({ onLoggedIn }: Props) => {
  const [mode, setMode] = useState<Mode>("quick");
  const [login, setLogin] = useState("");
  const [pin, setPin] = useState("");
  const [pairCode, setPairCode] = useState("");
  const [selector, setSelector] = useState<SelectorState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Auto-finish a `?token=&deviceId=` QR landing.
  useEffect(() => {
    const url = new URL(window.location.href);
    const token = url.searchParams.get("token");
    const deviceId = url.searchParams.get("deviceId");
    if (token && deviceId) {
      setMode("qr");
      void wrap(async () => handleOutcome(await apiLoginQr(deviceId, token)));
    }
  }, []);

  const handleOutcome = (outcome: LoginOutcome) => {
    if (outcome.kind === "direct") {
      setSession({
        token: outcome.token,
        homeId: outcome.homeId,
        userId: outcome.userId,
      });
      onLoggedIn({
        token: outcome.token,
        homeId: outcome.homeId,
        userId: outcome.userId,
      });
      return;
    }
    setSelector({
      selectorToken: outcome.selectorToken,
      homeId: outcome.homeId,
      users: outcome.users,
    });
  };

  const wrap = async (fn: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const runLogin = () =>
    wrap(async () => handleOutcome(await apiLogin(login, pin)));
  const runSetup = () =>
    wrap(async () => handleOutcome(await apiSetup(login, pin)));
  const runQuick = () =>
    wrap(async () =>
      handleOutcome(await apiQuickSetup(pairCode ? { pairCode } : {})),
    );

  const pickUser = (userId: string) =>
    wrap(async () => {
      if (!selector) return;
      const r = await apiSelectUser(selector.selectorToken, userId);
      setSession({ token: r.token, homeId: r.homeId, userId: r.userId });
      onLoggedIn({ token: r.token, homeId: r.homeId, userId: r.userId });
    });

  if (selector) {
    return (
      <main>
        <h1>Howler</h1>
        <p style={{ opacity: 0.7 }}>Pick a user:</p>
        {selector.users.map((u) => (
          <button
            key={u.id}
            type="button"
            onClick={() => pickUser(u.id)}
            disabled={busy}
            style={{
              display: "block",
              width: "100%",
              padding: 12,
              borderRadius: 10,
              border: "1px solid #1e293b",
              background: "#111827",
              color: "inherit",
              cursor: "pointer",
              marginBottom: 8,
              textAlign: "left",
              fontSize: 16,
            }}
          >
            {u.displayName}
          </button>
        ))}
        {error && <p className="error">{error}</p>}
        <button
          type="button"
          onClick={() => setSelector(null)}
          style={{ marginTop: 12, background: "transparent", color: "inherit", border: "none", cursor: "pointer", opacity: 0.6 }}
        >
          Back
        </button>
      </main>
    );
  }

  return (
    <main>
      <h1>Howler</h1>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <Tab active={mode === "quick"} onClick={() => setMode("quick")}>
          Quick start
        </Tab>
        <Tab active={mode === "login"} onClick={() => setMode("login")}>
          Log in
        </Tab>
        <Tab active={mode === "setup"} onClick={() => setMode("setup")}>
          Sign up
        </Tab>
      </div>

      {mode === "quick" && (
        <section>
          <p style={{ opacity: 0.7 }}>
            Skip choosing a PIN. Optionally enter a pair code from your dial
            to claim the device in one shot.
          </p>
          <Field
            label="Pair code (optional)"
            value={pairCode}
            onChange={setPairCode}
            placeholder="6 digits"
            maxLength={8}
          />
          <Submit onClick={runQuick} busy={busy} label="Get started" />
        </section>
      )}

      {mode === "login" && (
        <section>
          <Field label="Login" value={login} onChange={setLogin} autoComplete="username" />
          <Field
            label="PIN"
            value={pin}
            onChange={setPin}
            autoComplete="current-password"
            type="password"
          />
          <Submit onClick={runLogin} busy={busy} label="Log in" />
        </section>
      )}

      {mode === "setup" && (
        <section>
          <Field label="Login" value={login} onChange={setLogin} autoComplete="username" />
          <Field
            label="PIN (4+ chars)"
            value={pin}
            onChange={setPin}
            autoComplete="new-password"
            type="password"
          />
          <Submit onClick={runSetup} busy={busy} label="Create account" />
        </section>
      )}

      {mode === "qr" && (
        <section>
          <p>Logging in with QR…</p>
        </section>
      )}

      {error && <p className="error">{error}</p>}
    </main>
  );
};

const Tab = ({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    style={{
      padding: "6px 12px",
      borderRadius: 8,
      border: "1px solid #1e293b",
      background: active ? "#1e293b" : "transparent",
      color: "inherit",
      cursor: "pointer",
    }}
  >
    {children}
  </button>
);

const Field = ({
  label,
  value,
  onChange,
  type = "text",
  ...rest
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  maxLength?: number;
  autoComplete?: string;
}) => (
  <label style={{ display: "block", marginBottom: 12 }}>
    <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>{label}</div>
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: "100%",
        padding: "8px 10px",
        borderRadius: 8,
        border: "1px solid #1e293b",
        background: "#111827",
        color: "inherit",
      }}
      {...rest}
    />
  </label>
);

const Submit = ({
  onClick,
  busy,
  label,
}: {
  onClick: () => void;
  busy: boolean;
  label: string;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={busy}
    style={{
      width: "100%",
      padding: "10px 14px",
      borderRadius: 10,
      border: "none",
      background: "#2563eb",
      color: "white",
      fontWeight: 600,
      cursor: busy ? "default" : "pointer",
      opacity: busy ? 0.6 : 1,
    }}
  >
    {busy ? "…" : label}
  </button>
);
