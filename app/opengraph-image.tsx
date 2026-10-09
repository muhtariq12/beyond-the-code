import { ImageResponse } from "next/og";

export const alt = "Beyond the Code: the hardest part of building software isn't coding";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#f6f2ea",
          color: "#16150f",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          borderTop: "14px solid #1b3fb8",
        }}
      >
        <div style={{ fontSize: 26, letterSpacing: 4, textTransform: "uppercase", color: "#5a564c" }}>
          An interactive essay
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 78, lineHeight: 1.05, fontFamily: "Georgia, serif", letterSpacing: -2 }}>
            The hardest part of building software isn&apos;t coding.
          </div>
          <div style={{ marginTop: 28, fontSize: 30, color: "#5a564c", maxWidth: 900 }}>
            AI can turn an idea into a prototype quickly. Making it work in the real world is a different
            problem.
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 28 }}>
          <span style={{ color: "#1b3fb8", fontWeight: 700 }}>Beyond the Code</span>
          <span style={{ color: "#5a564c" }}>Muhammad Tariq</span>
        </div>
      </div>
    ),
    size,
  );
}
