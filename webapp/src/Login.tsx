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
import { Btn } from "./components/Buttons.tsx";

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

  // Auto-finish a `?token=…&deviceId=…` QR landing.
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

  const runLogin = () => wrap(async () => handleOutcome(await apiLogin(login, pin)));
  const runSetup = () => wrap(async () => handleOutcome(await apiSetup(login, pin)));
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
      <main
        data-testid="user-picker"
        className="paper-grain mx-auto min-h-screen max-w-md px-6 py-10"
      >
        <h1 className="font-display text-3xl">Howler</h1>
        <p className="cap mt-2 mb-4">pick a user</p>
        <div className="flex flex-col gap-2">
          {selector.users.map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={() => pickUser(u.id)}
              disabled={busy}
              className="rounded-lg border border-line bg-paper-2 p-3 text-left text-base hover:bg-paper-3 disabled:opacity-50"
            >
              {u.displayName}
            </button>
          ))}
        </div>
        {error && (
          <p className="error mt-3" data-testid="login-error">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={() => setSelector(null)}
          className="mt-5 text-sm text-ink-3 hover:text-ink-2"
        >
          ← Back
        </button>
      </main>
    );
  }

  return (
    <main
      data-testid="login-screen"
      className="paper-grain mx-auto min-h-screen max-w-md px-6 py-10"
    >
      <h1 className="font-display text-3xl">Howler</h1>
      <p className="cap mt-2">a household task tracker</p>

      <div className="mt-6 inline-flex rounded-full border border-line bg-paper-2 p-0.5">
        {(["quick", "login", "setup"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              mode === m
                ? "bg-ink text-paper"
                : "text-ink-2 hover:text-ink"
            }`}
          >
            {m === "quick" ? "Quick start" : m === "login" ? "Log in" : "Sign up"}
          </button>
        ))}
      </div>

      {mode === "quick" && (
        <section className="mt-6">
          <p className="text-sm text-ink-2">
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
          <Btn
            variant="primary"
            size="block"
            onClick={runQuick}
            disabled={busy}
            className="mt-3"
          >
            {busy ? "…" : "Get started"}
          </Btn>
        </section>
      )}

      {mode === "login" && (
        <section className="mt-6">
          <Field label="Login" value={login} onChange={setLogin} autoComplete="username" />
          <Field
            label="PIN"
            value={pin}
            onChange={setPin}
            autoComplete="current-password"
            type="password"
          />
          <Btn
            variant="primary"
            size="block"
            onClick={runLogin}
            disabled={busy}
            className="mt-3"
          >
            {busy ? "…" : "Log in"}
          </Btn>
        </section>
      )}

      {mode === "setup" && (
        <section className="mt-6">
          <Field label="Login" value={login} onChange={setLogin} autoComplete="username" />
          <Field
            label="PIN (4+ chars)"
            value={pin}
            onChange={setPin}
            autoComplete="new-password"
            type="password"
          />
          <Btn
            variant="primary"
            size="block"
            onClick={runSetup}
            disabled={busy}
            className="mt-3"
          >
            {busy ? "…" : "Create account"}
          </Btn>
        </section>
      )}

      {mode === "qr" && (
        <section className="mt-6">
          <p className="font-serif text-base">Logging in with QR…</p>
        </section>
      )}

      {error && (
        <p className="error mt-3" data-testid="login-error">
          {error}
        </p>
      )}
    </main>
  );
};

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
  <label className="mt-3 block">
    <span className="cap mb-1 block">{label}</span>
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-md border border-line bg-paper px-3 py-2 text-sm focus:border-ink focus:outline-none"
      {...rest}
    />
  </label>
);
