// GET /api/agents/[id]/scorecard
//
// One agent, last 14 days of daily activity, plus their week-over-week
// numbers. 404 if the id doesn't match anyone — the body shape matches the
// README so the customer-success scripts can branch on `error`.

import { NextResponse } from "next/server";
import { getAgentScorecard } from "@/lib/db";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const now = new Date();
  const card = getAgentScorecard(id, now);

  if (!card) {
    return NextResponse.json(
      { error: "agent_not_found", id },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    {
      agent: card.agent,
      last_14_days: card.last_14_days,
      totals: card.totals,
      meta: {
        generated_at: now.toISOString(),
        window_start: card.last_14_days[0].date,
        window_end: card.last_14_days[card.last_14_days.length - 1].date,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
