# BugShield architecture — see PLAN.md. Single process: Express + ws + node:sqlite + in-process queue.
# Pipeline: widget → ingestion → orchestrator (intake/localizer/analyzer/risk/patcher/critic/validator → approval gate → deployer → verifier) → GitHub commit → Render rebuild → version.json check.
