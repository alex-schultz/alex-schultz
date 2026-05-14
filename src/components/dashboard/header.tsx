// Top-of-page brand bar. Logo on the left, "last updated" timestamp on the
// right. The timestamp comes from server time at render — pages are
// force-dynamic so this is fresh on every request.

import Image from "next/image";

type Props = {
  generatedAt: Date;
};

export function Header({ generatedAt }: Props) {
  // We render a fixed-format UTC string on the server to avoid a hydration
  // mismatch — locale-formatted client time would differ from server time.
  const stamp = generatedAt.toISOString().replace("T", " ").slice(0, 16) + " UTC";
  return (
    <header className="border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex max-w-content items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3 min-w-0">
          <Image
            src="/logo.png"
            alt="ArmorHQ"
            width={36}
            height={36}
            priority
            className="size-9 rounded-md"
          />
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-tight">ArmorHQ Dashboard</p>
            <p className="truncate text-xs text-muted">Dialer performance, week to week</p>
          </div>
        </div>
        <p
          className="hidden font-mono text-xs text-muted sm:block"
          title="Server-rendered, live from the database"
        >
          updated {stamp}
        </p>
      </div>
    </header>
  );
}
