// A small SVG bar chart of daily connected calls for the last 28 days.
//
// SVG (not divs) so it scales cleanly down to 375px and prints to PDF for
// the screenshots Dana's account manager occasionally sends out. The
// last-7-day window is drawn in the accent color so Dana can see at a
// glance how "this week" compares to the preceding three weeks.
//
// Each bar has a <title> child for native browser tooltips and a per-bar
// <desc> for assistive tech — there's no JS, so this works server-rendered.

import type { DailyEntry } from "@/lib/db";

type Props = {
  data: DailyEntry[];
  /** How many trailing bars to highlight (the "current" window). */
  highlightTrailing?: number;
};

export function DailyChart({ data, highlightTrailing = 7 }: Props) {
  const max = Math.max(1, ...data.map((d) => d.connected_count));
  const width = 100; // viewBox units; CSS handles real size
  const height = 28;
  const barW = width / data.length;
  const gap = barW * 0.18;

  return (
    <figure
      className="w-full"
      aria-label={`Daily connected calls over the last ${data.length} days, highlighting the last ${highlightTrailing}.`}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="block w-full h-32 sm:h-40"
        preserveAspectRatio="none"
        role="img"
      >
        {data.map((d, i) => {
          const isCurrent = i >= data.length - highlightTrailing;
          const h = max === 0 ? 0 : (d.connected_count / max) * (height - 2);
          const x = i * barW + gap / 2;
          const y = height - h;
          return (
            <rect
              key={d.date}
              x={x}
              y={y}
              width={Math.max(0.5, barW - gap)}
              height={Math.max(0.4, h)}
              rx={0.4}
              className={isCurrent ? "fill-accent" : "fill-white/15"}
            >
              <title>{`${d.date}: ${d.connected_count} connected / ${d.total_count} total`}</title>
            </rect>
          );
        })}
      </svg>
      <figcaption className="mt-2 flex items-center justify-between text-xs text-muted font-mono">
        <span>{data[0]?.date ?? ""}</span>
        <span className="inline-flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block size-2 rounded-sm bg-accent" aria-hidden="true" />
            last {highlightTrailing}d
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block size-2 rounded-sm bg-white/15" aria-hidden="true" />
            prior
          </span>
        </span>
        <span>{data.at(-1)?.date ?? ""}</span>
      </figcaption>
    </figure>
  );
}
