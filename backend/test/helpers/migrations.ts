// Shared SQL-migration splitter + applier used by every integration
// test. Each `*.test.ts` previously inlined its own copy; the
// integration suite's version was upgraded to handle BEGIN/END
// trigger bodies + inline `--` comments (PR #34 + PR #42), but the
// other suites still ran a naive split-on-`;` that broke once a
// migration with trigger bodies showed up. Centralising it here
// means future migrations land in one applier and every test file
// gets the same parsing rules for free.

/// Tokenise a multi-statement SQL string into individual statements.
/// Two pieces of SQLite-syntax-aware parsing the naive
/// `sql.split(";").trim()` couldn't handle:
///
///   1. **BEGIN/END trigger bodies.** A `CREATE TRIGGER … BEGIN …
///      <stmt>; <stmt>; END;` carries internal `;`s that don't
///      terminate the outer statement. We track BEGIN/END nesting
///      and only treat top-level `;`s as terminators.
///
///   2. **Inline `--` comments.** A line like
///      `name TEXT PRIMARY KEY,            -- lowercase, kebab if any`
///      survives line-stripping unless we strip *everything from
///      `--` to end-of-line on each line first. Without this, the
///      whitespace-collapsed result would have the column comment
///      run into the next definition and D1 errors with "incomplete
///      input". We don't try to honour `--` inside string literals
///      (no migration currently uses `--` inside a string).
export const splitSqlStatements = (sql: string): string[] => {
  const stripped = sql
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("--");
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .filter((line) => line.trim().length > 0)
    .join("\n");
  const out: string[] = [];
  let cur = "";
  let depth = 0;
  const tokens = stripped.split(/(\bBEGIN\b|\bEND\b|;)/gi);
  for (const tok of tokens) {
    if (!tok) continue;
    const upper = tok.toUpperCase();
    if (upper === "BEGIN") {
      depth++;
      cur += tok;
    } else if (upper === "END") {
      if (depth > 0) depth--;
      cur += tok;
    } else if (tok === ";") {
      cur += tok;
      if (depth === 0) {
        const trimmed = cur.trim();
        if (trimmed) out.push(trimmed);
        cur = "";
      }
    } else {
      cur += tok;
    }
  }
  const tail = cur.trim();
  if (tail) out.push(tail);
  return out;
};

/// Apply a list of migration SQL strings to the `env.DB` D1 binding.
/// Each string is split via `splitSqlStatements`, every statement is
/// whitespace-collapsed (D1 requires single-line input), and ran
/// in-order. `env` is typed loosely so each test file can pass its
/// own miniflare-injected env without fighting the type system.
export const applyMigrationSql = async (
  db: { exec: (sql: string) => Promise<unknown> },
  migrations: string[],
): Promise<void> => {
  for (const sql of migrations) {
    for (const s of splitSqlStatements(sql)) {
      await db.exec(s.replace(/\s+/g, " "));
    }
  }
};
