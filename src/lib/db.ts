// The sanctioned data path. All dashboard and API queries go through here.
//
// Backed by a local SQLite file (`data.db` at the project root). The seed
// script creates it; `pnpm dev` reads it. Both use the same `getDb()` handle
// below.
//
// Uses Node's built-in `node:sqlite` (stable in Node 22.5+) so there is no
// native compile step on `pnpm install`. Schema is documented in /schema.sql.
//
// Everything Dana's dashboard and the reporting API needs is a function
// exported from this file. Pages and routes should never new up a database
// handle of their own.

// `node:sqlite` is still flagged experimental in Node 22, which means it
// isn't in `module.builtinModules`. Some bundlers (Vite/Vitest in
// particular) lean on that list to decide what to externalize, so a plain
// `import { DatabaseSync } from "node:sqlite"` breaks the test runner.
// `process.getBuiltinModule` skips the bundler entirely — Node hands back
// the real built-in. We keep the `import type` for the type signatures.
import type { DatabaseSync as DatabaseSyncT } from "node:sqlite";
import path from "node:path";

const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as {
  DatabaseSync: typeof DatabaseSyncT;
};
type DatabaseSync = DatabaseSyncT;

const DB_PATH = path.join(process.cwd(), "data.db");

let _db: DatabaseSync | null = null;

/**
 * Returns a singleton SQLite handle. Lazy so that `import`-time side effects
 * don't open a file before the seed has had a chance to create it.
 *
 * Configured with WAL journaling and foreign-key enforcement, both of which
 * are off by default in SQLite and surprise people.
 */
export function getDb(): DatabaseSync {
  if (!_db) {
    _db = new DatabaseSync(DB_PATH);
    _db.exec("PRAGMA journal_mode = WAL");
    _db.exec("PRAGMA foreign_keys = ON");
  }
  return _db;
}

// Tests can swap in an in-memory database; otherwise this is unused.
export function _setDbForTesting(db: DatabaseSync | null): void {
  _db = db;
}

// ----- Row types -------------------------------------------------------------

export type AgentRow = {
  id: string;
  name: string;
  team: string;
  hire_date: string;
  created_at: string;
};

export type CallOutcome = "connected" | "voicemail" | "no_answer" | "busy" | "failed";

export type CallRow = {
  id: string;
  agent_id: string;
  customer_phone: string;
  started_at: string; // ISO 8601
  ended_at: string | null; // ISO 8601, null only for failed
  duration_seconds: number;
  outcome: CallOutcome;
  created_at: string;
};

// ----- Time-window helpers ---------------------------------------------------
//
// Everything Dana cares about is "rolling N days from right now". We compute
// the cutoff in JavaScript and pass it as a parameter rather than using
// SQLite's `datetime('now')`, for two reasons:
//   1. `started_at` is stored as a JavaScript `toISOString()` string with a
//      `Z` suffix and millisecond precision. SQLite's `datetime()` returns a
//      different shape, so string comparisons would be subtly wrong.
//   2. Computing the window in one place keeps the SQL parameterized and
//      makes the tests deterministic — they can freeze "now".

/** ISO 8601 timestamp of a moment `daysAgo` days before `now`. */
function isoDaysBefore(now: Date, daysAgo: number): string {
  return new Date(now.getTime() - daysAgo * 86_400_000).toISOString();
}

/** UTC calendar dates (YYYY-MM-DD), oldest first, ending today. */
function lastNDates(now: Date, n: number): string[] {
  const dates: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86_400_000);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

/** Start-of-day UTC ISO for a YYYY-MM-DD date. */
function startOfDayISO(date: string): string {
  return `${date}T00:00:00.000Z`;
}

// ----- Public query API ------------------------------------------------------

/**
 * The Monday-morning number. Connected calls whose `started_at` falls within
 * the last 7×24 hours from `now` (default: real time).
 *
 * Connected = `outcome === 'connected'`, per the schema. We don't filter
 * zero-duration "misclick" rows — the spec defines the metric by outcome, not
 * by duration, and Dana's operations lead reads the same field.
 *
 * Future-dated rows (which can exist in seed/test data) are excluded by the
 * `started_at <= now` upper bound.
 */
