// A week-over-week change indicator. Renders an arrow + signed value(s) and
// colors itself green / amber / muted depending on direction.
//
// Used in three places (hero, sub-stats, agent rows), so the formatting and
// the a11y label live here once.

import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  /** Last - prior, in whatever unit `unit` describes. Positive = improvement. */
  abs: number;
  /** (last - prior) / prior. `null` when prior was 0. */
  pct: number | null;
  /** Label suffix for screen readers, e.g. "connected calls". */
  unit: string;
  /** Show only the % (true) or both abs and % (false). */
  compact?: boolean;
  className?: string;
};

export function Delta({ abs, pct, unit, compact, className }: Props) {
  const direction = abs > 0 ? "up" : abs < 0 ? "down" : "flat";
  const Icon = direction === "up" ? ArrowUp : direction === "down" ? ArrowDown : ArrowRight;
  const color =
    direction === "up"
      ? "text-success"
      : direction === "down"
        ? "text-warning"
        : "text-muted";

  const pctText =
    pct === null ? "n/a" : `${pct > 0 ? "+" : ""}${(pct * 100).toFixed(0)}%`;
  const absText = `${abs > 0 ? "+" : ""}${abs}`;

  // The visible label is terse; the SR label spells out direction + unit so
  // screen readers don't read "↑ 12" as "up arrow twelve".
  const srLabel =
    direction === "flat"
      ? `Unchanged week-over-week (${unit})`
      : `${direction === "up" ? "Up" : "Down"} ${Math.abs(abs)} ${unit} versus the prior 7 days${
          pct !== null ? `, ${Math.abs(pct * 100).toFixed(0)} percent` : ""
        }`;

  return (
    <span
      className={cn("inline-flex items-center gap-1 text-sm font-medium", color, className)}
      aria-label={srLabel}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      <span aria-hidden="true">
        {compact ? pctText : `${absText} (${pctText})`}
      </span>
    </span>
  );
}
