import type { Metadata } from "next";
import "./agent.css";

export const metadata: Metadata = {
  title: "Job Agent",
  description: "Personal job-search and application agent",
  robots: { index: false, follow: false },
};

export default function AgentRoot({ children }: { children: React.ReactNode }) {
  return <div className="ag">{children}</div>;
}
