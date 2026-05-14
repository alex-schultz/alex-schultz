// GET /api/teams/[name]/summary
//
// One team's 7-day rollup. The `[name]` segment arrives URL-encoded
// (e.g. "West%20Coast"); Next.js decodes it before passing it to the
// handler, so `params.name` is already the raw team name.

import { NextResponse } from "next/server";
import { getTeamSummary, getWindowMeta } from "@/lib/db";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ name: string }> };

export async function GET(_req: Request, ctx: RouteContext) {
  const { name } = await ctx.params;
  const now = new Date();
  const summary = getTeamSummary(name, now);

  if (!summary) {
    return NextResponse.json(
      { error: "team_not_found", name },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    {
      team: summary.team,
      last_7_days: summary.last_7_days,
      agents: summary.agents,
      meta: getWindowMeta(now, 7),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
