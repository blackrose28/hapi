#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

export HAPI_PUBLIC_URL=https://hapi.localhost
export CORS_ORIGINS=https://hapi.localhost

bun run --cwd web dev --host 127.0.0.1 --port 15173 --strictPort
