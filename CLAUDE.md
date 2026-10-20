# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** for Teltonika 4G/5G routers: a
Node.js service (Node 22+, ESM, no build step) that runs in its own sandboxed
Docker container and talks to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It reads the modems of a router through the
local HTTP API of RutOS (ported from teltasync, Apache-2.0), and offers one
command: a reboot button, off by default. See `TODO.md` for the status and
every decision.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
node --test --test-name-pattern "reboot"  # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run cover                             # regenerate cover.png (plain Node)
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only (src/handlers.js)
src/handlers.js                   every SDK handler, registered before connect()
src/app.js                        TeltonikaApp: start queue, loop, failures, states, triggers, reboot
src/teltonika/client.js           RutOS API: login, token, readings, reboot (port of teltasync)
src/teltonika/http.js             the only network access (https pinned / http, no redirect)
src/teltonika/parse.js            answers -> plain objects, identifiers dropped
src/teltonika/errors.js           error codes; what refused credentials are
src/devices.js                    router and modem devices (pure), never fewer features
src/config.js                     DEFAULTS (mirror the manifest) + normalization
src/store.js                      /data: refusal HMAC, salt, certificate pins, pauses, last reboot
src/budget.js                     sliding window of the states sent per minute
src/i18n.js                       statuses and messages (en / fr)
gladys-assistant-integration.json manifest
docs/en.md, docs/fr.md            user documentation, re-hosted by Gladys (mandatory)
test/                             node --test, fake Gladys (SDK) + fake router + loopback TLS
```

## Rules

- **External ids are forever**: `router:main`, `modem:<modem id>` and the
  feature keys of `src/constants.js`. Changing one creates a new device and
  orphans the old one. The same goes for every key users store: manifest
  `config_schema`, `actions`, scene trigger keys and their fields and
  variables.
- **The reboot** is a `button`/`push`, never a switch nor a binary, refused
  unless `allow_reboot` is on; the router is read again (same identity) just
  before, the option checked again right before the request is written
  (`beforeSend`), never retried, 10 min between two (kept in `/data`).
  Any new command needs Louis's decision, off by default, never a switch.
- **Secrets and identifiers**: the password, the token, the IMEI, IMSI,
  ICCID, serial numbers, MAC addresses, cell ids and phone numbers are never
  in a log, an error message, a status, a state, a scene event or `/data`.
  `test/app.test.js` checks it on fixtures holding all of them.
- **HTTPS**: the certificate is pinned on first use, checked before any
  byte is written; never turn the check off.
- **The container rootfs is read-only.** Write only under `/data`.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand (0.1.0 was set by hand once, before the first release).
  `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md`. Never write a version heading.
- **Manifest.** Texts are `{ "en": ..., "fr": ... }` objects; the catalog
  `description` holds 10 to 100 characters per language.
  `test/manifest.test.js` ties the manifest to the code. A secret field is
  described as kept by Gladys in its database, never shown again; never as
  protected by any cipher (the test refuses it).
- **Units**: only those the core lists for the category
  (`DEVICE_FEATURE_UNITS_BY_CATEGORY`); no dBm in the core: the unit is in
  the feature name.
- **Encoding.** Files are UTF-8 without BOM; `test/encoding.test.js` refuses
  mojibake in the manifest, docs, README, CHANGELOG, TODO, CLAUDE.md, the
  notices and `src/**/*.js`. Write files with an editor, never through a
  shell that guesses a code page.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network (loopback only).