export function getConnectedCallsLast7Days(now: Date = new Date()): number {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c
         FROM calls
        WHERE outcome = 'connected'
          AND started_at >= ?
          AND started_at <= ?`,
    )
    .get(isoDaysBefore(now, 7), now.toISOString()) as { c: number };
  return row.c;
}

export type WeeklyDelta = {
  connected_last_7: number;
  connected_prior_7: number;
  delta_abs: number; // last - prior
  delta_pct: number | null; // null when prior is 0 (no baseline)
  total_last_7: number;
  total_prior_7: number;
  connect_rate_last_7: number; // 0..1, 0 if no calls
  connect_rate_prior_7: number;
};

/** Week-over-week summary for the entire dialer (all agents). */
export function getOverallWeeklyDelta(now: Date = new Date()): WeeklyDelta {
  const db = getDb();
  const nowISO = now.toISOString();
  const w1Start = isoDaysBefore(now, 7);
  const w0Start = isoDaysBefore(now, 14);

  // One pass over the call table, two windows, four counters.
  const row = db
    .prepare(
      `SELECT
         SUM(CASE WHEN outcome = 'connected' AND started_at >= :w1 AND started_at <= :now THEN 1 ELSE 0 END) AS c_last,
         SUM(CASE WHEN                            started_at >= :w1 AND started_at <= :now THEN 1 ELSE 0 END) AS t_last,
         SUM(CASE WHEN outcome = 'connected' AND started_at >= :w0 AND started_at <  :w1   THEN 1 ELSE 0 END) AS c_prior,
         SUM(CASE WHEN                            started_at >= :w0 AND started_at <  :w1   THEN 1 ELSE 0 END) AS t_prior
       FROM calls`,
    )
    .get({ w1: w1Start, w0: w0Start, now: nowISO }) as {
    c_last: number | null;
    t_last: number | null;
    c_prior: number | null;
    t_prior: number | null;
  };

  const cLast = row.c_last ?? 0;
  const cPrior = row.c_prior ?? 0;
  const tLast = row.t_last ?? 0;
  const tPrior = row.t_prior ?? 0;

  return {
    connected_last_7: cLast,
    connected_prior_7: cPrior,
    delta_abs: cLast - cPrior,
    delta_pct: cPrior === 0 ? null : (cLast - cPrior) / cPrior,
    total_last_7: tLast,
    total_prior_7: tPrior,
    connect_rate_last_7: tLast === 0 ? 0 : cLast / tLast,
    connect_rate_prior_7: tPrior === 0 ? 0 : cPrior / tPrior,
  };
}

export type DailyEntry = {
  date: string; // YYYY-MM-DD (UTC)
  connected_count: number;
  total_count: number;
  by_team: Record<string, number>; // team -> connected calls that day
};

/**
 * Daily activity for the last `days` UTC calendar days, oldest first.
 * Zero-filled so callers can render a chart without bookkeeping. Days are
 * UTC-aligned to match how the seed stores timestamps.
 */
export function getDailyActivity(days: number, now: Date = new Date()): DailyEntry[] {
  const db = getDb();
  const dates = lastNDates(now, days);
  const windowStart = startOfDayISO(dates[0]);
  const nowISO = now.toISOString();

  const totals = db
    .prepare(
      `SELECT substr(started_at, 1, 10) AS date,
              SUM(CASE WHEN outcome = 'connected' THEN 1 ELSE 0 END) AS connected_count,
              COUNT(*) AS total_count
         FROM calls
        WHERE started_at >= ? AND started_at <= ?
     GROUP BY date`,
    )
    .all(windowStart, nowISO) as Array<{
    date: string;
    connected_count: number;
    total_count: number;
  }>;

  const teamConnects = db
    .prepare(
      `SELECT substr(c.started_at, 1, 10) AS date, a.team AS team, COUNT(*) AS connected
         FROM calls c
         JOIN agents a ON a.id = c.agent_id
        WHERE c.outcome = 'connected' AND c.started_at >= ? AND c.started_at <= ?
     GROUP BY date, team`,
    )
    .all(windowStart, nowISO) as Array<{ date: string; team: string; connected: number }>;

  const totalsByDate = new Map<string, { connected_count: number; total_count: number }>();
  for (const r of totals) {
    totalsByDate.set(r.date, {
      connected_count: r.connected_count,
      total_count: r.total_count,
    });
  }

  const teamByDate = new Map<string, Record<string, number>>();
  for (const r of teamConnects) {
    if (!teamByDate.has(r.date)) teamByDate.set(r.date, {});
    teamByDate.get(r.date)![r.team] = r.connected;
  }

  return dates.map((date) => ({
    date,
    connected_count: totalsByDate.get(date)?.connected_count ?? 0,
    total_count: totalsByDate.get(date)?.total_count ?? 0,
    by_team: teamByDate.get(date) ?? {},
  }));
}

export type TopAgent = {
  id: string;
  name: string;
  team: string;
  connected_count: number;
};

/** Top N agents by connected calls in the last 7 days. Ties break by name. */
export function getTopAgentsLast7Days(limit: number, now: Date = new Date()): TopAgent[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT a.id, a.name, a.team, COUNT(*) AS connected_count
         FROM calls c
         JOIN agents a ON a.id = c.agent_id
        WHERE c.outcome = 'connected'
          AND c.started_at >= ?
          AND c.started_at <= ?
     GROUP BY a.id
     ORDER BY connected_count DESC, a.name ASC
        LIMIT ?`,
    )
    .all(isoDaysBefore(now, 7), now.toISOString(), limit) as TopAgent[];
}

