# Shared Hub release qualification walkthrough

Use this runbook to qualify release candidate `a4a93b7a5247ea3bd07d3da45300f56b2c5d9100` (`0.17.6`). It complements the [shipping checklist](./shared-hub-shipping-checklist.md) and [shipping plan](./shared-hub-shipping-plan.md).

Do not mark an item complete from memory. Record the operator, date, environment, release SHA, artifact checksum, expected result, observed result, and sanitized evidence. Never copy passwords, cookies, OIDC codes, enrollment codes, Runner credentials, command contents, private paths, or raw database files into the evidence record.

## 1. Prepare the qualification record

Create a private evidence folder outside the repository. Restrict it to the current user.

```bash
export RELEASE_SHA=a4a93b7a5247ea3bd07d3da45300f56b2c5d9100
export RELEASE_VERSION=0.17.6
export EVIDENCE_DIR="$PWD/../hapi-qualification-$RELEASE_VERSION"
mkdir -p "$EVIDENCE_DIR"
chmod 700 "$EVIDENCE_DIR"
git rev-parse HEAD
git status --short
```

Expected:

- `git rev-parse HEAD` identifies the intended candidate or the evidence-only descendant commit.
- `git status --short` is empty.
- The tested implementation SHA remains `a4a93b7a5247ea3bd07d3da45300f56b2c5d9100`.

Start `$EVIDENCE_DIR/qualification.md` with this template:

```md
# Shared Hub qualification evidence

- Release SHA: a4a93b7a5247ea3bd07d3da45300f56b2c5d9100
- Version: 0.17.6
- Operator:
- Review date:
- Hub environment:
- Keycloak environment/realm:
- Linux host:
- macOS host:
- Artifact checksums:

## Drill: <name>

- Started/finished:
- Preconditions:
- Expected:
- Observed:
- Result: pass | fail | blocked
- Sanitized audit/event identifiers:
- Follow-up issue:
- Cleanup completed:
```

## 2. Verify the candidate and Linux artifact

From the repository root:

```bash
git show --stat --oneline "$RELEASE_SHA"
bun typecheck
bun run test
bun run test:e2e
bun run build:single-exe
bun run checksums:release
sha256sum -c release-checksums.sha256
git diff --check
```

Expected automated counts for this candidate:

- CLI Vitest: 637 passed; TerminalManager: 50 passed.
- Hub: 397 passed.
- Web: 562 passed.
- Mocked browser authentication: 2 passed.
- No unexpected skipped test.

The recorded Linux x64 checksum is:

```text
c147bfacf956585355303dc42d56004f71b8053208ffc49f2e6dbc5488c7e149  cli/dist-exe/bun-linux-x64-baseline/hapi
```

Copy the executable to the Linux qualification host using your approved transfer channel. On that host, verify the checksum before installation:

```bash
sha256sum hapi
chmod 755 hapi
./hapi --version
```

Stop if the checksum differs.

## 3. Prepare production-like Keycloak

Use a disposable qualification realm, real HTTPS, and a hostname reachable by both browsers and the Hub. Do not use the mocked Playwright identity provider as manual qualification evidence.

In Keycloak:

1. Create a realm such as `hapi-qualification`.
2. Create an OpenID Connect client named `hapi`.
3. Use Authorization Code flow.
4. Configure the exact redirect URI:

   ```text
   https://<hub-host>/api/auth/callback
   ```

5. Configure the exact web origin:

   ```text
   https://<hub-host>
   ```

6. Ensure ID tokens contain `sub`, `email`, and `email_verified`.
7. Create three distinct verified-email users:

   - `admin`: bootstrap organization Admin.
   - `member-a`: ordinary Member used for direct grants and Team A.
   - `member-b`: Viewer or ordinary Member used for denial and Team B.

8. Record the realm issuer URL and client ID. Do not record passwords or tokens.

Verify discovery over HTTPS:

```bash
curl --fail --silent --show-error \
  https://<keycloak-host>/realms/hapi-qualification/.well-known/openid-configuration \
  | jq '{issuer,authorization_endpoint,token_endpoint,jwks_uri}'
```

