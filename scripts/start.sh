#!/bin/sh
# Container entrypoint: bring the schema up to date, ingest the sources if the database has
# none for the current mode, then start the API + web UI. Safe to run on every boot.
# Uses the crawled corpus in data/corpus when present (all of SGA), else just the manual.
set -e
MANUAL="${MANUAL_PATH:-data/26-27SGAFM.pdf}"
npx tsx src/cli/migrate.ts
if [ "$(npx tsx src/cli/has-manual.ts)" = "no" ]; then
  if [ -f data/corpus/manifest.json ]; then
    echo "No sources in the database yet; ingesting the crawled corpus (a few minutes)"
    npx tsx src/cli/ingest-corpus.ts
  else
    echo "No sources in the database yet; ingesting $MANUAL"
    npx tsx src/cli/ingest.ts "$MANUAL"
  fi
fi
exec npx tsx src/server.ts
