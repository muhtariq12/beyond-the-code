"use client";

import { useState } from "react";

const stages = [
  {
    short: "Compiles",
    title: "The code compiles",
    establishes:
      "The syntax is valid, the types line up, and the toolchain can produce a build.",
    doesNot:
      "That the program does anything useful. A compiled app can still crash on launch or show a blank screen.",
    example:
      "A mobile build succeeds and installs. On a real phone, the first screen waits forever for a response it never gets.",
    evidence: "A green build.",
  },
  {
    short: "Tests pass",
    title: "Automated tests pass",
    establishes:
      "The logic behaves the way its author thought to check, usually in isolation and often against mocks.",
    doesNot:
      "That the mocks resemble the real service, or that the screens that call this logic can be reached.",
    example:
      "A unit-lookup test passes on a hand-written fixture. The real export has unit codes with trailing spaces the fixture never had.",
    evidence: "A passing test suite. It is only as honest as its fixtures.",
  },
  {
    short: "Integrates",
    title: "It works against the intended environment",
    establishes:
      "The real pieces agree: the actual API, the actual data shapes, the actual authentication.",
    doesNot:
      "That a person can find their way through it, or that staging data is as messy as production data.",
    example:
      "The app reads real units from the ERP sandbox. It has not yet seen the ugly records that only exist in the live data.",
    evidence: "A run against the real service, with real credentials, on real records.",
  },
  {
    short: "Journey",
    title: "A complete user journey works",
    establishes:
      "A person starts at the real entry point, on a real device and network, and finishes the task.",
    doesNot:
      "That anyone wants the task done this way, or that it keeps working after the next release.",
    example:
      "On a real phone: the keyboard covers the field, a permission prompt interrupts, the confirmation link opens the wrong app. None of this shows up in a build or a unit test.",
    evidence: "You, or a real user, completing the flow end to end and watching what actually happens.",
  },
  {
    short: "Value",
    title: "It delivers measurable value",
    establishes:
      "A chosen outcome moved, compared with a baseline. For onboarding that might be the share of tenants who finish without staff help.",
    doesNot:
      "Anything about causes unless you compared against something. Numbers going up is not the same as your change working.",
    example:
      "Before launch, write down the number you expect to move and what you will do if it does not.",
    evidence: "A metric, a baseline, and a decision you committed to in advance.",
  },
];

export default function TestingLadder() {
  const [i, setI] = useState(0);
  const s = stages[i];

  return (
    <figure className="figure" aria-labelledby="ladder-cap">
      <p className="label mb-4">Interactive · Climb the ladder</p>

      <div role="group" aria-label="Verification stages" className="flex items-end gap-1.5 sm:gap-2">
        {stages.map((st, idx) => {
          const reached = idx <= i;
          return (
            <button
              key={st.short}
              type="button"
              aria-pressed={idx === i}
              onClick={() => setI(idx)}
              className="group flex flex-1 flex-col justify-end text-left"
            >
              <span
                className={`block w-full border transition-all duration-200 ${
                  reached ? "border-accent bg-accent" : "hairline bg-paper-deep group-hover:bg-rule"
                }`}
                style={{ height: `${44 + idx * 26}px` }}
              />
              <span
                className={`mt-2 block text-[0.68rem] font-medium leading-tight sm:text-[0.82rem] ${
                  idx === i ? "text-accent" : "text-muted"
                }`}
              >
                <span className="label !text-[0.6rem] block">{idx + 1}</span>
                {st.short}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-6 border-t hairline pt-5" aria-live="polite">
        <h3 className="font-display text-2xl font-medium">
          {i + 1}. {s.title}
        </h3>
        <div className="mt-4 grid gap-x-10 gap-y-5 md:grid-cols-2">
          <div>
            <p className="label !text-accent">What it establishes</p>
            <p className="mt-1 text-[0.97rem]">{s.establishes}</p>
          </div>
          <div className="border-l-2 border-fail pl-4">
            <p className="label !text-fail">What it does not</p>
            <p className="mt-1 text-[0.97rem]">{s.doesNot}</p>
          </div>
        </div>
        <p className="label mt-5">Looks like</p>
        <p className="mt-1 max-w-[38rem] text-[0.97rem]">{s.example}</p>
        <p className="label mt-5">Evidence you have</p>
        <p className="mt-1 max-w-[38rem] text-[0.97rem]">{s.evidence}</p>
      </div>

      <figcaption id="ladder-cap" className="mt-6 max-w-[38rem] text-[0.85rem] text-muted">
        Figure 3. Each rung proves something the one below it cannot. The examples are illustrative.
      </figcaption>
    </figure>
  );
}