Expected: all endpoints use the intended HTTPS realm; `issuer` exactly matches the Hub configuration.

## 4. Start an isolated Shared Hub

Use a new data directory and database. Generate a new pepper locally; do not paste it into evidence.

```bash
export HAPI_HOME=/secure/path/hapi-qualification
export DB_PATH="$HAPI_HOME/hapi.db"
export HAPI_LISTEN_HOST=127.0.0.1
export HAPI_LISTEN_PORT=3006
export HAPI_PUBLIC_URL=https://<hub-host>
export CORS_ORIGINS=https://<hub-host>
export HAPI_ORGANIZATION_ID=qualification-org
export HAPI_ORGANIZATION_NAME='HAPI Qualification'
export HAPI_OIDC_ISSUER=https://<keycloak-host>/realms/hapi-qualification
export HAPI_OIDC_CLIENT_ID=hapi
export HAPI_BOOTSTRAP_ADMIN_EMAIL=admin@example.test
export HAPI_AUTH_PEPPER='<at-least-32-random-characters>'
mkdir -p "$HAPI_HOME"
chmod 700 "$HAPI_HOME"
bun run --cwd hub start
```

Put TLS termination in front of `127.0.0.1:3006`; do not expose the plaintext listener publicly. Keep the Hub process under your normal service supervisor for restart drills.

Expected:

- Startup succeeds with a fresh Shared Hub database.
- `HAPI_PUBLIC_URL`, OIDC issuer, callback, and CORS origin are HTTPS and exact.
- No credential, token, pepper, or cookie appears in startup logs.

## 5. Qualify login, invitations, and identity lifecycle

Use separate browser profiles or private windows so identities cannot share cookies.

1. Sign in as `admin`.
2. Confirm first-Admin bootstrap succeeds only for `HAPI_BOOTSTRAP_ADMIN_EMAIL`.
3. Attempt login as an uninvited fourth identity. Confirm access is denied.
4. As Admin, invite `member-a` by verified email.
5. Open the invitation once as `member-a`; complete Keycloak login.
6. Reuse the invitation link. Confirm it cannot be claimed again.
7. Repeat for `member-b`.
8. Try changing the last active Admin to a non-Admin role. Confirm last-Admin protection rejects it.
9. Log out and confirm the opaque Hub session no longer grants API or page access.
10. Let a test browser session expire, then confirm reauthentication is required.

Record status codes and sanitized audit identifiers, not full URLs containing invitation material.

## 6. Enroll two Runners

In the Admin UI, create one-time enrollment codes for two named Runners. Copy each code directly into its one-time enrollment command; never save the code in shell history or evidence. If your shell supports it, prefix sensitive commands with a space and configure history to ignore leading spaces.

Linux:

```bash
./hapi runner enroll --hub https://<hub-host> --code '<one-time-code>' --profile qual-linux
./hapi runner start --profile qual-linux --workspace-root /approved/workspace
./hapi runner status --profile qual-linux
./hapi runner list --profile qual-linux
```

Second Runner, on a separate host or isolated profile:

```bash
./hapi runner enroll --hub https://<hub-host> --code '<different-one-time-code>' --profile qual-runner-b
./hapi runner start --profile qual-runner-b --workspace-root /approved/workspace
./hapi runner status --profile qual-runner-b
```

Verify:

1. Reusing either enrollment code fails.
2. Each profile is bound to its own machine and Runner.
3. A copied credential used with the wrong machine identity fails.
4. Revoking Runner B disconnects it and prevents reconnect.
5. Cleanup removes the server-side credential/projection.
6. A new enrollment code allows Runner B to re-enroll.
7. Logs and diagnostics contain no enrollment code or credential.

## 7. Execute the cross-user authorization matrix

Create Team A and Team B, one Runner in each, and at least one active session per Runner. Use `member-a` for Team A and `member-b` for Team B.

For every row below, test both the visible UI and the underlying network request where practical:

