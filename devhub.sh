#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

export HAPI_PUBLIC_URL=https://hapi.localhost
export CORS_ORIGINS=https://hapi.localhost

export HAPI_ORGANIZATION_ID=local-dev
export HAPI_ORGANIZATION_NAME='HAPI Local'
export HAPI_OIDC_ISSUER=https://keycloak.localhost/realms/hapi-local
export HAPI_OIDC_CLIENT_ID=hapi-local
export HAPI_BOOTSTRAP_ADMIN_EMAIL=developer@hapi.local
export HAPI_AUTH_PEPPER=494f306728188cf60f455c8b198c40da78fbef5bc8dff08b7708133a8af3d2e1

docker compose -f compose.local.yml up -d keycloak

echo 'Waiting for local Keycloak...'
until curl --fail --silent --show-error \
    https://keycloak.localhost/realms/hapi-local/.well-known/openid-configuration \
    >/dev/null; do
    sleep 1
done

bun run dev:hub
