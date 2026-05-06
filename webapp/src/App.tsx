import { useState } from "react";
import { getSession, type SessionInfo } from "./lib/session.ts";
import { Login } from "./Login.tsx";
import { Dashboard } from "./Dashboard.tsx";

export const App = () => {
  const [session, setSession] = useState<SessionInfo | null>(getSession);
  if (!session) return <Login onLoggedIn={setSession} />;
  return <Dashboard session={session} onLogout={() => setSession(null)} />;
};
