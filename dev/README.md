# Local Shared Hub development

One-time host setup:

```bash
./scripts/setup-local-dev.sh
```

Run the Hub and local Keycloak:

```bash
./devhub.sh
```

Run the web app in another terminal:

```bash
./devweb.sh
```

Open `https://chuonglvubuntu.local` and sign in with:

- Username: `developer`
- Password: `developer`

Keycloak administration is available at `https://chuonglvubuntu.local:8443/admin/`
with the local-only credentials `admin` / `admin`.

`https://hapi.localhost` / `https://keycloak.localhost` still resolve (loopback-only)
for local API/CLI traffic — e.g. runners already enrolled against `hapi.localhost`
keep working unchanged — but sign-in only completes via `chuonglvubuntu.local`,
since that's the hostname Keycloak (`KC_HOSTNAME`) now issues tokens for. Other
devices on the LAN can reach the web UI the same way, at `https://chuonglvubuntu.local`,
as long as they can resolve mDNS (`.local`) hostnames — this works out of the box on
macOS/iOS (Bonjour) and most Linux desktops (Avahi); Android and some Windows setups
may need an mDNS-aware app/browser or a manual `/etc/hosts` entry.

The Keycloak database is stored in the `hapi_hapi-local-keycloak-data` Docker
volume. Since the realm fixture's redirect URIs/web origins changed, you must wipe
and re-import it once for the new hostname to take effect:

```bash
docker compose -f compose.local.yml down -v
docker compose -f compose.local.yml up -d keycloak
```

This discards any local Keycloak state beyond the fixture (e.g. extra test users
you created by hand).
