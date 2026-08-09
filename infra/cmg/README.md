# infra/cmg — "claude managed agents, local" host tooling

Installs and runs the `~/opt/cmg/<agent>` tree: locally *deployed* agents
(Docker) plus the Claude Agent SDK orchestrator that performs the A2A handoff
between them. Generic host tooling in the spirit of `infra/firecracker/` —
but for a developer machine (macOS/Linux with Docker), not a KVM host.

Naming note: "cmg" is the owner's convention. Anthropic's **Managed Agents**
product is cloud-only (no local mode), and "A2A" as a protocol is Google's —
here A2A means Claude Agent SDK subagent delegation over locally deployed
capabilities. See `openspec/changes/add-cmg-local-deploy/`.

## Layout installed by `install.sh`

```
~/opt/cmg/
  youtube-transcriber/   docker-compose.yml (GHCR image, :8001), .env, runs/, cache/
  talk-value-stats/      .env (API key + model), run-extract.sh, run-build.sh, dist/
  orchestrator/          .env, .venv/ (pip install -e agents/cmg-orchestrator), run.sh
```

The transcriber is a long-running service (resident ASR model). The stats
agent is a **one-shot image** — `docker run --rm` per extract/build, key via
`--env-file` only. The transcript handoff is the shared `runs/` directory:
the transcriber writes it, the stats container mounts it read-only
(`TRANSCRIBER_RUNS=/data/runs`). The repo's `db.json` is bind-mounted into
the stats container so upserts land in the git working tree, ready for the
human-run Pages publish.

## Quick start

```bash
infra/cmg/install.sh                 # idempotent; never overwrites an existing .env
# fill in the flagged .env files
cd ~/opt/cmg/youtube-transcriber && docker compose pull && docker compose up -d
curl -s http://localhost:8001/healthz
~/opt/cmg/orchestrator/run.sh "transcribe <youtube-url-or-id> and add it to talk-value-stats"
cd ~/opt/cmg/talk-value-stats/dist && python3 -m http.server 8080   # preview
```

Publish (human-run, after eyeballing the diff):

```bash
git diff agents/talk-value-stats/db.json
git add agents/talk-value-stats/db.json && git commit -m "talk-value-stats: add <title> (<id>)" && git push
```

The push triggers the unified `job-scout-docs.yml` Pages deploy — the new
page lands under `/ai-native-numbers/`. Transcripts never leave `~/opt/cmg`.

## Public transcriber (`transcriber.nathansweb.com`)

To expose the transcriber to the internet (the Managed-Agent driver and any
remote caller), on the box that runs it:

1. Deploy as below (`install.sh` → fill `.env` → `docker compose pull && up
   -d`). The compose binds **127.0.0.1:8001** — the public path is a tunnel,
   never a routable port.
2. **Set `TRANSCRIBER_API_KEY`** in `youtube-transcriber/.env`
   (`openssl rand -hex 24`) — with it set, every endpoint except
   `GET /healthz` requires the `X-API-Key` header. Do not create the DNS
   route before the key is set.
3. Cloudflare tunnel (same pattern as the MinIO vhosts):
   `cloudflared tunnel` ingress `transcriber.nathansweb.com` →
   `http://localhost:8001`, then the DNS record for the tunnel.
4. Verify from anywhere:
   `curl https://transcriber.nathansweb.com/healthz` → 200;
   `/jobs` without key → 401; with `X-API-Key` → 200.

## Object-store mode (add-object-store-state)

Set the `OBJECT_STORE_*` block in the transcriber and talk-value-stats
`.env`s (and `OBJECT_STORE_BUCKET` in the orchestrator's, as the flag) and
state stops flowing through mounts: the transcriber mirrors every run's
artifacts to `s3://<bucket>/youtube-transcriber/runs/…`, and the stats
container pulls transcripts and syncs `talk-value-stats/db.json` through
the store — `docker run` with an env-file and nothing else. Publishing
gains one step: `sync-db.sh` refreshes the repo's `db.json` from the store
before the usual human `git diff`/commit/push.

Endpoint gotcha (verified): the owner's MinIO serves its **S3 API on the
`minio-console.` hostname** and the web console on `minio.` — the names are
swapped; set `OBJECT_STORE_ENDPOINT` to the console-named host.

## Images

- `ghcr.io/senthilsweb/youtube-transcriber` — multi-arch (amd64 + native
  arm64) as of add-cmg-local-deploy; Apple Silicon pulls run ASR natively.
- `ghcr.io/senthilsweb/talk-value-stats` — one-shot image, no CMD, no baked
  secrets.
- Local fallback while CI hasn't published:
  `docker build -t ghcr.io/senthilsweb/<name>:latest agents/<name>`.
