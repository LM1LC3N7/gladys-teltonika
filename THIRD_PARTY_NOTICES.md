# Third-party notices

Nothing but the Gladys SDK is installed at runtime. One library's logic is
ported to JavaScript; its notice follows.

## teltasync

- Project: <https://codeberg.org/dmho/teltasync>, published on PyPI as
  `teltasync` (used by the Teltonika integration of Home Assistant).
- Copyright: the contributors of teltasync (author declared in its
  `pyproject.toml`: Karl Beecken).
- Version read: 0.4.1, commit `845598b` (2026-10-17).
- License: Apache License, Version 2.0. The repository ships the standard
  text of the license and no NOTICE file. The full text of the Apache
  License 2.0 is the `LICENSE` file of this repository (identical text),
  copied into the Docker image next to this file.

What is ported (rewritten in JavaScript, not copied): the RutOS HTTP API
calls (`POST /api/login` with a JSON user name and password giving a Bearer
token and its lifetime, `GET /api/system/device/status`,
`GET /api/modems/status`, `POST /api/system/actions/reboot`), the response
envelope `{ success, data, errors[] }` with "N/A" read as nothing, the
RutOS error codes (120 to 123: unauthorized, login failed, invalid JWT), the
renewal of a rejected session once, and the online and offline shapes of a
modem (operator, connection type, data connection state, SIM and PIN
states, RSSI, RSRP, RSRQ, SINR, temperature, byte counters), in
`src/teltonika/client.js`, `src/teltonika/errors.js` and
`src/teltonika/parse.js`. The shapes of the test fixtures follow its
fixtures. Changed from the original: the HTTPS certificate is pinned on
first use instead of not being checked at all, a token is renewed 30 s
before it expires, a size cap and a deadline on every answer, no redirect
followed, the IMEI, IMSI, ICCID, serial numbers and cell ids are never
copied out of an answer, the reboot is never retried nor preceded by a
login. Modem reboot, connection restart and SIM switch are not used.

Teltonika and RutOS are trademarks of Teltonika Networks; this integration is
unofficial and not affiliated with Teltonika.

## LM1LC3N7/gladys-fing

The structure of the app (start queue, epochs of the loop, refusal kept as
a salted HMAC in `/data`, bounded pauses, state budget, transport badges)
and the test helpers follow this integration of the same author, under the
Apache License 2.0 of this repository.
