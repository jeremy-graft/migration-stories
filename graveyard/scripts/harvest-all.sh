#!/usr/bin/env bash
# Unattended harvest pipeline. PGlite is single-writer, so these run in SEQUENCE,
# not parallel. Each stage is resumable (attempt markers / attempted-sets), so the
# crash-restart loops just pick up where an undici assertion killed the process.
cd "$(dirname "$0")/.."

run() { # name, then command — restart up to N times on non-zero exit
  local name="$1"; shift
  for i in $(seq 1 40); do
    echo "=== $name (attempt $i) $(date) ==="
    "$@" && { echo "=== $name: clean exit ==="; return 0; }
    echo "=== $name crashed (exit $?), restart in 5s ==="; sleep 5
  done
}

echo "########## [1/3] Movebank incl. NC — new-species-first ##########"
run movebank pnpm tsx scripts/ingest-movebank.ts movebank-studies.csv 250

echo "########## [2/3] Dryad (CC0) ##########"
run dryad pnpm tsx scripts/ingest-dryad.ts 400 15

echo "########## [3/3] Zenodo (resume deep) ##########"
run zenodo pnpm tsx scripts/ingest-zenodo.ts 800 40

echo "########## PIPELINE COMPLETE $(date) ##########"
