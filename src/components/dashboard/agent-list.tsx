// Renders the agent roster as a stack of cards. We chose cards rather than a
// table because Dana said she's on a phone at the airport; a 6-column table
// doesn't survive 375px gracefully, and a horizontally scrolling table is
// worse than a list. The desktop layout snaps the cards into a 2-up grid.

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Delta } from "./delta";
import {
  type ClassifiedAgent,
  STATUS_DESCRIPTION,
  STATUS_LABEL,
  statusBadgeClasses,
} from "./agent-status";

type Props = {
  agents: ClassifiedAgent[];
};

export function AgentList({ agents }: Props) {
  return (
    <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2" role="list">
      {agents.map((a) => (
        <li key={a.id}>
          <AgentCard agent={a} />
        </li>
      ))}
    </ul>
  );
}

function AgentCard({ agent }: { agent: ClassifiedAgent }) {
  const rate = (agent.connect_rate_last_7 * 100).toFixed(0);
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground">{agent.name}</p>
            <p className="truncate text-xs text-muted">{agent.team}</p>
          </div>
          <span
            className={cn(
              "shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium",
              statusBadgeClasses(agent.status),
            )}
            title={STATUS_DESCRIPTION[agent.status]}
          >
            {STATUS_LABEL[agent.status]}
          </span>
        </div>

        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="font-mono text-2xl tabular-nums text-foreground">
              {agent.connected_last_7}
            </p>
            <p className="text-xs text-muted">connected last 7d</p>
          </div>
          <Delta
            abs={agent.delta_abs}
            pct={agent.delta_pct}
            unit="connected calls"
            compact
          />
        </div>

        <div>
          <div className="flex items-center justify-between text-xs text-muted">
            <span>Connect rate</span>
            <span className="font-mono tabular-nums">{rate}%</span>
          </div>
          <div
            className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/5"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Number(rate)}
            aria-label={`Connect rate ${rate} percent`}
          >
            <div
              className="h-full rounded-full bg-accent/70"
              style={{ width: `${Math.min(100, Number(rate))}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-muted">
            {agent.total_last_7} dials · prior {agent.connected_prior_7} connects
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
