# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.1] - 2026-10-21

### Added

- First version: a Teltonika 4G/5G router (RutOS 7 or later) through its local
  HTTP API (address, HTTPS by default or HTTP, user name, password).
- One Gladys device per modem: mobile data connected, signal (bars, RSSI,
  RSRP, RSRQ, SINR), operator, network type, band, SIM card, temperature,
  download and upload rates, data received and sent.
- One router device: firmware, and a Reboot button off by default ("Allow
  rebooting the router"), the router read again first, the option checked
  again right before sending, one reboot every 10 minutes at most.
- Scene triggers: mobile data lost, mobile data back (never at the first
  reading nor after an outage).
- The self-signed HTTPS certificate of the router is learned at the first
  connection; another one stops everything before anything is sent, until
  the configuration is saved.
- Credentials refused stop the integration until the configuration is saved
  (remembered in `/data` as a salted HMAC); HTTP 429 and 5xx pause every
  request, the pause kept in `/data` and bounded; other failures retried,
  never faster than the refresh.
- Test the connection button.
- The IMEI, IMSI, ICCID, serial numbers, MAC addresses and phone numbers are
  never taken into Gladys, the logs nor `/data`.
- Documentation in English and French. Never tested with a real router.

### Fixed

- The reboot request is never written after its 3.5 s deadline, even when
  the connection to the router is slow.
- An HTTP 429 or 5xx met by the reboot pauses every reading too; refused
  credentials or another certificate met by the reboot stop the integration
  at once.
- The Test the connection button never reads the router faster than the
  refresh after a failure.
- A short token (20 s) no longer means a login before every request nor a
  refused reboot; two readings needing a new token share one login.
- A MAC address in a name is never shown; a reboot time in the future
  counts as now for the 10-minute cooldown; Discovery is sent again when the
  start is blocked.
- Two failures at the same time (the loop and the reboot) never start two
  reading chains; a reboot that joins a slow login of the loop is refused
  at its own deadline (2.5 s), not after the 15 s of the reading.

[Unreleased]: https://github.com/LM1LC3N7/gladys-teltonika/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/LM1LC3N7/gladys-teltonika/releases/tag/v0.1.1
