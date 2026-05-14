# ArmorHQ Dashboard — Dana's Monday morning

Built for Dana, head of sales at a 200-person dialer floor, who asked for
something other than another spreadsheet. The whole product is one page at
`/`, plus four JSON/CSV endpoints that Dana's account manager and the
customer-success team can pull from.

---

## Run it

```bash
nvm use            # picks up .nvmrc — Node 22+
pnpm install
pnpm seed          # writes ~3,000 deterministic calls into data.db
pnpm dev           # http://localhost:3000
pnpm test          # vitest, src/lib/db.test.ts
pnpm typecheck && pnpm lint && pnpm build  # all clean
```

Dataset is reseed-safe: timestamps are anchored to "now" so the rolling
7-day window always has data, regardless of when you run the seed.

---

## What's on the dashboard, and why

Dana asked two questions:

1. _"Are my agents getting better or worse, week to week?"_
2. _"Who should I be talking to on Monday morning?"_

The page is built around those two questions in that order.

### Hero — the Monday number

The big mono number at the top is **connected calls in the rolling last 7
days**. It's:

- Live-queried out of `data.db` on every request (no caching, `force-dynamic`).
- Computed strictly by the spec: `outcome = 'connected'` AND
  `started_at` in `(now - 7 days, now]`. Misclick rows with
  `duration_seconds = 0` still count — the metric is defined by outcome,
  not duration, and Dana's ops lead will be reading the same field.
- Future-dated rows (the seed has two as a smoke-test) are excluded by the
  upper bound.

It carries an arrow + signed delta versus the prior 7 days. That's the
"better or worse" answer for the whole dialer.

### Connect rate + total dials

Two smaller cards. Connect rate is the right counter-metric for "did we
just dial more, or are we actually converting more?". Total dials is the
volume context for the same WoW comparison.

### 28-day daily chart

Bars per UTC day, last 28. The trailing 7 are accent-coloured so Dana can
eyeball "this week against the three before it" without having to read
labels. SVG, server-rendered, scales to 375px wide.

### "Who to talk to on Monday morning"

Three explicit columns — this is the answer to Dana's second question.
Each agent gets at most one status, assigned in priority order:

| Status         | Rule                                                              | Conversation                       |
| -------------- | ----------------------------------------------------------------- | ---------------------------------- |
| **Declining**  | `delta_pct <= -30%` AND `connected_prior_7 >= 10`                 | Coach this week                    |
| **New hire**   | hired in the last 30 days                                         | Check ramp progress                |
| **Quiet**      | total dials this week `< 20` (and not a new hire)                 | Why weren't they dialing?          |
| **Top performer** | top 3 by connects this week                                    | Recognize                          |
| **Steady**     | none of the above                                                 | Nothing to do                      |

The `>= 10 prior connects` floor on "declining" is deliberate. Without it,
any agent who happened to log 1 connect this week vs 3 last week would get
flagged as "down 67%". That's noise Dana would learn to ignore.

The full roster sits below the watchlist, sorted by the same priority so
the action items surface first.

### Team rollup

Last-7-day connects per team, with inline relative bars. Less critical for
Dana herself, more useful for the team leads she forwards screenshots to.

---

## Decisions about the data

A few things in the seed are worth knowing about; they show up in the
numbers and we chose to handle them rather than hide them:

- **Five "misclick" connected rows with `duration_seconds = 0`** in the
  last week. These count toward the Monday number, per the spec — the
  metric is `outcome = 'connected'`, not `duration > 0`.
- **Two future-dated connected rows.** Excluded by the `started_at <= now`
  upper bound on every windowed query.
- **One brand-new agent (Aisha Patel, 3 days)** with zero calls. She shows
  up in the "Check in" column on the watchlist via the new-hire rule.

If we wanted to surface data-quality concerns (misclicks should probably
become their own outcome, e.g. `accidental`), the place to do it would be
a separate flag on the agent card — not a silent filter on the headline
metric. Dana's ops lead is reading the same column we are.

---

## API

All four endpoints are `Cache-Control: no-store`, all numbers are live,
all share one data layer (`src/lib/db.ts`).

### `GET /api/weekly-digest` → JSON

Last 28 days of overall activity, plus the top 3 agents by connects in the
last 7 days.

