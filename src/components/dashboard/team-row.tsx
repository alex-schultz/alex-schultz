// Team summary card. One per team, stacking on mobile and grid on desktop.
// Each card shows last-7-day connects with an inline bar for visual ranking
// against the busiest team.

import { Card, CardContent } from "@/components/ui/card";
import type { TeamSummary } from "@/lib/db";

type Props = {
  teams: TeamSummary[];
};

export function TeamRow({ teams }: Props) {
  const max = Math.max(1, ...teams.map((t) => t.last_7_days.connected_count));
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" role="list">
      {teams.map((t) => {
        const pct = (t.last_7_days.connected_count / max) * 100;
        const rate = (t.last_7_days.connect_rate * 100).toFixed(0);
        return (
          <li key={t.team.name}>
            <Card>
              <CardContent className="flex flex-col gap-2 p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="truncate text-sm font-medium text-foreground">
                    {t.team.name}
                  </p>
                  <p className="text-xs text-muted">{t.team.agent_count} agents</p>
                </div>
                <p className="font-mono text-2xl tabular-nums text-foreground">
                  {t.last_7_days.connected_count}
                </p>
                <div
                  className="h-1.5 w-full overflow-hidden rounded-full bg-white/5"
                  aria-hidden="true"
                >
                  <div
                    className="h-full rounded-full bg-accent/70"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="text-xs text-muted">
                  {rate}% connect rate · {t.last_7_days.total_count} dials
                </p>
              </CardContent>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
