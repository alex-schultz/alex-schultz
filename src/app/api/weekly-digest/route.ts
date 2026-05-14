// GET /api/weekly-digest
//
// Last 28 days of overall activity + top 3 agents by connects this week.
// All numbers are live from SQLite — see src/lib/db.ts for the queries.

import { NextResponse } from "next/server";
import { getDailyActivity, getTopAgentsLast7Days } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const now = new Date();
  const data = getDailyActivity(28, now);
  const top_agents = getTopAgentsLast7Days(3, now).map((a) => ({
    name: a.name,
    team: a.team,
    connected_count: a.connected_count,
  }));

  const body = {
    data,
    top_agents,
    // The 28-day window is what `data` describes. `meta.window_start` is
    // therefore the first date in `data`, not today - 7.
    meta: {
      generated_at: now.toISOString(),
      window_start: data[0].date,
      window_end: data[data.length - 1].date,
    },
  };

  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store" },
  });
}
