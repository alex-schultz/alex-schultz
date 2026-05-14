// GET /api/weekly-digest.csv
//
// The same 28-day window as /api/weekly-digest, but rendered as a CSV the
// customer-success team can drop straight into Google Sheets. We pick a
// `top_team` per day so the file is useful at a glance without needing to
// pivot the per-team breakdown that the JSON endpoint carries.

import { getDailyActivity } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * RFC 4180 CSV escape — quote any field containing a comma, quote, CR, or
 * LF; double internal quotes. Plain alphanumerics pass through unchanged.
 * Team names like "West Coast" or names with apostrophes go through this.
 */
function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function GET() {
  const now = new Date();
  const data = getDailyActivity(28, now);

  const header = ["date", "connected_count", "total_count", "top_team", "top_team_connects"];
  const rows: string[] = [header.join(",")];

  for (const day of data) {
    // The day's top team is the one with the most connected calls; ties
    // are broken by name so the CSV is deterministic across runs.
    let topTeam = "";
    let topCount = 0;
    for (const [team, count] of Object.entries(day.by_team)) {
      if (count > topCount || (count === topCount && team < topTeam)) {
        topTeam = team;
        topCount = count;
      }
    }
    rows.push(
      [
        day.date,
        String(day.connected_count),
        String(day.total_count),
        csvEscape(topTeam),
        String(topCount),
      ].join(","),
    );
  }

  // Trailing newline so the file ends on a complete record — Google Sheets
  // imports an unterminated final row without complaint, but other tools
  // (Excel, awk, some Python parsers) prefer it.
  const body = rows.join("\n") + "\n";

  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Disposition": 'attachment; filename="weekly-digest.csv"',
    },
  });
}
