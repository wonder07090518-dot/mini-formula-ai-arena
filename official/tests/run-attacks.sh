#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."
exec node --test official/tests/*.test.mjs