| Actor | Resource | Expected |
|---|---|---|
| Admin | Both Teams/Runners | Authorized according to Admin policy |
| `member-a` | Team A grant | Authorized only to granted capability |
| `member-a` | Team B | 404 when undiscoverable; no side effect |
| `member-b` | Team A | 404 when undiscoverable; no side effect |
| Viewer | Mutation | 403 for discoverable resource; no side effect |
| Revoked actor | Previously granted resource | Immediate denial and realtime teardown |
| Disabled actor | Any protected resource | Denied; browser session invalidated |

Exercise each relevant transport:

1. REST list, read, create, update, and destructive actions.
2. SSE subscription and event delivery.
3. Browser Socket.IO terminal subscribe, create, write, resize, and close.
4. CLI Socket.IO reconnect and session delivery.
5. Editor/file/Git reads and mutations.
6. Permission, session-control, and RPC actions.
7. Team Chat list, read, post, mentions, reports, participant management, and archive.

For every denial, confirm all of the following:

- No database mutation.
- No RPC or CLI emit.
- No room join or event publication.
- No terminal output leakage.
- No resource existence leak across organizations or undiscoverable Teams.

## 8. Measure access-loss behavior

Keep a browser SSE connection and terminal attachment active. Record timestamps using one synchronized clock.

Repeat for:

1. Direct grant revoke.
2. Team removal.
3. Role downgrade.
4. User disable.
5. Team archive.
6. Runner revoke.
7. Natural grant expiry.
8. Offline Runner revoke followed by reconnect.

Expected:

- New forbidden requests fail immediately after commit.
- Affected realtime access disconnects or detaches within five seconds.
- Unrelated users remain connected.
- Local agent processes continue unless the tested action explicitly requests cleanup.
- Audit precedes the resulting published invalidation; failed mutations produce neither.

Record start, commit, disconnect, and first-denial timestamps. Mark the SLO failed if any access remains beyond five seconds.

## 9. Qualify Linux service lifecycle

```bash
./hapi runner install --profile qual-linux --workspace-root /approved/workspace
systemctl --user status hapi-runner-qual-linux.service
systemctl --user restart hapi-runner-qual-linux.service
./hapi runner status --profile qual-linux
./hapi runner logs --profile qual-linux
./hapi runner uninstall --profile qual-linux
```

Confirm install, boot/start, restart, Hub reconnect, revoke denial, cleanup, re-enrollment, and uninstall. Inspect the unit and logs for secrets:

```bash
systemctl --user cat hapi-runner-qual-linux.service
```

Expected: credentials and enrollment codes are absent from process arguments, unit contents, status output, and logs.

## 10. Qualify macOS LaunchAgent lifecycle

Build or obtain the matching macOS release artifact and verify its published checksum before running it. Do not reuse the Linux checksum.

```bash
./hapi runner enroll --hub https://<hub-host> --code '<one-time-code>' --profile qual-macos
./hapi runner install --profile qual-macos --workspace-root /approved/workspace
launchctl print "gui/$(id -u)/com.hapi.runner.qual-macos"
./hapi runner status --profile qual-macos
./hapi runner uninstall --profile qual-macos
```

Confirm install, login/start, restart, reconnect, revoke, cleanup, re-enroll, and uninstall. Inspect `~/Library/LaunchAgents/com.hapi.runner.qual-macos.plist` and the profile logs for secret leakage before uninstalling.

## 11. Back up and restore SQLite

Run this against the qualification database while the Hub is online. Use the `sqlite3` online backup command; do not copy only the main file while WAL writes may be active.

```bash
mkdir -p "$EVIDENCE_DIR/backups"
chmod 700 "$EVIDENCE_DIR/backups"
sqlite3 "$DB_PATH" ".backup '$EVIDENCE_DIR/backups/hapi-$RELEASE_VERSION.db'"
sqlite3 "$EVIDENCE_DIR/backups/hapi-$RELEASE_VERSION.db" 'PRAGMA integrity_check;'
```

