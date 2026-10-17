#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm run local:setup
exec npm run dev
