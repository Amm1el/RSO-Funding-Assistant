# Deploying

The app is one Docker image (API + web UI) plus a Postgres database with the pgvector extension. On first boot the container creates the schema and ingests the manual baked into the image, so a fresh database needs no manual steps.

Environment variables:

| Variable | Required | What it does |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string. The database must allow `CREATE EXTENSION vector`. |
| `ANTHROPIC_API_KEY` | no | Turns on Claude-written answers. Without it, answers are direct quotes (extractive mode). |
| `OPENAI_API_KEY` | no | Turns on OpenAI embeddings for ingest. Without it, the offline hash embedder is used. |
| `ANSWER_MODEL` | no | Defaults to `claude-sonnet-5-5`. |
| `PORT` | no | Defaults to 3000. Most hosts set this for you. |

**Changing embedders needs a re-ingest.** The embedder is recorded with the ingested manual, and questions are always embedded with the same one. If the first boot ingested with the offline embedder and you add `OPENAI_API_KEY` later, run `npm run ingest -- data/26-27SGAFM.pdf` against the production `DATABASE_URL` once, from your machine. `/health` shows which embedder and generator are live.

## Option A: Render + Neon (free tiers, simplest)

1. **Database (Neon).** Create a project at neon.tech and copy the connection string (it ends in `?sslmode=require`). Neon supports pgvector; the app enables it itself.
2. **App (Render).** New → Web Service → connect `Amm1el/rso-funding-assistant`. Runtime: Docker. Add the environment variables above. Health check path: `/health`.
3. Deploy. The first boot logs `No manual in the database yet; ingesting ...`, then `RSO Funding Assistant on http://localhost:...`.

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
