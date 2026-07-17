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

Open `https://hapi.localhost` and sign in with:

- Username: `developer`
- Password: `developer`

Keycloak administration is available at `https://keycloak.localhost/admin/` with
the local-only credentials `admin` / `admin`.

The Keycloak database is stored in the `hapi_hapi-local-keycloak-data` Docker
volume. To discard all local Keycloak state and re-import the realm fixture:

```bash
docker compose -f compose.local.yml down -v
docker compose -f compose.local.yml up -d keycloak
```
