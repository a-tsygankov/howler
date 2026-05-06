import { useEffect, useState } from "react";
import {
  apiLogin,
  apiLoginQr,
  apiQuickSetup,
  apiSetup,
} from "./lib/api.ts";
import { setSession, type SessionUser } from "./lib/session.ts";

type Mode = "login" | "setup" | "quick" | "qr";

interface Props {
  onLoggedIn: (u: SessionUser) => void;
}

export const Login = ({ onLoggedIn }: Props) => {
  const [mode, setMode] = useState<Mode>("quick");
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [pairCode, setPairCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Pick up `?token=…&deviceId=…` from a QR scan landing on this page
  // and finish the login-qr exchange automatically.
  useEffect(() => {
    const url = new URL(window.location.href);
    const token = url.searchParams.get("token");
    const deviceId = url.searchParams.get("deviceId");
    if (token && deviceId) {
      setMode("qr");
      void runQr(deviceId, token);
    }
  }, []);

  const finish = (resp: {
    token: string;
    userId: string;
    username: string | null;
  }) => {
    setSession(resp.token, { userId: resp.userId, username: resp.username });
    onLoggedIn({ userId: resp.userId, username: resp.username });
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
    wrap(async () => finish(await apiLogin(username, pin)));
  const runSetup = () =>
    wrap(async () => finish(await apiSetup(username, pin)));
  const runQuick = () =>
    wrap(async () =>
      finish(await apiQuickSetup(pairCode ? { pairCode } : {})),
    );
  const runQr = (deviceId: string, token: string) =>
    wrap(async () => finish(await apiLoginQr(deviceId, token)));

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
          <Field label="Username" value={username} onChange={setUsername} autoComplete="username" />
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
          <Field label="Username" value={username} onChange={setUsername} autoComplete="username" />
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
