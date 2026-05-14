// Tests for the metric calculations Dana's reporting depends on.
//
// We exercise db.ts with an in-memory SQLite database that we hand-seed
// with the schema and a few deliberately edge-case rows. The point is to
// pin down the *definition* of each metric (the math, the windowing, the
// tie-breaking) rather than to verify the production data — that changes
// every time the seed script runs.
//
// Why these tests:
//   - The "rolling 7 days from right now" window is the customer-facing
//     contract. Off-by-one on either end (excluding/including the boundary,
//     including future-dated rows) silently breaks Dana's Monday number.
//   - The week-over-week delta needs to handle a zero prior week without
//     dividing by zero — `delta_pct === null` is the agreed-on shape.
//   - Top-agents tie-breaking needs to be stable so the CSV is reproducible.

import { afterEach, describe, expect, it } from "vitest";
// See db.ts for why we go through `process.getBuiltinModule` instead of a
// plain `import` for `node:sqlite`.
import type { DatabaseSync as DatabaseSyncT } from "node:sqlite";
const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as {
  DatabaseSync: typeof DatabaseSyncT;
};
type DatabaseSync = DatabaseSyncT;
import {
  _setDbForTesting,
  getConnectedCallsLast7Days,
  getOverallWeeklyDelta,
  getTopAgentsLast7Days,
  getAgentsWeekly,
} from "./db";

// Fixed "now" so the windows are deterministic.
const NOW = new Date("2026-05-14T12:00:00.000Z");

function iso(daysBeforeNow: number, hour = 12, minute = 0): string {
  const d = new Date(NOW.getTime() - daysBeforeNow * 86_400_000);
  d.setUTCHours(hour, minute, 0, 0);
  return d.toISOString();
}

function buildDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      team TEXT NOT NULL,
      hire_date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE calls (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      customer_phone TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      duration_seconds INTEGER NOT NULL,
      outcome TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `);
  return db;
}

let callSeq = 0;
function insertCall(
  db: DatabaseSync,
  agentId: string,
  startedAt: string,
  outcome: string,
) {
  db.prepare(
    `INSERT INTO calls (id, agent_id, customer_phone, started_at, ended_at, duration_seconds, outcome)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    `call-${callSeq++}`,
    agentId,
    "+15555550100",
    startedAt,
    outcome === "failed" ? null : startedAt,
    outcome === "failed" ? 0 : 60,
    outcome,
  );
}

afterEach(() => {
  _setDbForTesting(null);
});

describe("getConnectedCallsLast7Days", () => {
  it("counts only 'connected' rows within (now-7d, now]", () => {
    const db = buildDb();
    _setDbForTesting(db);
    db.prepare(`INSERT INTO agents VALUES (?,?,?,?,?)`).run(
      "a1",
      "Test Agent",
      "Test Team",
      "2025-01-01",
      NOW.toISOString(),
    );

    // In-window connected rows — these should count.
    insertCall(db, "a1", iso(0), "connected");
    insertCall(db, "a1", iso(3, 9), "connected");
    insertCall(db, "a1", iso(6, 23), "connected");

    // In-window but wrong outcome — should NOT count.
    insertCall(db, "a1", iso(2), "voicemail");
    insertCall(db, "a1", iso(2), "no_answer");

    // Just past the trailing edge — should NOT count. NOW is at 12:00 UTC,
    // so a row at 11:00 UTC 7 days ago is 7d+1h ago, outside the window.
    insertCall(db, "a1", iso(7, 11), "connected");
    insertCall(db, "a1", iso(10), "connected");

    // Future-dated row (seed has a couple of these) — should NOT count.
    const future = new Date(NOW.getTime() + 86_400_000).toISOString();
    insertCall(db, "a1", future, "connected");

    expect(getConnectedCallsLast7Days(NOW)).toBe(3);
  });

  it("returns 0 when the table is empty", () => {
    const db = buildDb();
    _setDbForTesting(db);
    db.prepare(`INSERT INTO agents VALUES (?,?,?,?,?)`).run(
      "a1",
      "Empty",
      "Test",
      "2025-01-01",
      NOW.toISOString(),
    );
    expect(getConnectedCallsLast7Days(NOW)).toBe(0);
  });
});

