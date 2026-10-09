export default function Tag({ kind }: { kind: "wip" | "hypothetical" }) {
  return (
    <span
      className={`ml-1 inline-block translate-y-[-1px] border px-1.5 py-px align-middle font-mono text-[0.62rem] uppercase tracking-wider ${
        kind === "wip" ? "border-accent text-accent" : "border-fail text-fail"
      }`}
    >
      {kind === "wip" ? "In progress" : "Hypothetical"}
    </span>
  );
}
