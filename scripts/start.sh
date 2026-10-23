#!/bin/sh
# Container entrypoint: bring the schema up to date, ingest the manual if the database
# has none, then start the API + web UI. Safe to run on every boot.
set -e
MANUAL="${MANUAL_PATH:-data/26-27SGAFM.pdf}"
npx tsx src/cli/migrate.ts
if [ "$(npx tsx src/cli/has-manual.ts)" = "no" ]; then
  echo "No manual in the database yet; ingesting $MANUAL"
  npx tsx src/cli/ingest.ts "$MANUAL"
fi
exec npx tsx src/server.ts
