import { useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { getSession, type SessionInfo } from "./lib/session.ts";
import { Login } from "./Login.tsx";
import { Dashboard } from "./Dashboard.tsx";
import { TaskDetail } from "./TaskDetail.tsx";
import { ResultTypesManager } from "./ResultTypesManager.tsx";

export const App = () => {
  const [session, setSession] = useState<SessionInfo | null>(getSession);
  if (!session) return <Login onLoggedIn={setSession} />;
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={
            <Dashboard session={session} onLogout={() => setSession(null)} />
          }
        />
        <Route path="/tasks/:taskId" element={<TaskDetail />} />
        <Route path="/settings/result-types" element={<ResultTypesManager />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
};
