"use client";

import { useState } from "react";

const hypotheses = [
  {
    id: "dupes",
    title: "The unit code is not unique across buildings",
    why: "“204” can exist in Tower A and Tower B. A lookup on the code alone picks whichever row it finds first.",
    evidence:
      "Group the unit table by code and count. Then group by building and code. If the first count has duplicates the second does not, the key is the problem.",
    test: "Run the lookup for every code that appears in more than one building, and check which row comes back.",
    success:
      "Every lookup either returns exactly one unit or asks which building. None returns a guess.",
  },
  {
    id: "stale",
    title: "The sync is stale",
    why: "The unit was re-let or renumbered in the ERP, but the application still holds the old state.",
    evidence:
      "For the affected unit, compare the ERP's last-modified time with the application's last-synced time. Read the sync log for that record.",
    test: "Force a re-sync of this single record, then repeat the registration.",
    success:
      "After a re-sync the application matches the ERP. You also know the sync lag, and whether it is acceptable.",
  },
  {
    id: "fuzzy",
    title: "The match relies on typed, messy text",
    why: "The tenant types “Unit 204 ”, “٢٠٤” or “0204”. Free text, spaces, leading zeros and mixed scripts all break exact matching, and loose matching can match the wrong thing.",
    evidence:
      "List the raw submitted value and the matched record side by side for recent registrations. Look at the exact characters, not how they render.",
    test: "Write twenty awkward inputs, each with the unit it should resolve to, and run them through the matcher.",
    success:
      "Each input resolves to the expected unit or is rejected with a clear message. Zero resolve to a different unit.",
  },
  {
    id: "lease",
    title: "Two leases overlap on the same unit",
    why: "The previous tenant's lease is still open in the ERP, so the unit legitimately has two answers.",
    evidence:
      "Query for units with more than one active lease on the same date, and look at start and end dates around the changeover.",
    test: "Pick five units with a recent changeover and check which lease the application treats as current.",
    success:
      "Each unit has one current lease, or the system has a written rule for which one wins and flags the rest for a person.",
  },
] as const;

export default function MappingWalkthrough() {
  const [id, setId] = useState<(typeof hypotheses)[number]["id"] | null>(null);
  const h = hypotheses.find((x) => x.id === id);

  return (
    <figure className="figure" aria-labelledby="walk-cap">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <p className="label">Interactive · Investigate</p>
        <span className="border border-fail px-2 py-0.5 font-mono text-[0.68rem] uppercase tracking-wider text-fail">
          Hypothetical scenario
        </span>
      </div>

      <div className="border-l-2 border-ink pl-4">
        <p className="label">1 · The symptom</p>
        <p className="mt-1 max-w-[36rem] text-[1rem]">
          A tenant registers and sees the lease for Unit 204 in Tower B. They live in Unit 204 in
          Tower A. Support reports it once. You do not yet know whether it is a one-off.
        </p>
      </div>

      <div className="mt-7">
        <p className="label">2 · Possible root causes. Pick one to investigate.</p>
        <div role="group" aria-label="Possible root causes" className="mt-3 divide-y hairline border-y hairline">
          {hypotheses.map((x) => {
            const on = x.id === id;
            return (
              <button
                key={x.id}
                type="button"
                aria-pressed={on}
                onClick={() => setId(x.id)}
                className={`flex w-full items-start gap-3 px-1 py-3 text-left transition-colors ${
                  on ? "bg-accent-soft" : "hover:bg-paper-deep"
                }`}
              >
                <span
                  aria-hidden
                  className={`mt-1.5 h-3 w-3 shrink-0 rounded-full border ${
                    on ? "border-accent bg-accent" : "border-ink"
                  }`}
                />
                <span>
                  <span className="block font-medium">{x.title}</span>
                  <span className="mt-0.5 block text-[0.92rem] text-muted">{x.why}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-7" aria-live="polite">
        {h ? (
          <div className="grid gap-x-10 gap-y-5 md:grid-cols-3">
            <div>
              <p className="label !text-accent">3 · Evidence to inspect</p>
              <p className="mt-1 text-[0.95rem]">{h.evidence}</p>
            </div>
            <div>
              <p className="label !text-accent">4 · Smallest useful test</p>
              <p className="mt-1 text-[0.95rem]">{h.test}</p>
            </div>
            <div>
              <p className="label !text-accent">5 · Success criterion</p>
              <p className="mt-1 text-[0.95rem]">{h.success}</p>
            </div>
          </div>
        ) : (
          <p className="text-[0.95rem] text-muted">
            Choose a cause above. Each one needs different evidence, and a different smallest test.
          </p>
        )}
      </div>

      <p className="mt-7 max-w-[38rem] border-t hairline pt-4 text-[0.95rem]">
        <strong>One rule applies to all four:</strong> when the match is ambiguous, the system should
        fail closed. Showing someone nothing, or asking a person, is better than showing them someone
        else&apos;s lease.
      </p>

      <figcaption id="walk-cap" className="mt-5 max-w-[38rem] text-[0.85rem] text-muted">
        Figure 4. A made-up scenario to show the method. It is not an incident from my workplace.
      </figcaption>
    </figure>
  );
}
