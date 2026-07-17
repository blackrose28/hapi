#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
temp_dir="$(mktemp -d)"
trap 'rm -rf "$temp_dir"' EXIT

command -v mkcert >/dev/null || {
    echo "mkcert is required." >&2
    exit 1
}

mkcert -install
mkcert -cert-file "$temp_dir/hapi.localhost.pem" -key-file "$temp_dir/hapi.localhost-key.pem" \
    hapi.localhost localhost 127.0.0.1 ::1
mkcert -cert-file "$temp_dir/keycloak.localhost.pem" -key-file "$temp_dir/keycloak.localhost-key.pem" \
    keycloak.localhost localhost 127.0.0.1 ::1

sudo install -d -m 0755 /etc/nginx/tls
sudo install -m 0644 "$temp_dir/hapi.localhost.pem" /etc/nginx/tls/hapi.localhost.pem
sudo install -m 0600 "$temp_dir/hapi.localhost-key.pem" /etc/nginx/tls/hapi.localhost-key.pem
sudo install -m 0644 "$temp_dir/keycloak.localhost.pem" /etc/nginx/tls/keycloak.localhost.pem
sudo install -m 0600 "$temp_dir/keycloak.localhost-key.pem" /etc/nginx/tls/keycloak.localhost-key.pem
sudo install -m 0644 "$repo_root/dev/nginx/hapi-local.conf" /etc/nginx/sites-available/hapi-local
sudo ln -sfn /etc/nginx/sites-available/hapi-local /etc/nginx/sites-enabled/hapi-local
sudo nginx -t
sudo systemctl reload nginx

echo "Local TLS proxy configured:"
echo "  HAPI:     https://hapi.localhost"
echo "  Keycloak: https://keycloak.localhost"