describe("getOverallWeeklyDelta", () => {
  it("computes WoW delta and connect rates correctly", () => {
    const db = buildDb();
    _setDbForTesting(db);
    db.prepare(`INSERT INTO agents VALUES (?,?,?,?,?)`).run(
      "a1",
      "A",
      "T",
      "2025-01-01",
      NOW.toISOString(),
    );

    // Last 7 days: 4 connected of 10 calls -> 40%
    for (let i = 0; i < 4; i++) insertCall(db, "a1", iso(i + 1, 10), "connected");
    for (let i = 0; i < 6; i++) insertCall(db, "a1", iso(i + 1, 11), "no_answer");
    // Prior 7 days (8..13 days ago): 2 connected of 8 calls -> 25%
    for (let i = 0; i < 2; i++) insertCall(db, "a1", iso(i + 8, 10), "connected");
    for (let i = 0; i < 6; i++) insertCall(db, "a1", iso(i + 8, 11), "no_answer");

    const d = getOverallWeeklyDelta(NOW);
    expect(d.connected_last_7).toBe(4);
    expect(d.connected_prior_7).toBe(2);
    expect(d.delta_abs).toBe(2);
    expect(d.delta_pct).toBeCloseTo(1.0); // doubled
    expect(d.total_last_7).toBe(10);
    expect(d.total_prior_7).toBe(8);
    expect(d.connect_rate_last_7).toBeCloseTo(0.4);
    expect(d.connect_rate_prior_7).toBeCloseTo(0.25);
  });

  it("returns null delta_pct when the prior week was zero", () => {
    const db = buildDb();
    _setDbForTesting(db);
    db.prepare(`INSERT INTO agents VALUES (?,?,?,?,?)`).run(
      "a1",
      "A",
      "T",
      "2025-01-01",
      NOW.toISOString(),
    );
    insertCall(db, "a1", iso(1), "connected");

    const d = getOverallWeeklyDelta(NOW);
    expect(d.connected_last_7).toBe(1);
    expect(d.connected_prior_7).toBe(0);
    expect(d.delta_pct).toBeNull();
    expect(d.connect_rate_prior_7).toBe(0);
  });
});

describe("getTopAgentsLast7Days", () => {
  it("orders by connects desc, ties broken alphabetically by name", () => {
    const db = buildDb();
    _setDbForTesting(db);
    const seedAgent = db.prepare(`INSERT INTO agents VALUES (?,?,?,?,?)`);
    seedAgent.run("a1", "Beth", "X", "2025-01-01", NOW.toISOString());
    seedAgent.run("a2", "Alice", "X", "2025-01-01", NOW.toISOString());
    seedAgent.run("a3", "Carol", "Y", "2025-01-01", NOW.toISOString());

    // Beth and Alice tie at 5 connects; Carol has 3.
    for (let i = 0; i < 5; i++) insertCall(db, "a1", iso(1, i), "connected");
    for (let i = 0; i < 5; i++) insertCall(db, "a2", iso(1, i + 5), "connected");
    for (let i = 0; i < 3; i++) insertCall(db, "a3", iso(1, i + 10), "connected");

    const top = getTopAgentsLast7Days(3, NOW);
    expect(top.map((a) => a.name)).toEqual(["Alice", "Beth", "Carol"]);
    expect(top[0].connected_count).toBe(5);
    expect(top[2].connected_count).toBe(3);
  });
});

describe("getAgentsWeekly", () => {
  it("includes agents with zero calls (LEFT JOIN) and reports a 0 delta", () => {
    const db = buildDb();
    _setDbForTesting(db);
    db.prepare(`INSERT INTO agents VALUES (?,?,?,?,?)`).run(
      "a1",
      "Quiet Person",
      "T",
      "2025-01-01",
      NOW.toISOString(),
    );
    const rows = getAgentsWeekly(NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0].connected_last_7).toBe(0);
    expect(rows[0].total_last_7).toBe(0);
    expect(rows[0].delta_pct).toBeNull();
    expect(rows[0].connect_rate_last_7).toBe(0);
  });
});
