# gladys-teltonika

A [Gladys Assistant](https://gladysassistant.com) external integration for
[Teltonika](https://teltonika-networks.com) 4G/5G routers (RutOS 7 or later),
through the local HTTP API of the router.

- One Gladys device per modem (picked in the Discovery tab): **mobile data
  connected**, **signal** (bars, RSSI, RSRP, RSRQ, SINR), **operator**,
  **network type**, **band**, **SIM card**, **temperature**, **download** and
  **upload rates**, data **received** and **sent**.
- One router device: **firmware**, and a **Reboot** button, off unless
  "Allow rebooting the router" is on.
- Scene triggers: **Mobile data lost**, **Mobile data back**.

**Never tested with a real router**: ported from
[teltasync](https://codeberg.org/dmho/teltasync) (Apache-2.0) and tested
against a fake router only.

Unofficial integration, not affiliated with Teltonika.

## Documentation

- English: [docs/en.md](docs/en.md)
- Français : [docs/fr.md](docs/fr.md)

## Security

- The password is kept by Gladys in its database, never shown again, and
  sent only to the router. HTTPS by default: the self-signed certificate of
  the router is pinned at the first connection, and another one stops
  everything before a byte is written.
- The password, the session token, the IMEI, IMSI, ICCID, serial numbers,
  MAC addresses and phone numbers are never logged nor kept; `/data` holds a
  salted HMAC of refused credentials, the certificate fingerprint, the end of
  a pause and the time of the last reboot.
- The reboot is a button (never a switch), off by default, at most one every
  10 minutes.
- See [SECURITY.md](SECURITY.md) to report a vulnerability.

## Development

```bash
npm install
npm run format:check
npm run lint
npm test
npm run cover   # regenerate cover.png
```

See [CLAUDE.md](CLAUDE.md) for the architecture and the rules, and
[TODO.md](TODO.md) for the status and decisions.

## License

Apache License 2.0, see [LICENSE](LICENSE) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
