# Deploying

The app is one Docker image (API + web UI) plus a Postgres database with the pgvector extension. On first boot the container creates the schema and ingests the sources baked into the image (the crawl in `data/corpus`, ~26,000 chunks, a few minutes; or just the manual if there's no crawl), so a fresh database needs no manual steps. Run `npm run corpus:pull` before building to ship the latest crawl. The full corpus needs about 1.5 GB of database storage (most of it the vector index and BM25 terms); Neon's free tier is 0.5 GB, so use a paid tier or set `MANUAL_PATH` and remove `data/corpus` for a manual-only deploy.

Environment variables:

| Variable | Required | What it does |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string. The database must allow `CREATE EXTENSION vector`. |
| `USE_AI` | no | `false` by default: no API calls, even with keys set. `true` uses the keys below. |
| `ANTHROPIC_API_KEY` | no | With `USE_AI=true`, Claude writes answers. Otherwise answers are direct quotes (extractive mode). |
| `OPENAI_API_KEY` | no | With `USE_AI=true`, OpenAI embeddings are used. Otherwise the offline hash embedder is used. |
| `ANSWER_MODEL` | no | Defaults to `claude-sonnet-5-5`. |
| `PORT` | no | Defaults to 3000. Most hosts set this for you. |

**Turning AI on.** The manual is stored once per embedder and the copy is picked by mode. With `USE_AI=true` and `OPENAI_API_KEY` set, the next container start ingests an OpenAI copy next to the offline one; after that, flipping `USE_AI` switches instantly. `/health` shows which embedder and generator are live.

## Option A: Render + Neon (free tiers, simplest)

1. **Database (Neon).** Create a project at neon.tech and copy the connection string (it ends in `?sslmode=require`). Neon supports pgvector; the app enables it itself.
2. **App (Render).** New → Web Service → connect `Amm1el/rso-funding-assistant`. Runtime: Docker. Add the environment variables above. Health check path: `/health`.
3. Deploy. The first boot logs `No sources in the database yet; ingesting ...`, then the server's start-up line.

Free Render services sleep when idle, so the first request after a while takes a few seconds.

## Option B: AWS (App Runner + RDS)

1. **Database.** Create an RDS for PostgreSQL 16 instance (pgvector is supported on RDS PostgreSQL 15.2+). Note the endpoint and credentials. Keep it in a VPC that App Runner can reach.
2. **Image.** Create an ECR repository, then build and push:
   ```bash
   aws ecr get-login-password | docker login --username AWS --password-stdin <account>.dkr.ecr.<region>.amazonaws.com
   docker build -t rso-funding-assistant .
   docker tag rso-funding-assistant <account>.dkr.ecr.<region>.amazonaws.com/rso-funding-assistant:latest
   docker push <account>.dkr.ecr.<region>.amazonaws.com/rso-funding-assistant:latest
   ```
3. **Service.** Create an App Runner service from the ECR image, port 3000, health check `/health`, with a VPC connector to the RDS VPC. Put the API keys in Secrets Manager and reference them as environment variables.

App Runner + RDS is the more "real-world" setup to talk about in interviews, but unlike Option A it costs money while running. Tear it down when you're not demoing.

## Run the production image locally

```bash
docker compose --profile app up --build     # db + app, then open http://localhost:3000
```
