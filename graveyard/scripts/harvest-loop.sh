#!/usr/bin/env bash
# Resilient Zenodo harvest: the undici HTTP parser throws an uncatchable
# ERR_ASSERTION on some Zenodo responses, crashing the whole process. Since the
# harvester resumes cheaply from zenodo-attempted.json, just restart it.
cd "$(dirname "$0")/.."
for i in $(seq 1 50); do
  echo "=== harvest attempt $i $(date) ==="
  pnpm tsx scripts/ingest-zenodo.ts 800 40 && { echo "=== harvest completed cleanly ==="; break; }
  echo "=== crashed (exit $?), restarting in 5s ==="; sleep 5
done
