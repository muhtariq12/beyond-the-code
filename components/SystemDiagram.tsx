"use client";

import { useState } from "react";
import { downstream, edges, layouts, nodes, type Layout, type NodeId } from "@/lib/system";

const order: NodeId[] = ["form", "identity", "units", "sync", "netsuite", "access"];

/** Point where a line from the centre of `a` towards `b` leaves a's rectangle. */
function clip(a: [number, number], b: [number, number], w: number, h: number, pad = 4) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const sx = dx === 0 ? Infinity : (w / 2 + pad) / Math.abs(dx);
  const sy = dy === 0 ? Infinity : (h / 2 + pad) / Math.abs(dy);
  const t = Math.min(sx, sy);
  return [a[0] + dx * t, a[1] + dy * t] as const;
}

function Diagram({
  layout,
  selected,
  affected,
  onSelect,
  idSuffix,
}: {
  layout: Layout;
  selected: NodeId;
  affected: Set<NodeId>;
  onSelect: (id: NodeId) => void;
  idSuffix: string;
}) {
  const [w, h] = layout.size;
  const center = (id: NodeId): [number, number] => [
    layout.pos[id][0] + w / 2,
    layout.pos[id][1] + h / 2,
  ];
  const narrow = idSuffix === "n";

  return (
    <svg
      viewBox={`0 0 ${layout.viewBox[0]} ${layout.viewBox[1]}`}
      className="h-auto w-full"
      role="group"
      aria-label="Tenant registration system diagram. Select a component to see its role."
    >
      <defs>
        {(["ink", "fail"] as const).map((k) => (
          <marker
            key={k}
            id={`arrow-${k}-${idSuffix}`}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0 1 L9 5 L0 9 z" fill={k === "ink" ? "#8a8473" : "#a3361b"} />
          </marker>
        ))}
      </defs>

      {edges.map((e) => {
        const a = center(e.from);
        const b = center(e.to);
        const p1 = clip(a, b, w, h);
        const p2 = clip(b, a, w, h, 7);
        const hot = (e.from === selected || affected.has(e.from)) && affected.has(e.to);
        const mx = (p1[0] + p2[0]) / 2;
        const my = (p1[1] + p2[1]) / 2;
        return (
          <g key={`${e.from}-${e.to}`}>
            <line
              x1={p1[0]}
              y1={p1[1]}
              x2={p2[0]}
              y2={p2[1]}
              stroke={hot ? "#a3361b" : "#8a8473"}
              strokeWidth={hot ? 2 : 1.25}
              strokeDasharray={hot ? "5 4" : undefined}
              markerEnd={`url(#arrow-${hot ? "fail" : "ink"}-${idSuffix})`}
            />
            <text
              x={mx}
              y={my - 6}
              textAnchor="middle"
              fontSize={11}
              fontFamily="var(--font-geist-mono)"
              fill="#5a564c"
              stroke="#f6f2ea"
              strokeWidth={4}
              paintOrder="stroke"
            >
              {e.label}
            </text>
          </g>
        );
      })}

      {order.map((id) => {
        const n = nodes[id];
        const [x, y] = layout.pos[id];
        const isSel = id === selected;
        const isAff = affected.has(id);
        return (
          <g
            key={id}
            role="button"
            tabIndex={0}
            aria-pressed={isSel}
            aria-label={`${n.label}. ${n.sub}${isAff ? ". Affected if the selected component fails" : ""}`}
            onClick={() => onSelect(id)}
            onKeyDown={(ev) => {
              if (ev.key === "Enter" || ev.key === " ") {
                ev.preventDefault();
                onSelect(id);
              }
            }}
            className="cursor-pointer outline-none [&:focus-visible>rect]:stroke-[3]"
          >
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              fill={isSel ? "#1b3fb8" : isAff ? "#f3dfd7" : "#fbf9f4"}
              stroke={isSel ? "#1b3fb8" : isAff ? "#a3361b" : "#16150f"}
              strokeWidth={isSel || isAff ? 1.75 : 1}
              strokeDasharray={isAff && !isSel ? "4 3" : undefined}
              style={{ transition: "fill 150ms, stroke 150ms" }}
            />
            <text
              x={x + 14}
              y={y + (narrow ? 28 : 33)}
              fontSize={narrow ? 14 : 16}
              fontWeight={600}
              fill={isSel ? "#f6f2ea" : "#16150f"}
            >
              {n.label}
            </text>
            <text
              x={x + 14}
              y={y + (narrow ? 50 : 56)}
              fontSize={narrow ? 11.5 : 13}
              fill={isSel ? "#dfe5fa" : "#5a564c"}
            >
              {n.sub}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function SystemDiagram() {
  const [selected, setSelected] = useState<NodeId>("units");
  const [broken, setBroken] = useState(true);
  const affected = broken ? downstream(selected) : new Set<NodeId>();
  const n = nodes[selected];

  return (
    <figure className="figure" aria-labelledby="sys-cap">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="label">Interactive · Illustrative architecture</p>
        <label className="label flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[#a3361b]"
            checked={broken}
            onChange={(e) => setBroken(e.target.checked)}
          />
          Show what a failure reaches
        </label>
      </div>

      <div className="hidden md:block">
        <Diagram layout={layouts.wide} selected={selected} affected={affected} onSelect={setSelected} idSuffix="w" />
      </div>
      <div className="mx-auto max-w-[380px] md:hidden">
        <Diagram layout={layouts.narrow} selected={selected} affected={affected} onSelect={setSelected} idSuffix="n" />
      </div>

      <div
        className="mt-6 grid gap-x-10 gap-y-5 border-t hairline pt-5 md:grid-cols-[1fr_1fr]"
        aria-live="polite"
      >
        <div>
          <p className="label !text-accent">Selected</p>
          <h3 className="mt-1 font-display text-2xl font-medium">{n.label}</h3>
          <p className="mt-2 text-[0.97rem]">{n.role}</p>
          <p className="label mt-5">How you would look into it</p>
          <p className="mt-1 text-[0.97rem]">{n.investigate}</p>
        </div>
        <div className="border-l-2 border-fail pl-4">
          <p className="label !text-fail">If this fails</p>
          <p className="mt-1 text-[0.97rem]">{n.fails}</p>
          <p className="label mt-5">What the tenant sees</p>
          <p className="mt-1 text-[0.97rem]">{n.tenantSees}</p>
          {broken && affected.size > 0 && (
            <p className="mt-5 text-[0.9rem] text-muted">
              Downstream, this reaches:{" "}
              <span className="text-ink">
                {order.filter((id) => affected.has(id)).map((id) => nodes[id].label).join(", ")}
              </span>
              .
            </p>
          )}
        </div>
      </div>
      <figcaption id="sys-cap" className="mt-6 max-w-[38rem] text-[0.85rem] text-muted">
        Figure 1. A simplified model of a tenant registration flow, drawn to explain the dependencies. It
        is not a diagram of a deployed system, and the failure examples are illustrations.
      </figcaption>
    </figure>
  );
}
