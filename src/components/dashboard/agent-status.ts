// "Who should Dana talk to on Monday morning?" lives here.
//
// We tag each agent with at most one status: stars get a congratulations
// conversation; decliners get a coaching one; new hires get a check-in.
// Anyone left is "Steady" — fine, not interesting today.
//
// These thresholds are intentionally chunky:
//   - "Declining" requires both a >=30% drop AND a non-trivial prior week
//     (>=10 connects). Without the floor we'd flag every agent who happens
//     to have 1 connect this week vs 3 last week.
//   - "New hire" is a 30-day window so it captures Aisha-style sub-week
//     hires and also agents in their first month who may still be ramping.
//   - "Quiet" is a low absolute floor — Dana isn't going to coach someone
//     who made 5 dials all week into a top performer; she'll ask why they
//     weren't dialing.

import type { AgentWeekly } from "@/lib/db";

export type AgentStatus = "star" | "declining" | "new_hire" | "quiet" | "steady";

const DECLINE_PCT = -0.3;
const DECLINE_MIN_PRIOR = 10;
const NEW_HIRE_DAYS = 30;
const QUIET_MAX_DIALS = 20;

export type ClassifiedAgent = AgentWeekly & {
  status: AgentStatus;
};

export function classifyAgents(
  agents: AgentWeekly[],
  now: Date = new Date(),
): ClassifiedAgent[] {
  // Stars are the top 3 by connects this week. Compute first; the rest of the
  // rules can then claim agents that didn't make the cut.
  const stars = new Set(
    [...agents]
      .sort((a, b) => b.connected_last_7 - a.connected_last_7 || a.name.localeCompare(b.name))
      .slice(0, 3)
      .map((a) => a.id),
  );

  return agents.map((a) => {
    const hireDaysAgo = (now.getTime() - new Date(a.hire_date).getTime()) / 86_400_000;

    let status: AgentStatus = "steady";
    if (stars.has(a.id)) {
      status = "star";
    } else if (
      a.delta_pct !== null &&
      a.delta_pct <= DECLINE_PCT &&
      a.connected_prior_7 >= DECLINE_MIN_PRIOR
    ) {
      status = "declining";
    } else if (hireDaysAgo <= NEW_HIRE_DAYS) {
      status = "new_hire";
    } else if (a.total_last_7 < QUIET_MAX_DIALS) {
      status = "quiet";
    }
    return { ...a, status };
  });
}

export const STATUS_LABEL: Record<AgentStatus, string> = {
  star: "Top performer",
  declining: "Declining",
  new_hire: "New hire",
  quiet: "Quiet",
  steady: "Steady",
};

export const STATUS_DESCRIPTION: Record<AgentStatus, string> = {
  star: "Top 3 this week — worth a thank-you note.",
  declining: "Connects down ≥30% week-over-week. Coach this person Monday.",
  new_hire: "Hired in the last 30 days. Check ramp progress.",
  quiet: "Fewer than 20 dials this week. Worth asking why.",
  steady: "On trend.",
};

/**
 * Priority for "where should Dana look first?". Lower numbers come first.
 * Declining > New hire > Quiet > Star > Steady. Star ranks below the action
 * items because it's a celebration, not a problem.
 */
export const STATUS_RANK: Record<AgentStatus, number> = {
  declining: 0,
  new_hire: 1,
  quiet: 2,
  star: 3,
  steady: 4,
};

export function statusBadgeClasses(status: AgentStatus): string {
  switch (status) {
    case "star":
      return "bg-accent/15 text-accent border-accent/30";
    case "declining":
      return "bg-warning/15 text-warning border-warning/30";
    case "new_hire":
      return "bg-sky-500/15 text-sky-300 border-sky-400/30";
    case "quiet":
      return "bg-white/5 text-muted border-white/10";
    case "steady":
      return "bg-transparent text-muted border-transparent";
  }
}
