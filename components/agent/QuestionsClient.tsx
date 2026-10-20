"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function QuestionsClient({ id }: { id: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <div>
      <textarea aria-label="Employer questions, one per line" rows={5} value={text} onChange={(e) => setText(e.target.value)} />
      <button
        className="btn sm"
        style={{ marginTop: 8 }}
        onClick={async () => {
          setErr(null);
          const questions = text.split("\n").map((t) => t.trim()).filter((t) => t.length >= 3).map((t) => ({ text: t }));
          if (!questions.length) return;
          const res = await fetch("/api/agent/applications", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "add-questions", id, questions }) });
          if (!res.ok) setErr((await res.json()).error ?? "Failed");
          else { setText(""); router.refresh(); }
        }}
      >
        Prepare answers
      </button>
      {err ? <div role="alert" className="notice bad" style={{ marginTop: 6 }}>{err}</div> : null}
    </div>
  );
}
