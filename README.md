# BugShield Platform

Multi-Agent Driven Intelligent Bug Detection and Secure Deployment System. See `PLAN.md`, `docs/ARCHITECTURE.md`, `docs/RUNBOOK.md`, `DECISIONS.md`.

## Quick start
```bash
npm install
cp .env.example .env   # set AI_*, GITHUB_TOKEN, BOOTSTRAP_OWNER_*
npm test               # all green required
npm run eval           # offline benchmark -> benchmark/results.json
node server.js         # :3000, data in ./.var/data
```

## Env vars
PORT, NODE_ENV, BUGSHIELD_DATA_DIR (use /var/data on Render), PUBLIC_BASE_URL,
BOOTSTRAP_OWNER_EMAIL, BOOTSTRAP_OWNER_PASSWORD (set before first boot),
AI_BASE_URL, AI_MODEL, AI_API_KEY (missing => honest AI_UNAVAILABLE),
GITHUB_TOKEN (fine-grained, Contents R&W), RENDER_API_KEY (optional),
APP_SECRET_KEY (32+ bytes), QUEUE_CONCURRENCY.

## Honest limits
Single instance (SQLite + in-process queue). Deploy = commit then host rebuilds (1–3 min). Free models flake. Without project tests the result is labelled UNVERIFIED. Some validators need runtimes on the host. See spec §21.

## Demo client
Copy `client-template/` into its own repo `quickbyte-shop` (static site on Render, Auto-Deploy ON, build `node scripts/build.mjs`). Planted bugs in `client-template/` + `docs/PLANTED_BUGS.md` (create before demo).