```jsonc
{
  "data": [
    {
      "date": "2026-04-17",
      "connected_count": 0,
      "total_count": 0,
      "by_team": {}
    },
    // ... 27 more, oldest first, ending today
    {
      "date": "2026-05-14",
      "connected_count": 43,
      "total_count": 148,
      "by_team": { "Enterprise": 7, "Mid-Market": 8, "SMB": 12, "West Coast": 16 }
    }
  ],
  "top_agents": [
    { "name": "Gabriela Souza", "team": "SMB", "connected_count": 53 },
    { "name": "Maria Chen", "team": "West Coast", "connected_count": 44 },
    { "name": "Tomas Vega", "team": "SMB", "connected_count": 37 }
  ],
  "meta": {
    "generated_at": "2026-05-14T21:27:43.337Z",
    "window_start": "2026-04-17",
    "window_end": "2026-05-14"
  }
}
```

### `GET /api/weekly-digest.csv` → CSV

Same daily window, CSV for Google Sheets. Columns: `date`,
`connected_count`, `total_count`, `top_team`, `top_team_connects`. Team
names containing commas/spaces are RFC 4180 quoted. Top-team ties break
alphabetically so the file is reproducible.

```
date,connected_count,total_count,top_team,top_team_connects
2026-04-17,0,0,,0
2026-04-23,2,9,Mid-Market,1
2026-05-14,43,148,West Coast,16
```

### `GET /api/agents/[id]/scorecard` → JSON

One agent, last 14 days, plus WoW totals. **404** with
`{ "error": "agent_not_found", "id": "<id>" }` if the id doesn't resolve.

### `GET /api/teams/[name]/summary` → JSON

One team's last-7-day rollup. Path segment is decoded by Next.js, so
`/api/teams/West%20Coast/summary` reaches the handler with
`name = "West Coast"`. **404** with
`{ "error": "team_not_found", "name": "<name>" }` if no agents are on
that team.

---

## Architecture

```
src/
  lib/
    db.ts                 ← every SQL query lives here
    db.test.ts            ← vitest, exercises the metric definitions
  app/
    page.tsx              ← the dashboard (Server Component)
    api/
      weekly-digest/route.ts
      weekly-digest.csv/route.ts
      agents/[id]/scorecard/route.ts
      teams/[name]/summary/route.ts
  components/
    ui/                   ← shadcn primitives (Card, Button, Table, Skeleton)
    dashboard/            ← the page's specific pieces
```

`src/lib/db.ts` is the only file that touches SQLite. Pages and route
handlers compose typed functions from it — no inline SQL anywhere else,
no constants pasted into the rendering layer. Adding a new metric is one
function in `db.ts` and one consumer.

### One quirk to be aware of

Node 22's `node:sqlite` module is still flagged as experimental, which
means it isn't listed in `module.builtinModules`. Vite/Vitest leans on
that list to decide what to externalize, so a plain
`import { DatabaseSync } from "node:sqlite"` blows up the test runner.
`src/lib/db.ts` works around it with `process.getBuiltinModule("node:sqlite")`,
which goes straight through to Node and ignores the bundler. The type
import (`import type ... from "node:sqlite"`) is erased before Vite ever
sees it.

When Node promotes `node:sqlite` to stable and adds it to
`builtinModules`, the workaround can come out — search for the
`getBuiltinModule` call to find it.

---

## Tests

`pnpm test` runs vitest against `src/lib/db.test.ts`. The tests stand up
a fresh in-memory SQLite database for each case, so they don't depend on
the seed and don't race the dev server. They pin down the metric
*definitions*, not specific seeded numbers:

- The 7-day window is exactly `(now - 7d, now]` — rows on either edge are
  in/out as expected, future rows are excluded.
- WoW delta returns `delta_pct = null` when the prior week was zero (no
  division-by-zero, no `Infinity` leaking into the JSON).
- Top-agent ties break alphabetically.
- Agents with no calls still show up in the weekly roll-up with zeros
  (LEFT JOIN, not silently dropped).

If/when QA needs to verify Dana's monthly numbers without picking up the
phone, this is the file to extend.

---

## Constraints checklist

- [x] Page at `/`, hero number live from SQLite, no hardcoded values.
- [x] Four API endpoints with the documented shapes, `Cache-Control: no-store`.
- [x] 404 + error bodies for the not-found cases.
- [x] All queries through `src/lib/db.ts`.
- [x] No new top-level dependencies (uses what was already in `package.json`).
- [x] pnpm, Node 22.5+.
- [x] ArmorHQ logo in the header (`public/logo.png`).
- [x] Mobile: works at 375px wide — every grid collapses to one column
      below `sm`, hero/sub-stats stack, the SVG chart scales, the agent
      cards are designed for portrait phones first.
- [x] At least one vitest test.
- [x] No console errors on dev or build.
- [x] Comments where the *why* isn't obvious from the code.
