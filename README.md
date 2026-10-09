# Beyond the Code

An interactive essay on a simple idea: AI has made writing software much faster, but making all the pieces work together, and solving the right problem, is still hard.

It is written from my experience building business applications, integrating systems, and working with AI coding agents. The article is built to teach one thing well, using small interactive pieces instead of long explanation:

- **A form, a complicated system.** Tap a field in a tenant registration form to see which systems it depends on.
- **Follow the data.** An SVG system diagram. Select a component to see its role, how it fails, and how far the failure travels.
- **What does "working" mean?** A five-rung ladder from "it compiles" to "it delivers measurable value", showing what each rung proves and what it does not.
- **A hypothetical investigation.** A made-up tenant-to-unit mapping bug, walked through as symptom, root causes, evidence, smallest test and success criterion.

## About the content

The projects mentioned (a real-estate/ERP integration, Sanad, Tareeeq) are works in progress, and the essay says so. The tenant-mapping scenario is hypothetical and labelled as such. The page makes no claims about deployments, users or measured results.

## Stack

- Next.js 15 (App Router) and TypeScript, statically rendered
- Tailwind CSS v4 with a few custom styles
- Hand-written SVG and small React client components, no chart or animation libraries
- Geist and Fraunces fonts
- No backend, database, analytics, API keys or environment variables

## Local setup

Requires Node.js 20 or newer.

```bash
npm install
npm run dev        # http://localhost:3000
```

Checks:

```bash
npm run lint
npm run typecheck
npm run build
```

## Deploy on Vercel

1. Push this repository to GitHub.
2. In Vercel, choose **Add New... > Project** and import the repository.
3. Keep the detected Next.js settings and deploy. No environment variables are needed.

Or with the CLI: `npx vercel` for a preview, `npx vercel --prod` for production.

On Vercel, the Open Graph image URL is built from `VERCEL_PROJECT_PRODUCTION_URL`, which Vercel sets automatically.

## Structure

```
app/            page, layout, metadata, icon, Open Graph image
components/     TopNav (progress + navigation) and the four interactive figures
lib/            diagram data and layouts, section list
```
