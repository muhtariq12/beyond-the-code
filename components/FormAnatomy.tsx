"use client";

import { useState } from "react";

const systems = ["Identity", "Units", "Sync", "NetSuite", "Access"] as const;
type S = (typeof systems)[number];

const fields: { id: string; label: string; placeholder: string; touches: S[]; why: string }[] = [
  {
    id: "name",
    label: "Full name",
    placeholder: "As on the lease",
    touches: ["Identity"],
    why: "Looks harmless. But “as on the lease” means it may need to match a name that lives in the ERP, in a spelling the tenant did not choose.",
  },
  {
    id: "contact",
    label: "Phone or email",
    placeholder: "name@example.com",
    touches: ["Identity", "Access"],
    why: "This becomes the login. It decides whether an account already exists, and later who may open what.",
  },
  {
    id: "building",
    label: "Building",
    placeholder: "Select a building",
    touches: ["Units", "Sync"],
    why: "The list of buildings has to come from somewhere, and has to stay current as the ERP changes.",
  },
  {
    id: "unit",
    label: "Unit number",
    placeholder: "e.g. 204",
    touches: ["Units", "Sync", "NetSuite", "Access"],
    why: "One short field. It must resolve to exactly one unit in the ERP, which must still exist and still be available, and it sets what this person may see afterwards.",
  },
];

export default function FormAnatomy() {
  const [active, setActive] = useState<string>("unit");
  const current = fields.find((f) => f.id === active)!;

  return (
    <figure className="figure" aria-labelledby="form-cap">
      <p className="label mb-4">Interactive · Tap a field</p>
      <div className="grid gap-8 md:grid-cols-[minmax(0,22rem)_1fr]">
        <form
          onSubmit={(e) => e.preventDefault()}
          className="border hairline bg-[#fbf9f4] p-5"
          aria-label="Example tenant registration form (not functional)"
        >
          <p className="font-display text-xl">Register as a tenant</p>
          <div className="mt-4 space-y-3">
            {fields.map((f) => (
              <div key={f.id}>
                <label htmlFor={`f-${f.id}`} className="block text-[0.82rem] font-medium">
                  {f.label}
                </label>
                <input
                  id={`f-${f.id}`}
                  type="text"
                  placeholder={f.placeholder}
                  onFocus={() => setActive(f.id)}
                  onClick={() => setActive(f.id)}
                  className={`mt-1 w-full border bg-paper px-3 py-2 text-[0.95rem] outline-none transition-colors ${
                    active === f.id ? "border-accent ring-1 ring-accent" : "hairline"
                  }`}
                />
              </div>
            ))}
          </div>
          <button
            type="submit"
            className="mt-5 w-full bg-ink px-4 py-2.5 text-[0.9rem] font-medium text-paper"
            onClick={() => setActive("unit")}
          >
            Create my account
          </button>
          <p className="mt-2 text-[0.75rem] text-muted">Demo form. It sends nothing anywhere.</p>
        </form>

        <div aria-live="polite">
          <p className="label !text-accent">“{current.label}” touches</p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {systems.map((s) => {
              const on = current.touches.includes(s);
              return (
                <li
                  key={s}
                  className={`border px-3 py-1 text-[0.85rem] transition-colors ${
                    on ? "border-accent bg-accent text-paper" : "hairline text-muted line-through decoration-[#d8d1c1]"
                  }`}
                >
                  {s}
                  <span className="sr-only">{on ? " (involved)" : " (not involved)"}</span>
                </li>
              );
            })}
          </ul>
          <p className="mt-4 max-w-[30rem] text-[0.97rem]">{current.why}</p>
        </div>
      </div>
      <figcaption id="form-cap" className="mt-6 max-w-[38rem] text-[0.85rem] text-muted">
        Figure 2. Four fields on a form, and the systems each one quietly depends on.
      </figcaption>
    </figure>
  );
}
