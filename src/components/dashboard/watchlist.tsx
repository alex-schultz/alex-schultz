// Dana's actionable "talk to these people first" panel. Filters the
// classified roster down to action-required statuses and renders three
// columns when the screen is wide enough, stacking on mobile.
//
// This is the section meant to answer the literal question Dana asked:
// "who should I be talking to on Monday morning?"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Trophy, TrendingDown, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ClassifiedAgent } from "./agent-status";

type Props = {
  agents: ClassifiedAgent[];
};

export function Watchlist({ agents }: Props) {
  const stars = agents.filter((a) => a.status === "star");
  const declining = agents
    .filter((a) => a.status === "declining")
    .sort((a, b) => (a.delta_pct ?? 0) - (b.delta_pct ?? 0));
  const newHires = agents
    .filter((a) => a.status === "new_hire")
    .sort((a, b) => a.hire_date.localeCompare(b.hire_date));

  const columns = [
    {
      key: "declining",
      title: "Coach this week",
      hint: "Connects down ≥30% vs last week",
      icon: <TrendingDown className="size-4" aria-hidden="true" />,
      tone: "warning",
      empty: "No one is sliding right now.",
      people: declining,
      renderMeta: (a: ClassifiedAgent) =>
        a.delta_pct === null
          ? `${a.connected_last_7} connects · no prior baseline`
          : `${a.connected_last_7} connects · ${Math.round(a.delta_pct * 100)}% WoW`,
    },
    {
      key: "stars",
      title: "Recognize",
      hint: "Top 3 connects this week",
      icon: <Trophy className="size-4" aria-hidden="true" />,
      tone: "accent",
      empty: "No connects logged this week.",
      people: stars,
      renderMeta: (a: ClassifiedAgent) =>
        `${a.connected_last_7} connects · ${(a.connect_rate_last_7 * 100).toFixed(0)}% rate`,
    },
    {
      key: "new",
      title: "Check in",
      hint: "Hired in the last 30 days",
      icon: <Sparkles className="size-4" aria-hidden="true" />,
      tone: "sky",
      empty: "No recent hires.",
      people: newHires,
      renderMeta: (a: ClassifiedAgent) =>
        `Hired ${a.hire_date} · ${a.total_last_7} dials`,
    },
  ] as const;

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {columns.map((col) => (
        <Card key={col.key}>
          <CardHeader className="pb-3">
            <CardTitle
              className={cn(
                "flex items-center gap-2 text-sm font-semibold",
                col.tone === "warning" && "text-warning",
                col.tone === "accent" && "text-accent",
                col.tone === "sky" && "text-sky-300",
              )}
            >
              {col.icon}
              <span>{col.title}</span>
            </CardTitle>
            <p className="text-xs text-muted">{col.hint}</p>
          </CardHeader>
          <CardContent className="pt-0">
            {col.people.length === 0 ? (
              <p className="text-sm text-muted">{col.empty}</p>
            ) : (
              <ul className="space-y-2.5" role="list">
                {col.people.map((a) => (
                  <li key={a.id} className="flex flex-col">
                    <span className="font-medium text-foreground">{a.name}</span>
                    <span className="text-xs text-muted">
                      {a.team} · {col.renderMeta(a)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
