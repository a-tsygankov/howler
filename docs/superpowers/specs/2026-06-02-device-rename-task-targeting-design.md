# Device rename + task targeting — design

**Date:** 2026-06-02
**Status:** Approved (brainstorming) — pending spec review, then implementation plan.

## Goal

Four user-facing capabilities:

1. **Rename a device** from the web app. The rename bumps the home
   `update_counter` and the new name reaches the device(s) in the home.
2. **Assign a task to a device or a user** (on create or edit). Any
   change to a task's definition bumps the home `update_counter`.
   - Assigned to a **device** ⇒ shared between all users.
   - Assigned to a **user** ⇒ only that user (or an admin) can see,
     complete, or edit it.
3. **Devices show on their Today screen only tasks assigned to them.**
   Everything else they can see stays on the All screen.
4. **The web app shows on Today all tasks except those assigned to
   another user** — device-assigned tasks still appear.

## Decisions (locked during brainstorming)

- **Scope includes firmware.** The dial displays its new name and its
  Today screen filters to device-assigned tasks. Native tests updated.
  (Breaks the firmware freeze in `handoff.md` deliberately, per user.)
- **Exclusive-group assignment.** A task targets either a set of users
  *or* a set of devices, never both. `is_private` is replaced by "has
  user targets."
- **Privacy = assignee + admin.** A user-assigned task is visible /
  completable / editable only by its assignee(s) and any
  `users.is_admin = 1` user. The standalone "Private" checkbox is
  removed.
- **"admin"** means `users.is_admin` (the only admin concept in the
  codebase, migration 0014).

## The unified model

A task is in exactly one of three assignment modes:

| Mode | Stored as | Visible to | Edit / complete | On a device's Today | On web Today |
|---|---|---|---|---|---|
| **Everyone** | no assignment rows | all users in home | all users | no device | yes |
| **Devices** (1+) | `task_device_assignments` rows | all users (shared) | all users | only the targeted device(s) | yes |
| **Users** (1+) | `task_assignments` rows (exists today) | those users + `is_admin` | those users + `is_admin` | never | only for those users (+ admin) |

Notes:

- **`tasks.is_private`** stops being user-facing. The task service keeps
  it in sync (`1` iff the task has ≥1 user-assignee, else `0`) so any
  legacy reader stays correct, but the assignment tables are
  authoritative.
- **Exclusivity** (users XOR devices) is enforced in the task service:
  if a save carries both non-empty user-assignees and device-assignees,
  return `400`.
- **Web Today keeps its existing urgency filter** (Urgent + Coming-up;
  Hidden excluded). The new rule layers the *visibility* predicate on
  top. The urgency filter is what still distinguishes Today from All on
  the web; "all tasks except another user's" describes visibility, not
  "ignore urgency."

### Visibility predicate (single source of truth)

A shared helper produces the SQL predicate / permission check for a
principal:

- **User principal** `(userId, isAdmin)` — a task is visible iff:
  `isAdmin` **OR** it has no rows in `task_assignments` **OR** `userId`
  is among its `task_assignments`.
- **Device principal** `(deviceId)` — a task is visible iff it has no
  rows in `task_assignments` (i.e., it is shared). The device's **Today**
  subset is the further restriction `EXISTS task_device_assignments
  (task_id, deviceId)`.

Applied consistently in: `GET /api/dashboard`, `GET /api/tasks` (list),
`GET /api/tasks/:id`, `PATCH /api/tasks/:id`, `DELETE /api/tasks/:id`,
`POST /api/tasks/:id/complete`, and `GET /api/occurrences/pending` +
`POST /api/occurrences/:id/ack`. Edit/complete on a not-visible task
returns `404` (same shape as wrong-home today) so visibility can't be
probed.

## 1. Data model + migration `0017`

`backend/migrations/0017_device_name_and_assignment.sql`:

- `ALTER TABLE devices ADD COLUMN name TEXT;` (nullable; display falls
  back to `hw_model` / serial).
- `CREATE TABLE task_device_assignments (task_id TEXT NOT NULL, device_id
  TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (task_id,
  device_id));` + `CREATE INDEX task_device_assignments_device_idx ON
  task_device_assignments(device_id);` — mirrors `task_assignments`.
- Counter triggers (matching the 0012 style):
  - `task_device_assignments` INSERT + DELETE → bump home counter via
    `(SELECT home_id FROM tasks WHERE id = NEW/OLD.task_id)`.
  - `devices` **INSERT** → bump (a newly paired dial is now
    home-visible and assignable).
  - `devices` **UPDATE OF name** → bump (rename). Scoped to the `name`
    column so the frequent `last_seen_at` writes do **not** churn the
    counter — same care 0012 takes for `schedules`.
