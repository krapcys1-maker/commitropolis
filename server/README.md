# Commitverse mapping service

Builds a city (the full git history of a repository) on request, so any world in the universe can be landed on. It is plain Node with no dependencies. Each job runs `ingest/ingest.mjs` in a child process.

## Run

```bash
docker compose -f server/docker-compose.yml up -d --build
curl localhost:8787/health
```

Without Docker: `node server/server.mjs` (Node 20+ and `git` on PATH).

Then point the site at it: set `"api"` in `public/config.json` (for example `"https://mapper.example.com"`) and redeploy. For a quick test without redeploying, add `?api=https://…` to the site URL.

## API

| | |
|---|---|
| `POST /api/map` `{"repo":"owner/name"}` | Queue a public repository. Returns the job (`queued`, `mapping`, `done`, `error`) |
| `GET /api/map/:slug` | Job status; `step` is one of `clone`, `scan`, `history`, `layout`, `write`, `done` |
| `GET /api/city/:slug` | The city bundle once mapped (slug = `owner-name`, lower case) |
| `GET /health` | Liveness and queue length |

## Settings (environment)

| Variable | Default | |
|---|---|---|
| `ALLOWED_ORIGIN` | `*` | CORS origin of the site |
| `GITHUB_TOKEN` | – | Optional; raises the GitHub API limit for metadata checks |
| `MAX_REPO_MB` | `400` | Larger repositories are refused |
| `CONCURRENCY` | `1` | Parallel mapping jobs |
| `FRESH_HOURS` | `24` | A city newer than this is served as is |
| `JOB_TIMEOUT_MIN` | `15` | A job is killed after this |
| `RATE_PER_HOUR` | `20` | Map requests per IP per hour |

Clones are deleted after each job (`--clean`); only the city bundles are kept, in the `/data` volume.
