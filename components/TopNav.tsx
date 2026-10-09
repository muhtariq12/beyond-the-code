"use client";

import { useEffect, useState } from "react";
import { sections } from "@/lib/sections";

export default function TopNav() {
  const [progress, setProgress] = useState(0);
  const [active, setActive] = useState<string>("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  useEffect(() => {
    const els = sections
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => el !== null);
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length) setActive(visible[0].target.id);
      },
      { rootMargin: "-20% 0px -65% 0px" },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b hairline bg-paper/92 backdrop-blur-sm">
      <div
        className="absolute inset-x-0 top-0 h-[3px] bg-transparent"
        role="progressbar"
        aria-label="Reading progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
      >
        <div
          className="h-full origin-left bg-accent"
          style={{ transform: `scaleX(${progress})` }}
        />
      </div>
      <nav
        aria-label="Sections"
        className="mx-auto flex h-12 max-w-6xl items-center justify-between gap-6 px-4 sm:px-6"
      >
        <a href="#top" className="font-display text-[1.05rem] font-medium tracking-tight">
          Beyond the Code
        </a>

        <ol className="hidden items-center gap-5 lg:flex">
          {sections.map((s, i) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                aria-current={active === s.id ? "location" : undefined}
                aria-label={s.title}
                title={s.title}
                className={`label !text-[0.68rem] border-b pb-0.5 transition-colors ${
                  active === s.id
                    ? "border-accent !text-accent"
                    : "border-transparent hover:!text-ink"
                }`}
              >
                {String(i + 1).padStart(2, "0")}
              </a>
            </li>
          ))}
        </ol>

        <button
          type="button"
          className="label flex items-center gap-2 lg:hidden"
          aria-expanded={open}
          aria-controls="mobile-sections"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Close" : "Contents"}
        </button>
      </nav>

      {open && (
        <ol
          id="mobile-sections"
          className="border-t hairline bg-paper px-4 py-2 lg:hidden"
        >
          {sections.map((s, i) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                onClick={() => setOpen(false)}
                aria-current={active === s.id ? "location" : undefined}
                className={`flex gap-3 py-2 text-[0.95rem] ${
                  active === s.id ? "text-accent" : ""
                }`}
              >
                <span className="label w-6 pt-1">{String(i + 1).padStart(2, "0")}</span>
                {s.title}
              </a>
            </li>
          ))}
        </ol>
      )}
    </header>
  );
}
