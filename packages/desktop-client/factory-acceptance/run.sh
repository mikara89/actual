#!/usr/bin/env bash
set -euo pipefail

: "${FACTORY_RESULTS:?Set FACTORY_RESULTS to the acceptance results folder}"
if (( $# == 0 )); then
  echo "Pass at least one approved acceptance test file." >&2
  exit 1
fi

export FACTORY_ACCEPTANCE_FILES
FACTORY_ACCEPTANCE_FILES=$(printf '%s\n' "$@")
exec yarn workspace @actual-app/web exec vitest run \
  --config factory-acceptance/vitest.config.mts \
  --reporter=junit --outputFile="$FACTORY_RESULTS/acceptance.xml"
