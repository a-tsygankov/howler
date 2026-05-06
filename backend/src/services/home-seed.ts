import { clock } from "../clock.ts";
// Default labels + TaskResults seeded into every new home (plan §6.4).

import type { D1UnitOfWork } from "../repos/d1/unit-of-work.ts";
import { newUuid } from "../domain/ids.ts";

interface SeedLabel {
  display_name: string;
  color: string | null;
  sort_order: number;
}

const DEFAULT_LABELS: SeedLabel[] = [
  { display_name: "Pets", color: "#a78bfa", sort_order: 10 },
  { display_name: "Chores", color: "#60a5fa", sort_order: 20 },
  { display_name: "Personal", color: "#34d399", sort_order: 30 },
  { display_name: "Work", color: "#f59e0b", sort_order: 40 },
];

interface SeedResult {
  display_name: string;
  unit_name: string;
  min_value: number | null;
  max_value: number | null;
  step: number;
  default_value: number | null;
  use_last_value: 0 | 1;
  sort_order: number;
}

interface SeedTemplate {
  display_name: string;
  description: string;
  rule_json: string;
  sort_order: number;
}

const DEFAULT_SCHEDULE_TEMPLATES: SeedTemplate[] = [
  {
    display_name: "3 meals/day",
    description: "Fires at 08:00, 13:00, 19:00",
    rule_json: JSON.stringify({ version: 1, kind: "DAILY", times: ["08:00", "13:00", "19:00"] }),
    sort_order: 10,
  },
  {
    display_name: "Morning routine",
    description: "Once a day at 07:00",
    rule_json: JSON.stringify({ version: 1, kind: "DAILY", times: ["07:00"] }),
    sort_order: 20,
  },
  {
    display_name: "Evening routine",
    description: "Once a day at 21:00",
    rule_json: JSON.stringify({ version: 1, kind: "DAILY", times: ["21:00"] }),
    sort_order: 30,
  },
  {
    display_name: "Weekly",
    description: "Every 7 days",
    rule_json: JSON.stringify({ version: 1, kind: "PERIODIC", intervalDays: 7 }),
    sort_order: 40,
  },
  {
    display_name: "Monthly",
    description: "Every 30 days",
    rule_json: JSON.stringify({ version: 1, kind: "PERIODIC", intervalDays: 30 }),
    sort_order: 50,
  },
];

const DEFAULT_TASK_RESULTS: SeedResult[] = [
  { display_name: "Count", unit_name: "times", min_value: 0, max_value: null, step: 1, default_value: null, use_last_value: 1, sort_order: 10 },
  { display_name: "Grams", unit_name: "gr",    min_value: 0, max_value: null, step: 10, default_value: null, use_last_value: 1, sort_order: 20 },
  { display_name: "Minutes", unit_name: "min", min_value: 0, max_value: 240,  step: 5,  default_value: null, use_last_value: 1, sort_order: 30 },
  { display_name: "Rating", unit_name: "star", min_value: 1, max_value: 5,    step: 1,  default_value: null, use_last_value: 0, sort_order: 40 },
  { display_name: "Percent", unit_name: "%",   min_value: 0, max_value: 100,  step: 5,  default_value: null, use_last_value: 1, sort_order: 50 },
];

export const seedHomeDefaults = async (
  db: D1Database,
  homeId: string,
  nowSec: number,
): Promise<void> => {
  const labelStmts = DEFAULT_LABELS.map((l) =>
    db
      .prepare(
        `INSERT INTO labels (id, home_id, display_name, color, system, sort_order, created_at, updated_at, is_deleted)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?, 0)`,
      )
      .bind(newUuid(), homeId, l.display_name, l.color, l.sort_order, nowSec, nowSec),
  );
  const resultStmts = DEFAULT_TASK_RESULTS.map((r) =>
    db
      .prepare(
        `INSERT INTO task_results (id, home_id, display_name, unit_name, min_value, max_value, step, default_value, use_last_value, system, sort_order, created_at, updated_at, is_deleted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 0)`,
      )
      .bind(
        newUuid(),
        homeId,
        r.display_name,
        r.unit_name,
        r.min_value,
        r.max_value,
        r.step,
        r.default_value,
        r.use_last_value,
        r.sort_order,
        nowSec,
        nowSec,
      ),
  );
  const templateStmts = DEFAULT_SCHEDULE_TEMPLATES.map((t) =>
    db
      .prepare(
        `INSERT INTO schedule_templates (id, home_id, display_name, description, rule_json, system, sort_order, created_at, updated_at, is_deleted)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, 0)`,
      )
      .bind(
        newUuid(),
        homeId,
        t.display_name,
        t.description,
        t.rule_json,
        t.sort_order,
        nowSec,
        nowSec,
      ),
  );
  await db.batch([...labelStmts, ...resultStmts, ...templateStmts]);
};

// Used by audit.ts for context: emits the resolved home id when known.
export { D1UnitOfWork };