- Mirror the column + table into `backend/src/db/schema.ts`
  (`devices.name`, `taskDeviceAssignments`).

## 2. Backend API

- **Rename:** `PATCH /api/devices/:id` (requireUser) body `{ name:
  string(1..40) | null }`. Same-home check (`404` otherwise); sets
  `name` + `updated_at`; the trigger bumps the counter. The `Device`
  DTO gains `name`. `GET /api/devices` returns it.
- **Dial self-identity:** `GET /api/devices/me` (requireDevice) →
  `{ id, name, serial, hwModel, fwVersion }`. Lets the dial show its
  name on the About screen.
- **Task assignment:**
  - `CreateTaskSchema` / `UpdateTaskSchema` gain `assignedDevices:
    Hex32[]` alongside the existing `assignees` (users). `isPrivate`
    stays accepted for back-compat but is derived/ignored.
  - Enforce XOR (both non-empty ⇒ `400`).
  - A `replaceDeviceAssignments` sibling to the existing
    `replaceAssignments` validates device ids belong to the home,
    writes the join rows, and keeps `tasks.is_private` in sync
    (`1` iff user-assignees present, else `0`).
  - `GET /api/tasks/:id` returns `assignees` + `assignedDevices`.
- **Dashboard tagging:** rows gain `assignedToThisDevice` (computed for
  the device token; absent/false for user tokens) and
  `assignedUserIds` / `assignedDeviceIds` (for webapp display). The
  device-token dashboard returns only shared tasks (predicate above).

## 3. Firmware (native-tested)

- `domain/DashboardItem.h`: add `bool assignedToThisDevice = false;`,
  parsed from the dashboard payload in `WifiNetwork::fetchDashboard`.
- `application/SyncService.cpp` `runRound()` Today/All split changes:
  **Today** (`dashboard_`) = items where `assignedToThisDevice &&
  urgency != Hidden`; **All** (`allTasks_`) = all returned (shared)
  items. (Today the split is purely `urgency != Hidden`.)
- New `domain/DeviceIdentity.h` (`{ id, name, serial, hwModel }`) +
  `fetchDeviceIdentity` port (`Ports.h`) + `WifiNetwork`
  implementation (`GET /api/devices/me`); store on `App`; the About
  screen's `dev` row in `screen_settings.cpp` shows the name with the
  id-tail as fallback.
- Tests: extend `test/test_domain/test_dashboard_model.cpp` and
  `test/test_application/test_sync_service.cpp` for the new split; add a
  device-identity parse test. Update `stubs.h` network stub for the new
  port.

## 4. Webapp

- **Rename UI** in `DevicesBlock` (Settings → Devices) — inline edit
  mirroring `HomeNameField` / `UserRow`. `SyncLogBlock` shows the name
  too. Display `d.name || d.hwModel || "Unnamed device"`.
- **3-mode segmented control** — *Everyone* / *Users* / *Devices* —
  replacing the single assignee `<select>` and the "Private" checkbox,
  in `CreateTaskForm`, the `TaskRow` inline editor, and `TaskDetail`.
  *Users* and *Devices* are multi-select chips.
- **`api.ts`:** `Device.name`; `renameDevice(id, name)`;
  `assignedDevices` on `CreateTaskInput` / `UpdateTaskInput`;
  `assignedDevices` on `fetchTask`; `assignedUserIds` /
  `assignedDeviceIds` on `DashboardItem`. Web Today/All need no client
  filtering — server filters by token identity; admin sees all.

## Tests

- **Backend integration:** visibility matrix (user A cannot see user
  B's task; admin sees all; device sees only shared tasks and tags its
  own); rename bumps counter; (un)assignment bumps counter; XOR
  rejection (`400`); complete/edit permission enforced (`404` for
  not-visible); `GET /api/devices/me`.
- **Firmware native:** dashboard Today/All split by
  `assignedToThisDevice`; device-identity parse.

## Behavior changes to call out

- Existing **user-assigned** tasks become genuinely private now —
  previously every home member saw them (privacy was stored but never
  enforced in queries).
- Existing `is_private = 1` tasks with **no** user-assignees become
  *Everyone / shared* (no enforcement existed before, so no regression
  in practice).

## Out of scope / follow-ups

- Per-device admin or device-level permissions — a device token has no
  admin concept; it sees shared tasks only.
- Reassigning a device's tasks when a device is revoked — orphaned
  `task_device_assignments` rows are harmless (the task simply stops
  appearing on any device Today); a GC pass can be a later cleanup.
