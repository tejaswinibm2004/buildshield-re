# DECISIONS.md — choices where spec is silent

- DB: `node:sqlite` DatabaseSync (Node 24 built-in), WAL mode, single file. No ORM.
- Password hashing: `crypto.scryptSync` N=16384, 32-byte salt, 64-byte key. Constant-time compare.
- Sessions: 256-bit random hex token, SHA-256 hash stored. Cookie `bs_session`.
- IDs: issues `ISSUE-<8 hex>`, keys `bsk_<32 hex>` shown once, stored as SHA-256 hash.
- GitHub: plain `fetch` to REST API (no @octokit) to keep deps small. Tarball snapshot + cache.
- AI: OpenAI-compatible Chat Completions via fetch. `AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY`. Fake provider when no key (`AI_UNAVAILABLE` honest state).
- Frontend: vanilla HTML/CSS/JS, no build step. `ws` for live updates.
- Validators: lightweight parsers where possible without heavy deps (regex/balance checks for html/css; `node --check` for JS; JSON.parse; js-yaml if installed else fallback; external runtimes probed, NOT_PERFORMED if missing).
- Diff: search/replace edits with uniqueness check, unified diff generated in code.
- CORS: only `POST /api/v1/issues` + OPTIONS open; everything else same-origin.
- CSRF: `X-Requested-With: bugshield` + Origin/Host check on mutations.
- Backups: copy SQLite file nightly to `backups/` keep 7 (best-effort, logged).
- Queue: in-process FIFO with per-site mutex + concurrency limit, resumable on boot.
- Members: direct create by owner/admin (POST /members); one-time invite links + SMTP deferred as future work.
- Screenshots: skipped (stretch goal); widget captures element context + console/errors/network instead.
- Headless-browser reproduction: not implemented; evidence honestly says "not performed".
- Project-owned test suites: detected conceptually but NOT auto-run (no dep install in sandbox, no secrets to project scripts); validator reports NOT_PERFORMED honestly.
- WS auth: browser cookies sent on handshake are used; no JS-readable session token.
