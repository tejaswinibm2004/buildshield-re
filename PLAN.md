# BugShield — Build Plan

## Architecture
- Single Node.js 24 process: Express + `ws` + `node:sqlite` (WAL) + in-process job queue.
- Two repos: `bugshield-platform` (this repo, dashboard+API) and `quickbyte-shop` (demo client, separate).
- Flow: Widget SDK → `POST /api/v1/issues` → Orchestrator (Intake→Localizer→Analyzer→Risk→Patcher→Critic→Validator→[Approval?]→Deployer→Verifier) → GitHub commit → Render rebuild → version.json verification.
- Human gate: score >= 70 OR security-sensitive path/marker → AWAITING_APPROVAL. Default autoDeploy=TRUE for non-critical.

## Folder layout
```
server.js
src/config.js
src/db/{schema.sql,db.js,migrations.js}
src/http/{router.js,auth.js,csrf.js,rateLimit.js,redact.js}
src/ai/{provider.js,json.js,prompts/*.md}
src/github/{client.js,repoReader.js,committer.js}
src/agents/{intake.js,localizer.js,analyzer.js,risk.js,patcher.js,critic.js,validator.js,deployer.js,verifier.js,orchestrator.js,safety.js}
src/validators/{index.js,js.js,json.js,html.js,css.js,python.js,php.js,ruby.js,go.js,yaml.js,ts.js,generic.js}
src/queue/{jobQueue.js,locks.js}
public/{index.html,app.js,styles.css,sdk/bugshield.js,sdk/bs.js}
benchmark/{cases.json,runner.mjs,fixtures/...}
tests/*.test.js
docs/{ARCHITECTURE.md,RUNBOOK.md}
render.yaml, DECISIONS.md, PLAN.md
```

## Milestones
- [x] M0 plan + repo scaffold
- [x] M1 Skeleton: config, DB, auth, health, audit, dashboard shell, render.yaml, tests
- [x] M2 Websites + keys + ingestion API + widget SDK + demo client template
- [x] M3 AI provider + Intake + Localizer + GitHub repo reader
- [x] M4 Analyzer + Risk + Patcher + Critic + safety scanner + diff UI
- [x] M5 Validator registry + evidence UI (+ honest project-tests NOT_PERFORMED)
- [x] M6 Deployer + Verifier + revert + client build script
- [x] M7 Approval gate + roles + WebSocket + settings
- [x] M8 Widget extras (picker, console/error/network capture; screenshot skipped per DECISIONS)
- [x] M9 Benchmark (21 cross-stack cases) + eval page + hardening (redaction, backups, resume, mutex)
- [ ] M10 Render go-live per RUNBOOK.md (manual — needs human: PAT, env vars, repos; record in docs/EVIDENCE.md)

## Test commands
- `npm test` — node:test suite
- `npm run eval` — benchmark runner (fixtures mode, no key needed)
