// Dana's Monday-morning dashboard.
//
// What's here, and why:
//   1. The hero number — connected calls in the rolling last 7 days. This is
//      the literal question Dana asks her ops lead every Monday. It comes
//      from a live SQL query against the database (no caching, no ISR).
//   2. Week-over-week context for both the hero and connect rate — so the
//      number means "better" or "worse" at a glance, not just "a number".
//   3. A 28-day daily chart so the trend isn't just one bar of "this week"
//      that could be noise.
//   4. "Who to talk to Monday morning" — three buckets (coach, recognize,
//      check in) that explicitly answer Dana's other question. The
//      classification rules live in agent-status.ts.
//   5. Full agent roster below the watchlist, prioritized by the same
//      status rules. Status pills, last-7 connects, WoW delta, connect rate.
//   6. Team rollup at the bottom. Useful for the team leads who Dana
//      forwards screenshots to, less critical for Dana herself.
//
// Render strategy: Server Component. `force-dynamic` plus the inherited
// `revalidate = 0` mean every request hits SQLite. ~3,000 rows in a local
// file is fast enough that we don't need to bother caching.

import {
  getAgentsWeekly,
  getDailyActivity,
  getOverallWeeklyDelta,
  getTeamSummary,
  getTeams,
  type TeamSummary,
} from "@/lib/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Header } from "@/components/dashboard/header";
import { Delta } from "@/components/dashboard/delta";
import { DailyChart } from "@/components/dashboard/daily-chart";
import { Watchlist } from "@/components/dashboard/watchlist";
import { AgentList } from "@/components/dashboard/agent-list";
import { TeamRow } from "@/components/dashboard/team-row";
import { classifyAgents, STATUS_RANK } from "@/components/dashboard/agent-status";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function Page() {
  const now = new Date();

  // One pass through the database per dashboard load. Each call is its own
  // statement so failure to compute one section won't blank out the page,
  // and they each stay small enough to read.
  const overall = getOverallWeeklyDelta(now);
  const daily = getDailyActivity(28, now);
  const agentsWeekly = getAgentsWeekly(now);
  const teamNames = getTeams();
  const teamSummaries = teamNames
    .map((t) => getTeamSummary(t, now))
    .filter((t): t is TeamSummary => t !== null);

  // Tag every agent with a status (declining / star / new hire / quiet /
  // steady), then sort so the people who need attention surface first.
  const classified = classifyAgents(agentsWeekly, now).sort((a, b) => {
    const rank = STATUS_RANK[a.status] - STATUS_RANK[b.status];
    if (rank !== 0) return rank;
    return b.connected_last_7 - a.connected_last_7 || a.name.localeCompare(b.name);
  });

  return (
    <>
      <Header generatedAt={now} />
      <main
        className="mx-auto max-w-content space-y-6 px-4 py-6 sm:px-6 sm:py-8"
        id="main"
      >
        <h1 className="sr-only">ArmorHQ Dialer Dashboard</h1>

        {/* HERO — the number Dana checks every Monday */}
        <section aria-labelledby="hero-label">
          <Card className="overflow-hidden">
            <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-end sm:justify-between sm:p-8">
              <div>
                <p
                  id="hero-label"
                  className="text-xs uppercase tracking-wider text-muted"
                >
                  Connected calls · rolling 7 days
                </p>
                <p
                  className="mt-2 font-mono text-5xl tabular-nums leading-none text-foreground sm:text-6xl"
                  aria-live="polite"
                >
                  {overall.connected_last_7.toLocaleString()}
                </p>
                <p className="mt-3 text-sm text-muted">
                  Last 7 days versus the 7 before
                </p>
              </div>
              <div className="flex flex-col items-start gap-2 sm:items-end">
                <Delta
                  abs={overall.delta_abs}
                  pct={overall.delta_pct}
                  unit="connected calls"
                  className="text-base"
                />
                <p className="font-mono text-xs text-muted">
                  prior 7d: {overall.connected_prior_7.toLocaleString()}
                </p>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* SUB-STATS — connect rate + dial volume, both WoW */}
        <section
          className="grid grid-cols-1 gap-4 sm:grid-cols-2"
          aria-label="Other weekly indicators"
        >
          <Card>
            <CardContent className="p-5">
              <p className="text-xs uppercase tracking-wider text-muted">
                Connect rate this week
              </p>
              <p className="mt-2 font-mono text-3xl tabular-nums">
                {(overall.connect_rate_last_7 * 100).toFixed(1)}%
              </p>
              <p className="mt-2 text-xs text-muted">
                prior {(overall.connect_rate_prior_7 * 100).toFixed(1)}%
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <p className="text-xs uppercase tracking-wider text-muted">
                Total dials this week
              </p>
              <p className="mt-2 font-mono text-3xl tabular-nums">
                {overall.total_last_7.toLocaleString()}
              </p>
              <p className="mt-2 inline-flex items-center gap-2">
                <Delta
                  abs={overall.total_last_7 - overall.total_prior_7}
                  pct={
                    overall.total_prior_7 === 0
                      ? null
                      : (overall.total_last_7 - overall.total_prior_7) /
                        overall.total_prior_7
                  }
                  unit="dials"
                  compact
                />
                <span className="font-mono text-xs text-muted">
                  vs {overall.total_prior_7.toLocaleString()}
                </span>
              </p>
            </CardContent>
          </Card>
        </section>

        {/* DAILY TREND — 28-day bar chart */}
        <section aria-labelledby="trend-label">
          <Card>
            <CardHeader>
              <CardTitle id="trend-label">Daily connects, last 28 days</CardTitle>
              <CardDescription>
                The shaded bars are the last 7 days — the same window as the hero number.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DailyChart data={daily} highlightTrailing={7} />
            </CardContent>
          </Card>
        </section>

        {/* WATCHLIST — who to talk to on Monday morning */}
        <section aria-labelledby="watchlist-label" className="space-y-3">
          <div>
            <h2
              id="watchlist-label"
              className="text-lg font-semibold tracking-tight"
            >
              Who to talk to on Monday morning
            </h2>
            <p className="text-sm text-muted">
              Three buckets, ranked by how urgent the conversation is.
            </p>
          </div>
          <Watchlist agents={classified} />
        </section>

        {/* FULL ROSTER */}
        <section aria-labelledby="roster-label" className="space-y-3">
          <div>
            <h2 id="roster-label" className="text-lg font-semibold tracking-tight">
              All agents
            </h2>
            <p className="text-sm text-muted">
              Sorted so the action items (declining → new hire → quiet → star) come first.
            </p>
          </div>
          <AgentList agents={classified} />
        </section>

        {/* TEAM ROLLUP */}
        <section aria-labelledby="teams-label" className="space-y-3">
          <div>
            <h2 id="teams-label" className="text-lg font-semibold tracking-tight">
              By team, last 7 days
            </h2>
            <p className="text-sm text-muted">
              Bar lengths are relative to the busiest team this week.
            </p>
          </div>
          <TeamRow teams={teamSummaries} />
        </section>

        <footer className="pt-6 text-center text-xs text-muted">
          <p>
            Numbers are live from the local database. See{" "}
            <code className="font-mono">/api/weekly-digest</code> for the JSON feed.
          </p>
        </footer>
      </main>
    </>
  );
}
