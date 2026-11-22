#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"
if [ "${1-}" = "--engine" ]; then
  echo 'Private-engine integration is unavailable; refusing to run the private runner without verified isolation.' >&2
  exit 1
fi
echo 'Study smoke test only; this is not an official result.' >&2
exec node --import tsx practice/race.mjs "$@"
