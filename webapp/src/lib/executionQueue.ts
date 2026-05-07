// Offline-first execution queue. The user marks a task done; the
// SPA generates a stable id, drops the event in localStorage, then
// best-effort POSTs to /api/tasks/:id/complete. If the network
// is flaky or the worker is down, the row stays in the queue and
// gets retried on the next flush. INSERT OR IGNORE on the server
// makes replays harmless — same id, same execution.
//
// Retry policy: per-event attempt count is kept in the queue.
// Once attempts >= MAX_ATTEMPTS the row is parked (still in the
// queue, still visible in the UI as "queued") until the next app
// start clears the in-memory parked set. This is intentional —
// we don't want to hammer a broken backend forever, but we also
// don't want the user to think their work is lost.

import { callJson } from "./api.ts";

const STORAGE_KEY = "howler.executionQueue.v1";
const MAX_ATTEMPTS = 5;

export interface QueuedExecution {
  // 32-hex matches the server's id format expectation.
  id: string;
  taskId: string;
  ts: number; // epoch seconds
  resultValue?: number | null;
  notes?: string | null;
  // Bookkeeping — never sent to the server.
  attempts: number;
  // Optional cached display fields so the UI can render the row
  // before/after sync without re-fetching.
  taskTitle?: string;
  resultUnit?: string | null;
}

// Server response shape from POST /api/tasks/:id/complete.
export interface CompletionResponse {
  id: string;
  taskId: string;
  ts: number;
  resultValue: number | null;
  resultUnit: string | null;
  notes: string | null;
}

const newId = (): string => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
};

const readQueue = (): QueuedExecution[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as QueuedExecution[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeQueue = (q: QueuedExecution[]): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(q));
  } catch {
    /* quota — drop silently; the queue cap below makes this rare */
  }
};

// Attempt counters reset on every app load (see why the parked set
// is module-level rather than persisted) — this is the "until app
// restart" semantics in the user spec.
const parkedThisSession = new Set<string>();

export const queueExecution = (
  ev: Omit<QueuedExecution, "attempts">,
): QueuedExecution => {
  const next: QueuedExecution = { ...ev, attempts: 0 };
  const q = readQueue();
  q.push(next);
  writeQueue(q);
  return next;
};

export const removeFromQueue = (id: string): void => {
  writeQueue(readQueue().filter((e) => e.id !== id));
};

export const listQueue = (): QueuedExecution[] => readQueue();

export const queuedForTask = (taskId: string): QueuedExecution[] =>
  readQueue().filter((e) => e.taskId === taskId);

export const isParked = (id: string): boolean => parkedThisSession.has(id);

const sendOne = async (ev: QueuedExecution): Promise<void> => {
  const body = {
    id: ev.id,
    ts: ev.ts,
    ...(ev.resultValue !== undefined ? { resultValue: ev.resultValue } : {}),
    ...(ev.notes !== undefined ? { notes: ev.notes } : {}),
  };
  await callJson("POST", `/tasks/${ev.taskId}/complete`, body);
};

const bumpAttempts = (id: string): void => {
  const q = readQueue();
  const ix = q.findIndex((e) => e.id === id);
  if (ix < 0) return;
  q[ix]!.attempts++;
  if (q[ix]!.attempts >= MAX_ATTEMPTS) parkedThisSession.add(id);
  writeQueue(q);
};

// Generate + queue + try once. Returns immediately on success or
// when the first send fails (the queue still has the event for the
// flusher to retry). Caller can await this to know whether the
// task is "done" from the user's POV — the queue persistence makes
// it eventually-done either way.
export const completeTask = async (input: {
  taskId: string;
  resultValue?: number | null;
  notes?: string | null;
  taskTitle?: string;
  resultUnit?: string | null;
}): Promise<{
  id: string;
  status: "synced" | "queued";
}> => {
  const ev: QueuedExecution = {
    id: newId(),
    taskId: input.taskId,
    ts: Math.floor(Date.now() / 1000),
    resultValue: input.resultValue ?? null,
    notes: input.notes ?? null,
    attempts: 0,
    ...(input.taskTitle !== undefined ? { taskTitle: input.taskTitle } : {}),
    ...(input.resultUnit !== undefined ? { resultUnit: input.resultUnit } : {}),
  };
  // Persist first so a crash mid-fetch doesn't lose the event.
  const q = readQueue();
  q.push(ev);
  writeQueue(q);
  try {
    await sendOne(ev);
    removeFromQueue(ev.id);
    return { id: ev.id, status: "synced" };
  } catch {
    bumpAttempts(ev.id);
    return { id: ev.id, status: "queued" };
  }
};

// Drain the queue: try each non-parked row once. Returns the count
// that synced. Called on app start and on a periodic interval
// while the dashboard is open.
export const flushQueue = async (): Promise<number> => {
  let synced = 0;
  for (const ev of readQueue()) {
    if (parkedThisSession.has(ev.id)) continue;
    try {
      await sendOne(ev);
      removeFromQueue(ev.id);
      synced++;
    } catch {
      bumpAttempts(ev.id);
    }
  }
  return synced;
};
