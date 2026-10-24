# syntax=docker/dockerfile:1

# ---- Build the React UI ----
FROM node:22-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json web/
RUN npm ci
COPY web web
RUN npm run build -w web

# ---- Runtime: API + built UI + the sources ----
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY web/package.json web/
RUN npm ci --omit=dev && npm cache clean --force
COPY src src
COPY db db
COPY scripts/start.sh scripts/start.sh
COPY --from=web /app/web/dist web/dist
# The sources are public; bake them into the image so the container can ingest on first boot.
# data/corpus is the crawl (refresh with npm run corpus:pull before building). The manual PDF
# is the fallback when there's no crawl: used if present in the build context, else downloaded.
COPY data data
ARG MANUAL_URL=https://sga.fsu.edu/sites/default/files/PDFs/Accounting/26-27SGAFM.pdf
RUN [ -f data/26-27SGAFM.pdf ] || curl -fsSL -o data/26-27SGAFM.pdf "$MANUAL_URL"
USER node
EXPOSE 3000
CMD ["sh", "scripts/start.sh"]
