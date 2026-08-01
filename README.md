# HAPI

Run official Claude Code / Codex / Gemini / Grok Build / OpenCode sessions locally and control them remotely through a Web / PWA / Telegram Mini App.

> **Why HAPI?** HAPI is a local-first alternative to Happy. See [Why Not Happy?](docs/guide/why-hapi.md) for the key differences.

## Features

- **Seamless Handoff** - Work locally, switch to remote when needed, switch back anytime. No context loss, no session restart.
- **Native First** - HAPI wraps your AI agent instead of replacing it. Same terminal, same experience, same muscle memory.
- **AFK Without Stopping** - Step away from your desk? Approve AI requests from your phone with one tap.
- **Your AI, Your Choice** - Claude Code, Codex, Cursor Agent, Gemini, Grok Build, OpenCode—different models, one unified workflow.
- **Terminal Anywhere** - Run commands from your phone or browser, directly connected to the working machine.
- **Voice Control** - Talk to your AI agent hands-free using the built-in voice assistant.
- **Workspace Browser** - `hapi runner start --workspace-root <path>` (prompted for interactively if omitted): browse a scoped file tree from the web and start sessions in any subdirectory.

## Demo

https://github.com/user-attachments/assets/38230353-94c6-4dbe-9c29-b2a2cc457546

## Getting Started

```bash
npx @twsxtd/hapi hub --relay     # start hub with E2E encrypted relay
npx @twsxtd/hapi                 # run claude code
```

`hapi server` remains supported as an alias.

The terminal will display a URL and QR code. Scan the QR code with your phone or open the URL to access.

> The relay uses WireGuard + TLS for end-to-end encryption. Your data is encrypted from your device to your machine.

For self-hosted options (Cloudflare Tunnel, Tailscale), see [Installation](docs/guide/installation.md)

## Docs

- [App](docs/guide/pwa.md)
- [How it Works](docs/guide/how-it-works.md)
- [Shared Hub Operations](docs/guide/shared-hub-operations.md)
- [Cursor Agent](docs/guide/cursor.md)
- [Grok Build](docs/guide/grok.md)
- [Voice Assistant](docs/guide/voice-assistant.md)
- [Why HAPI](docs/guide/why-hapi.md)
- [FAQ](docs/guide/faq.md)

## Build from source

```bash
bun install
bun run build:single-exe
```

## Publishing from GitLab

Tags matching `v<major>.<minor>.<patch>` run the GitLab release pipeline. It builds
the platform archives, creates a GitLab Release, and exposes a manual `publish-npm`
job. Add an npm granular access token as a masked, protected GitLab CI/CD variable
named `NPM_TOKEN`. Grant it read/write access to the main package and all five
platform packages. The publish job writes a temporary npm configuration and removes
it after the job.

To publish manually with an authenticated npm CLI:

```bash
bun run publish:npm -- 0.18.0
```

Add `--dry-run` to validate every generated package without publishing, or
`--skip-build` to reuse binaries already present in `cli/dist-exe`. Prerelease
versions use their first prerelease identifier as the npm dist-tag; for example,
`0.18.4-sharedhub` is published under `sharedhub` instead of `latest`.

## Credits

HAPI means "哈皮" a Chinese transliteration of [Happy](https://github.com/slopus/happy). Great credit to the original project.
