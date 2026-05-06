import { useState } from "react";
import { getUser, type SessionUser } from "./lib/session.ts";
import { Login } from "./Login.tsx";
import { Dashboard } from "./Dashboard.tsx";

export const App = () => {
  const [user, setUser] = useState<SessionUser | null>(getUser);
  if (!user) return <Login onLoggedIn={setUser} />;
  return <Dashboard user={user} onLogout={() => setUser(null)} />;
};
