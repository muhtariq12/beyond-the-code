/**
 * Browser smoke test against a running instance (see README "Browser smoke test").
 *   BASE_URL=http://localhost:3111 AGENT_ACCESS_PASSWORD=... SHOT_DIR=/tmp/shots npx tsx scripts/e2e-smoke.mts
 * Uses demo data only. Drives the real UI: login, every page, CV approval, hand-off and manual attestation.
 */
import { chromium } from "playwright-core";
import fs from "node:fs";

const base = process.env.BASE_URL ?? "http://localhost:3111";
const shots = process.env.SHOT_DIR ?? "";
const exe = fs.readdirSync("/opt/pw-browsers").filter((d) => d.startsWith("chromium-"))[0];
const browser = await chromium.launch({ executablePath: `/opt/pw-browsers/${exe}/chrome-linux/chrome`, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1360, height: 900 } })).newPage();
const errors: string[] = [];
page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
page.on("response", (r) => { if (r.status() >= 400 && !r.url().endsWith("/api/agent/login")) errors.push(`HTTP ${r.status()} from ${r.url()}`); });
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
const ok = (c: boolean, msg: string) => { if (!c) { errors.push(`FAIL: ${msg}`); console.log("FAIL:", msg); } else console.log("ok  :", msg); };
const shot = async (n: string) => { if (shots) await page.screenshot({ path: `${shots}/${n}.png`, fullPage: true }); };

// unauthenticated access is refused
await page.goto(`${base}/agent`);
ok(page.url().endsWith("/agent/login"), "unauthenticated /agent redirects to login");
await page.fill("#pw", "wrong-password");
await page.click("button:has-text('Sign in')");
ok(await page.locator("[role=alert]").isVisible(), "wrong password rejected");
errors.length = 0; // the 401 above is expected
await page.fill("#pw", process.env.AGENT_ACCESS_PASSWORD ?? "");
await page.click("button:has-text('Sign in')");
await page.waitForURL(`${base}/agent`);
await shot("01-overview");
ok((await page.textContent(".metric .n")) !== null, "overview renders metrics");

for (const [path, expect, name] of [
  ["/agent/discover", "Discover Jobs", "02-discover"], ["/agent/matches", "Matched Jobs", "03-matches"],
  ["/agent/studio", "CV Studio", "04-studio"], ["/agent/applications", "Applications", "06-applications"],
  ["/agent/followups", "Follow-ups", "07-followups"], ["/agent/sources", "Sources", "08-sources"],
  ["/agent/settings?tab=preferences", "Settings", "09-settings"], ["/agent/settings?tab=profile", "Settings", "10-profile"], ["/agent/settings?tab=system", "Settings", "11-system"],
] as const) {
  await page.goto(`${base}${path}`);
  ok(await page.locator("h1", { hasText: expect }).isVisible(), `${path} renders`);
  await shot(name);
}

// job detail + CV Studio for the best-matching job
await page.goto(`${base}/agent/matches?view=apply`);
const first = page.locator("tbody tr a.t-title").first();
const title = await first.textContent();
await first.click();
await page.waitForSelector("text=Stage A: hard eligibility");
await shot("05a-job");
ok(true, `job detail for "${title}"`);
await page.click("text=Open CV Studio");
await page.waitForSelector("text=What changed for this job");
await shot("05-cv-compare");
await page.click("a:has-text('Claims & evidence')");
await page.waitForSelector("text=traces to a verified fact");
await page.click("a:has-text('ATS checks')");
await page.waitForSelector("text=Single-column layout");
await page.click("a:has-text('PDF preview')");
await page.waitForSelector("iframe.pdf");
const href = await page.getAttribute("a:has-text('Download PDF')", "href");
const pdf = await page.request.get(`${base}${href}`);
ok(pdf.ok() && (await pdf.body()).subarray(0, 5).toString() === "%PDF-", "PDF download is a real PDF");
const docx = await page.request.get(`${base}${await page.getAttribute("a:has-text('Download DOCX')", "href")}`);
ok(docx.ok() && (await docx.body()).subarray(0, 2).toString() === "PK", "DOCX download is a real DOCX");

// approve, then approve the application, hand off, attest
await page.click("a:has-text('Compare')");
await page.click("button:has-text('Approve this version')");
await page.waitForSelector("text=Approved versions are frozen");
await page.click("a:has-text('Go to application')");
await page.waitForSelector("text=Application answers");
await shot("12-application");
await page.click("button:has-text('Approve application with CV')");
await page.waitForSelector("button:has-text('I applied myself')");
ok(await page.locator("button:has-text('Submit via authorised integration')").count() === 0, "no auto-submit offered for non-authorised provider");
ok(await page.locator("text=Automatic submission is not authorised").isVisible(), "explains hand-off route");
await shot("13-handoff");
page.once("dialog", (d) => d.accept());
await page.click("button:has-text('I applied myself')");
await page.waitForSelector("text=Self-reported");
await shot("14-attested");

await page.goto(`${base}/agent`);
ok((await page.locator(".metric", { hasText: "Confirmed submissions" }).textContent())?.includes("1 self-reported") ?? false, "overview counts self-reported submission separately");

// mobile layout
await page.setViewportSize({ width: 390, height: 800 });
await page.goto(`${base}/agent/matches`);
ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "no horizontal page scroll at 390px");
await shot("15-mobile");

await browser.close();
// the wrong-password login returns 401 on purpose; the browser also probes /favicon.ico (404). Real HTTP failures are caught by the response handler above.
const bad = errors.filter((e) => !/favicon|status of 401|status of 404/.test(e));
if (bad.length) { console.log("\nProblems:\n" + bad.join("\n")); process.exit(1); }
console.log("\nSmoke test passed.");
