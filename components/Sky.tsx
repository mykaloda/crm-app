import type { EventKind } from "@/lib/moments";

export type SkyMode = EventKind | "waiting" | "archive";

const map: Record<SkyMode, string> = {
  rain: "sky-rain",
  snow: "sky-snow",
  thunder: "sky-thunder",
  sunrise: "sky-sunrise",
  meteor: "sky-meteor",
  waiting: "sky-waiting",
  archive: "sky-archive",
};

export function Sky({ mode, className = "" }: { mode: SkyMode; className?: string }) {
  return <div className={`sky ${map[mode]} ${className}`} aria-hidden />;
}
