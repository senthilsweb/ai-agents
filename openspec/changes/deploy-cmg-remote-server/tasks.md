# Tasks: deploy-cmg-remote-server

## Gate

Owner directed spec-only authoring 2026-08-09 after choosing "all three on
the other Mac" over the split-cloud alternatives (Managed Agents and Claude
Code cloud both declined — see proposal). **Nothing below executes until the
owner approves this change**; the compose/README edits and every server
command are deferred to Construction.

## Bolt 1 — repo edits (dev laptop, then push)

- [ ] `infra/cmg/youtube-transcriber.compose.yml`: `ports: ["8001:8000"]` →
      `["127.0.0.1:8001:8000"]` (design D1).
- [ ] Apply the same bind to the laptop's installed
      `~/opt/cmg/youtube-transcriber/docker-compose.yml` + `docker compose up -d`.
- [ ] `infra/cmg/README.md`: add "Deploying to a remote Mac server" runbook
      section (prereqs, install, SSH trigger, reboot persistence, GHCR note).
- [ ] Commit + push (docs/hardening; no image workflow triggers on these paths).

## Bolt 2 — one-time manual (owner)

- [ ] Flip `ghcr.io/senthilsweb/talk-value-stats` → public in GitHub package
      settings (else: `gh auth token | docker login ghcr.io -u senthilsweb
      --password-stdin` on the server).

## Bolt 3 — server prep

- [ ] `brew install colima docker docker-compose gh` (Homebrew first if absent).
- [ ] Register the compose plugin dir in `~/.docker/config.json`
      (`/opt/homebrew/lib/docker/cli-plugins` on arm64, `/usr/local/lib/…` on Intel).
- [ ] `colima start --cpu 4 --memory 8` and `brew services start colima`.
- [ ] `git clone https://github.com/senthilsweb/ai-agents.git ~/work/ai-agents`.
- [ ] `gh auth login` + `gh auth setup-git` (db.json publish path, design D3).
- [ ] macOS settings: prevent sleep / auto-restart after power failure.

## Bolt 4 — install + start (server)

- [ ] `bash ~/work/ai-agents/infra/cmg/install.sh`.
- [ ] Fill `.env`s: talk-value-stats (`ANTHROPIC_API_KEY`,
      `MODEL_STATS_EXTRACTOR=claude-opus-5`), orchestrator
      (`MODEL_CMG_ORCHESTRATOR=claude-sonnet-5`, `ANTHROPIC_API_KEY` unless a
      Claude Code login exists on the server). chmod 600 (install.sh does).
- [ ] `cd ~/opt/cmg/youtube-transcriber && docker compose pull && docker compose up -d`.
- [ ] `curl -s http://localhost:8001/healthz` → `ready:true, model_loaded:true`.

## Bolt 5 — trigger ergonomics (any client machine)

- [ ] SSH alias, e.g. `alias cmg-run='ssh <server> "source ~/.zprofile;
      ~/opt/cmg/orchestrator/run.sh"'` → `cmg-run "transcribe <url> and add
      it to talk-value-stats"`.

## Verification

- [ ] E2E on the server: one fresh video through `run.sh` → transcript under
      `~/opt/cmg/youtube-transcriber/runs/`, `db.json` upsert in the server's
      clone, site in `~/opt/cmg/talk-value-stats/dist/`.
- [ ] Owner reviews the diff on the server and pushes → Pages deploy green →
      new page live under `/ai-native-numbers/`.
- [ ] Hardening check: from another machine, `nc -z -w3 <static-ip> 8001`
      **fails** (loopback bind holding).
- [ ] Reboot test: power-cycle the server → colima + container auto-start →
      healthz green with no human action.
- [ ] Laptop still works: `git pull` on the laptop clone, one laptop-side run
      still converges on db.json (no duplicate videoId).
- [ ] Governance: `.openspec.yaml` `proposed → approved` before Bolt 1,
      `implemented` after Bolt 4, `verified` after this checklist.