export type AgentWeekly = {
  id: string;
  name: string;
  team: string;
  hire_date: string;
  connected_last_7: number;
  connected_prior_7: number;
  total_last_7: number;
  total_prior_7: number;
  connect_rate_last_7: number; // 0..1
  delta_abs: number; // last - prior connected
  delta_pct: number | null; // null when prior_7 is 0 (can't compute a rate)
};

/**
 * Per-agent week-over-week roll-up. Includes every agent, even ones with no
 * calls (LEFT JOIN), so Dana can spot newly-hired agents who haven't dialed
 * yet. Sorting is left to the caller.
 */
export function getAgentsWeekly(now: Date = new Date()): AgentWeekly[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT
         a.id, a.name, a.team, a.hire_date,
         SUM(CASE WHEN c.outcome = 'connected' AND c.started_at >= :w1 AND c.started_at <= :now THEN 1 ELSE 0 END) AS c_last,
         SUM(CASE WHEN                            c.started_at >= :w1 AND c.started_at <= :now THEN 1 ELSE 0 END) AS t_last,
         SUM(CASE WHEN c.outcome = 'connected' AND c.started_at >= :w0 AND c.started_at <  :w1 THEN 1 ELSE 0 END) AS c_prior,
         SUM(CASE WHEN                            c.started_at >= :w0 AND c.started_at <  :w1 THEN 1 ELSE 0 END) AS t_prior
       FROM agents a
       LEFT JOIN calls c ON c.agent_id = a.id
   GROUP BY a.id`,
    )
    .all({
      w1: isoDaysBefore(now, 7),
      w0: isoDaysBefore(now, 14),
      now: now.toISOString(),
    }) as Array<{
    id: string;
    name: string;
    team: string;
    hire_date: string;
    c_last: number | null;
    t_last: number | null;
    c_prior: number | null;
    t_prior: number | null;
  }>;

  return rows.map((r) => {
    const cLast = r.c_last ?? 0;
    const cPrior = r.c_prior ?? 0;
    const tLast = r.t_last ?? 0;
    const tPrior = r.t_prior ?? 0;
    return {
      id: r.id,
      name: r.name,
      team: r.team,
      hire_date: r.hire_date,
      connected_last_7: cLast,
      connected_prior_7: cPrior,
      total_last_7: tLast,
      total_prior_7: tPrior,
      connect_rate_last_7: tLast === 0 ? 0 : cLast / tLast,
      delta_abs: cLast - cPrior,
      delta_pct: cPrior === 0 ? null : (cLast - cPrior) / cPrior,
    };
  });
}

export type AgentScorecard = {
  agent: { id: string; name: string; team: string; hire_date: string };
  last_14_days: Array<{ date: string; connected_count: number; total_count: number }>;
  totals: {
    connected_last_7: number;
    connected_prior_7: number;
    connect_rate_last_7: number;
  };
};

/** One agent's 14-day scorecard, or `null` if the id doesn't match an agent. */
export function getAgentScorecard(
  agentId: string,
  now: Date = new Date(),
): AgentScorecard | null {
  const db = getDb();
  const agent = db
    .prepare(`SELECT id, name, team, hire_date FROM agents WHERE id = ?`)
    .get(agentId) as
    | { id: string; name: string; team: string; hire_date: string }
    | undefined;
  if (!agent) return null;

  const dates = lastNDates(now, 14);
  const windowStart = startOfDayISO(dates[0]);
  const nowISO = now.toISOString();

  const daily = db
    .prepare(
      `SELECT substr(started_at, 1, 10) AS date,
              SUM(CASE WHEN outcome = 'connected' THEN 1 ELSE 0 END) AS connected_count,
              COUNT(*) AS total_count
         FROM calls
        WHERE agent_id = ? AND started_at >= ? AND started_at <= ?
     GROUP BY date`,
    )
    .all(agentId, windowStart, nowISO) as Array<{
    date: string;
    connected_count: number;
    total_count: number;
  }>;
  const dailyByDate = new Map(daily.map((d) => [d.date, d]));

  const w1Start = isoDaysBefore(now, 7);
  const w0Start = isoDaysBefore(now, 14);
  const totalsRow = db
    .prepare(
      `SELECT
         SUM(CASE WHEN outcome = 'connected' AND started_at >= :w1 AND started_at <= :now THEN 1 ELSE 0 END) AS c_last,
         SUM(CASE WHEN                            started_at >= :w1 AND started_at <= :now THEN 1 ELSE 0 END) AS t_last,
         SUM(CASE WHEN outcome = 'connected' AND started_at >= :w0 AND started_at <  :w1   THEN 1 ELSE 0 END) AS c_prior
       FROM calls WHERE agent_id = :id`,
    )
    .get({
      id: agentId,
      w1: w1Start,
      w0: w0Start,
      now: nowISO,
    }) as { c_last: number | null; t_last: number | null; c_prior: number | null };
  const cLast = totalsRow.c_last ?? 0;
  const tLast = totalsRow.t_last ?? 0;

  return {
    agent,
    last_14_days: dates.map((date) => ({
      date,
      connected_count: dailyByDate.get(date)?.connected_count ?? 0,
      total_count: dailyByDate.get(date)?.total_count ?? 0,
    })),
    totals: {
      connected_last_7: cLast,
      connected_prior_7: totalsRow.c_prior ?? 0,
      connect_rate_last_7: tLast === 0 ? 0 : cLast / tLast,
    },
  };
}

export type TeamSummary = {
  team: { name: string; agent_count: number };
  last_7_days: { connected_count: number; total_count: number; connect_rate: number };
  agents: Array<{
    id: string;
    name: string;
    connected_count: number;
    total_count: number;
  }>;
};

/** One team's last-7-days roll-up. `null` when no agents exist on that team. */
export function getTeamSummary(teamName: string, now: Date = new Date()): TeamSummary | null {
  const db = getDb();
  const agents = db
    .prepare(`SELECT id, name FROM agents WHERE team = ? ORDER BY name`)
    .all(teamName) as Array<{ id: string; name: string }>;
  if (agents.length === 0) return null;

  const w1Start = isoDaysBefore(now, 7);
  const nowISO = now.toISOString();

  const perAgent = db
    .prepare(
      `SELECT a.id AS id, a.name AS name,
              SUM(CASE WHEN c.outcome = 'connected' AND c.started_at >= :w1 AND c.started_at <= :now THEN 1 ELSE 0 END) AS connected_count,
              SUM(CASE WHEN                            c.started_at >= :w1 AND c.started_at <= :now THEN 1 ELSE 0 END) AS total_count
         FROM agents a
         LEFT JOIN calls c ON c.agent_id = a.id
        WHERE a.team = :team
     GROUP BY a.id
     ORDER BY connected_count DESC, a.name ASC`,
    )
    .all({ team: teamName, w1: w1Start, now: nowISO }) as Array<{
    id: string;
    name: string;
    connected_count: number | null;
    total_count: number | null;
  }>;

  let connectedTotal = 0;
  let totalTotal = 0;
  const agentList = perAgent.map((r) => {
    const c = r.connected_count ?? 0;
    const t = r.total_count ?? 0;
    connectedTotal += c;
    totalTotal += t;
    return { id: r.id, name: r.name, connected_count: c, total_count: t };
  });

  return {
    team: { name: teamName, agent_count: agents.length },
    last_7_days: {
      connected_count: connectedTotal,
      total_count: totalTotal,
      connect_rate: totalTotal === 0 ? 0 : connectedTotal / totalTotal,
    },
    agents: agentList,
  };
}

/** Distinct team names with at least one agent, for the dashboard side-rail. */
export function getTeams(): string[] {
  const db = getDb();
  return (db.prepare(`SELECT DISTINCT team FROM agents ORDER BY team`).all() as Array<{
    team: string;
  }>).map((r) => r.team);
}

// ----- Window helper, exported for callers that need to label charts --------

/**
 * The window the metrics above describe, suitable for `meta` objects on the
 * API responses. End is the call to `new Date()` itself; start is 7d earlier.
 */
export function getWindowMeta(now: Date = new Date(), days = 7) {
  const start = isoDaysBefore(now, days).slice(0, 10);
  const end = now.toISOString().slice(0, 10);
  return {
    generated_at: now.toISOString(),
    window_start: start,
    window_end: end,
  };
}