Expected: `ok`.

Encrypt the backup with your approved organizational tool and key-management procedure. Delete the plaintext backup after verifying encrypted recovery.

Restore drill:

1. Stop the isolated restore Hub if running.
2. Decrypt into a new restricted directory.
3. Point a second isolated Hub at the restored database with the same organization ID.
4. Start it on a different internal port and hostname.
5. Run `PRAGMA integrity_check` again.
6. Compare sanitized counts for memberships, Teams, Runners, grants, sessions, audit events, and outbox records.
7. Verify Keycloak login, Runner state, and chronological audit display.
8. Never connect the restored qualification Hub to production Runners.

## 12. Validate proxy and operational controls

At the public endpoint, verify:

```bash
curl -sS -D - -o /dev/null https://<hub-host>/
curl -sS -D - -o /dev/null -H 'Origin: https://untrusted.example' https://<hub-host>/api/auth/session
```

Confirm:

1. TLS certificate and hostname validation succeed.
2. HTTP redirects to HTTPS.
3. Only the configured origin receives CORS approval.
4. Security headers match your deployment standard.
5. Proxy forwarding headers are trusted only from the known proxy.
6. Authentication and enrollment endpoints are rate-limited.
7. SQLite data lives on a persistent volume with correct ownership and restricted permissions.
8. Disk, database, backup age/failure, process health, and certificate expiry alerts have named owners.
9. Credential rotation and incident escalation procedures name an operator and on-call contact.

## 13. Rehearse rollback

Before changing anything, take an encrypted online backup and preserve the current verified binary.

1. Record the current binary checksum and database schema version.
2. Stop new lifecycle mutations.
3. Stop the Hub cleanly.
4. Restore the prior binary and the matching pre-upgrade database backup together.
5. Start the Hub on an isolated endpoint first.
6. Run database integrity checks, login, Runner reconnect, and a read-only audit chronology check.
7. Promote only after those checks pass.
8. Record recovery time and any manual intervention.

Never run an older binary against a database migrated by a newer release unless that exact downgrade is documented as supported.

## 14. Review for secret leakage and security findings

Review sanitized Hub logs, Runner logs, browser network metadata, audit payloads, and outbox payloads. Search only the qualification copies—not live secret files—for prohibited field names and known synthetic canary values.

Confirm absence of:

- OIDC authorization codes, ID/access/refresh tokens, cookies, CSRF secrets, and peppers.
- Enrollment codes and Runner credentials.
- Agent commands, terminal contents, environment secrets, and private workspace paths.
- Raw invitation tokens.

Have the security reviewer record every Critical or High finding and its disposition. The release cannot be `ready` while any such finding is unresolved.

## 15. Collect sign-offs in order

1. Engineering owner verifies every automated/manual record references the release SHA and artifact checksum.
2. Security reviewer signs authentication, authorization, isolation, secret-handling, audit, and access-loss evidence.
3. Operations owner signs Linux/macOS service, persistent storage, monitoring, backup/restore, and rollback evidence.
4. Product owner accepts the pilot boundary and documented non-security limitations.
5. Update `docs/shared-hub-shipping-checklist.md` with evidence links and change only genuinely satisfied rows to `completed`.
6. Set the final verdict:

   - `ready`: every blocker completed.
   - `conditional`: only explicitly accepted non-security limitations outside the release boundary remain.
   - `not-ready`: any authentication, authorization, audit, teardown, recovery, artifact, platform, or Critical/High security gate remains open.

## Stop conditions

Stop qualification and keep the verdict `not-ready` if any of these occurs:

- Cross-user, cross-Team, cross-Runner, or cross-organization data exposure.
- A denied action causes a mutation, event, RPC, CLI emit, room join, or terminal output.
- Revoked/disabled/expired access remains usable beyond five seconds.
- Credentials, tokens, commands, or private paths appear in logs/audit/outbox evidence.
- Backup integrity or isolated restore fails.
- Artifact checksum differs.
- A Critical or High security finding remains unresolved.
