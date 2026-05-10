import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App.tsx";
import { installInstallPromptListener } from "./lib/install-prompt.ts";
import { initThemeOnce } from "./theme.ts";
import "./styles.css";

// Apply the persisted theme before React mounts so the first paint
// has the right palette — otherwise dark-mode users see a light
// flash for one frame.
initThemeOnce();

// Catch the browser's `beforeinstallprompt` BEFORE React renders so
// the Settings → Add-to-Home-Screen tile can trigger it whenever the
// user navigates there. The event fires once per page-load when
// install criteria are met; missing the firing edge by mounting a
// listener inside Settings would lose the prompt forever on that
// load.
installInstallPromptListener();

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
