import { ImageResponse } from "next/og";
import { loadFont } from "./pdf";
import type { EventKind } from "./moments";

const BACKGROUNDS: Record<EventKind, string> = {
  rain: "linear-gradient(180deg, #1c2748 0%, #0b0e1c 100%)",
  snow: "linear-gradient(180deg, #2a3656 0%, #111629 100%)",
  thunder: "linear-gradient(180deg, #232845 0%, #0b0e1c 100%)",
  sunrise: "linear-gradient(180deg, #1a1f45 0%, #6a3b6e 50%, #f08a5d 85%, #f7c873 100%)",
  meteor: "linear-gradient(180deg, #1b2350 0%, #070914 100%)",
};

async function fonts() {
  const [serif, sans] = await Promise.all([loadFont("Cormorant-SemiBold.ttf"), loadFont("Inter-Regular.ttf")]);
  return [
    { name: "Cormorant", data: serif.buffer.slice(serif.byteOffset, serif.byteOffset + serif.byteLength) as ArrayBuffer, weight: 600 as const, style: "normal" as const },
    { name: "Inter", data: sans.buffer.slice(sans.byteOffset, sans.byteOffset + sans.byteLength) as ArrayBuffer, weight: 400 as const, style: "normal" as const },
  ];
}

function Drops({ kind, width, height }: { kind: EventKind; width: number; height: number }) {
  if (kind === "sunrise") {
    return (
      <div
        style={{
          position: "absolute",
          left: width / 2 - 220,
          top: height - 260,
          width: 440,
          height: 440,
          borderRadius: 220,
          background: "radial-gradient(circle, #fff3cf 0%, #f7c873 45%, rgba(247,200,115,0) 70%)",
        }}
      />
    );
  }
  const items = Array.from({ length: 70 }, (_, i) => i);
  return (
    <>
      {items.map((i) => {
        // Low-discrepancy scatter so the drops cover the whole card evenly.
        const x = Math.round(((i * 0.618034) % 1) * width);
        const y = Math.round(((i * 0.7548777 + 0.31) % 1) * height);
        if (kind === "snow" || kind === "meteor") {
          const s = kind === "snow" ? 3 + (i % 4) : 2;
          return <div key={i} style={{ position: "absolute", left: x, top: y, width: s, height: s, borderRadius: s, background: "rgba(255,255,255,0.7)" }} />;
        }
        return (
          <div
            key={i}
            style={{ position: "absolute", left: x, top: y, width: 2, height: 28 + (i % 3) * 10, background: "linear-gradient(180deg, rgba(170,200,255,0), rgba(170,200,255,0.55))" }}
          />
        );
      })}
    </>
  );
}

export async function momentImage(opts: {
  kind: EventKind;
  kicker: string;
  title: string;
  name?: string;
  lines?: string[];
  footer: string;
  width: number;
  height: number;
}) {
  const { width, height } = opts;
  const portrait = height > width;
  return new ImageResponse(
    (
      <div
        style={{
          width,
          height,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          position: "relative",
          background: BACKGROUNDS[opts.kind],
          color: "#eef0f7",
          fontFamily: "Inter",
          padding: portrait ? 90 : 70,
          textAlign: "center",
        }}
      >
        <Drops kind={opts.kind} width={width} height={height} />
        <div style={{ position: "absolute", top: 28, left: 28, right: 28, bottom: 28, border: "1px solid rgba(242,196,109,0.5)", borderRadius: 24, display: "flex" }} />
        <div style={{ display: "flex", fontSize: portrait ? 30 : 24, letterSpacing: 6, color: "#f2c46d", textTransform: "uppercase" }}>{opts.kicker}</div>
        <div style={{ display: "flex", fontFamily: "Cormorant", fontSize: portrait ? 96 : 76, lineHeight: 1.05, marginTop: 30, maxWidth: width - 180, justifyContent: "center" }}>
          {opts.title}
        </div>
        {opts.name && (
          <div style={{ display: "flex", fontFamily: "Cormorant", fontSize: portrait ? 120 : 84, color: "#f2c46d", marginTop: 36 }}>{opts.name}</div>
        )}
        {opts.lines?.map((l) => (
          <div key={l} style={{ display: "flex", fontSize: portrait ? 34 : 26, color: "#c9cfe3", marginTop: 16 }}>
            {l}
          </div>
        ))}
        <div style={{ position: "absolute", bottom: 64, display: "flex", fontSize: portrait ? 28 : 22, color: "#9aa3bd" }}>{opts.footer}</div>
      </div>
    ),
    { width, height, fonts: await fonts() },
  );
}
