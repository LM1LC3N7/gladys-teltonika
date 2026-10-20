# TODO — Teltonika v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`
  (Node 22 and 24), `npm audit --omit=dev`,
  `npx github:GladysAssistant/integration-store .`, then update README,
  `docs/en.md`, `docs/fr.md`, `CHANGELOG.md` and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only. No forum topic of its own: the claim is in /t/10385 (lot 11).

## Status

- [x] **Milestone 1 — core** (2026-10-20): RutOS HTTP API ported from
      teltasync 0.4.1 (login and Bearer token, device status, modems status,
      reboot); one device per modem (data connected, signal bars and values,
      operator, network type, band, SIM, temperature, rates, data counters),
      one router device (firmware, reboot button off by default); triggers
      `mobile_data_lost`, `mobile_data_restored`; HTTPS certificate pinned on
      first use; credentials refusal final and remembered; 429 / 5xx pause
      bounded and persisted; status and Discovery sent again at every
      `connected`; a published device never loses a feature; docs en/fr.
      Tested with unit tests against the SDK's fake Gladys, a fake router and
      loopback HTTP / HTTPS servers (a self-signed certificate made in Node).
      **Never tested with a real router.** No Docker on this PC: no e2e test
      in a container. The store validator was not run by the development
      agent (it runs in the real terminal only).
- [x] **Review corrections 1** (2026-10-21): the deadline of 3.5 s checked
      again in `beforeSend`, after the handshakes (I1); a 429 / 5xx met by
      the reboot takes the usual failure path (loop halted, pause kept, the
      loop never reads inside a pause) and refused credentials or another
      certificate met by it stop at once (I2, M8); the test button keeps the
      retry wait of a failure, only a saved configuration reads at once
      (I3); token margin `min(30 s, half its life)` and "no valid session"
      said as such (M1); single-flight login, the old token kept until the
      new one (M2); MAC addresses dropped from texts (M3); TODO on logins
      (M4); a reboot time in the future counts as now (M5); a pause kept in
      memory too when /data cannot be written (M6); Discovery sent again
      when the start is blocked (M7). Each with a test, except M6.

## Decisions

- **Version 0.1.0** set by hand in `package.json`, `package-lock.json`, the
  manifest and the `docker_image` tag (`ghcr.io/lm1lc3n7/gladys-teltonika:0.1.0`);
  the first release (patch) gives 0.1.1.
- **Reference**: teltasync (Apache-2.0, used by Home Assistant), 0.4.1,
  commit `845598b`; logic ported, nothing copied; notice in
  `THIRD_PARTY_NOTICES.md`, copied into the image. RutOS derives from
  OpenWrt but its API is Teltonika's own: distinct from guim31/gladys-openwrt
  (ubus / LuCI), said nowhere else than here.
- **Scope of v1**: what teltasync reads (device status, modems status) and
  the router reboot. The list of connected devices and presence (in the
  proposal of lot 11) are **not** in v1: teltasync has no such call and the
  RutOS documentation pages (rendered by JavaScript) could not be read to
  check the DHCP leases endpoint and its fields. Next below.
- **HTTPS pinned on first use (TOFU)**: Teltonika routers ship a
  self-signed certificate. teltasync / Home Assistant turn the check off;
  here the SHA-256 fingerprint is learned at the first connection
  (`/data`, per `host:port`) and checked right after the TLS handshake,
  before any byte (password, token) is written. Another certificate: stop,
  persisted (HMAC of the configuration), lifted by saving the configuration,
  which accepts the new one. HTTP stays possible (said: password in clear).
- **Credentials refused** = HTTP 401 or RutOS code 121 at `POST /api/login`:
  final, remembered as a salted HMAC of address, protocol, user name and
  password; lifted only by saving the configuration (the router may lock an
  account after failures). HTTP 403 at login or a session refused again
  right after a new login = the account lacks rights: spaced retry (never a
  loop: at most two logins per request, an expired token then a rejected
  session, and the next reading only after the retry delay).
- **Token**: renewed `min(30 s, half its life)` before the `expires` given
  by RutOS (299 s when it says nothing); one login at a time (single
  flight), the old token kept until the new one arrives; a session the
  router rejects (401, codes 120 / 123) is renewed once per request, then
  the reading fails.
- **Test button**: like a reconnection to Gladys, it never reads faster
  than the interval; within the retry wait of a failure it answers that
  failure without a request. Only saving the configuration reads at once.
- **External ids**: `router:main` (one router per installation) and
  `modem:<RutOS modem id>` (its USB path, `2-1`, lowercase), stable across a
  SIM, an operator or a reboot. Never the IMEI nor a serial.
- **Features and units** (core `DEVICE_FEATURE_UNITS_BY_CATEGORY`):
  data connected `unknown`/`binary` (never a switch); signal bars
  `signal`/`integer` 0-5, our own scale (-65/-75/-85/-95/-105 dBm), RutOS has
  none in its API; RSSI, RSRP, RSRQ, SINR `unknown`/`unknown` without unit
  (no dBm / dB in the core, the unit in the name); temperature
  `device-temperature-sensor`/`decimal` celsius; rates `datarate`/`rate`
  kilobits-per-second; counters `data`/`size` megabyte (10^6 bytes);
  operator, network type, band, SIM, firmware `text`.
- **Rates**: from the byte counters between two readings at most 3 poll
  intervals apart; none after a failure, at the first reading, or when a
  counter goes down. The counters are those of the modem (they restart),
  not plan counters.
- **Reboot**: a `button`/`push` on the router device; refused unless
  `allow_reboot`; deadlines from its arrival: the fresh reading by 2.5 s
  (must succeed and carry the same identity, a SHA-256 of serial and model,
  in memory only), the request refused unsent after 3.5 s, its answer
  awaited until 4.5 s (Gladys acks within 5 s); the option, the
  configuration, a pause, the cooldown and the 3.5 s deadline checked again
  right before the request is written, after the TCP and TLS handshakes
  (`beforeSend`); never retried, never preceded by a login; a silence or a
  5xx after the request was written is "sent, without confirmation"; a 429
  / 5xx, refused credentials or another certificate met by the command take
  the usual failure path at once (pause or stop, persisted); 10 min between
  two reboots, kept in `/data` before the ack, a time in the future counted
  as now (the ack does not wait for Gladys). Modem reboot, connection restart and
  SIM switch (in teltasync) are not offered.
- **Identifiers**: the IMEI, IMSI, ICCID, serial numbers, MAC addresses,
  cell ids, area codes and phone numbers are never copied out of an answer;
  a text with 8 digits or more in a row, or a MAC address (colons, dashes,
  dots or 12 hex digits), is dropped.
- **Triggers**: data connected true -> false and false -> true between two
  consecutive good readings only; variables `modem_name`, `operator`
  (string or null).
- **Never read faster than the interval**: the scan button, the test button
  and a reconnection to Gladys reuse the last reading while it is younger
  than the poll interval. The device status (model, firmware) is read once
  an hour.
- **Caps**: 8 modems, answers 1 MiB, texts 64 characters, 15 s per request,
  250 states per minute.
- **No dashboard widget** in v1.

## Next

- Check against a real router: the login answer and the token lifetime, the
  codes of a wrong password and of an account without rights, the fields of
  `modems/status` on RUT240 / TRB (older firmwares), whether
  `data_conn_state` is always there.
- Connected devices and presence: the DHCP leases (or wireless clients)
  endpoint of RutOS, once checked on the documentation of a firmware.
- Data usage per SIM (RutOS keeps daily / monthly counters).
- A dashboard widget (signal, operator, data).
