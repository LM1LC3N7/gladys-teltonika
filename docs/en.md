# Teltonika

[Teltonika](https://teltonika-networks.com) 4G/5G routers (RUTX, RUT, RUTM,
TRB series, on RutOS 7 or later) in Gladys, through the local HTTP API of the
router. Handy for a second home, a camper van or a backup connection:

- each **modem** of the router can become a Gladys device (Discovery tab):
  **mobile data connected** (yes / no), **signal** in bars (0 to 5) and in
  values (**RSSI**, **RSRP**, **RSRQ**, **SINR**), **operator**, **network
  type** (4G, 5G NSA…), **band**, **SIM card** state, modem
  **temperature**, **download** and **upload rates**, data **received** and
  **sent**;
- the **router** becomes a device with its **firmware** and a **Reboot the
  router** button, inactive until you allow it;
- two scene triggers: **Mobile data lost** and **Mobile data back**.

> **This integration has never been tested with a real router.** This first
> version was ported from teltasync, the library Home Assistant uses, and
> tested against a fake router only. Tell on the Gladys forum what works and
> what does not, with the model and the RutOS version.

Unofficial integration, not affiliated with Teltonika.

## Before you start

1. The router must run **RutOS 7** or later (the HTTP API does not exist
   before). The version is in the web interface, **System**, **Firmware**.
2. Pick the account Gladys will use. `admin` works; a dedicated account is
   better: in **System**, **Administration**, **User settings**, create a
   user with read access to the API (and write access only if you want the
   Reboot button).
3. Note the IP address of the router on your local network (the one of its
   web interface, often `192.168.1.1`).

## Configuration

- **Address of the router**: its IP address or host name. An address pasted
  from a browser (`https://192.168.1.1`) is read as its protocol, host and
  port.
- **Protocol**: **HTTPS** by default. The router has a self-signed
  certificate that no authority vouches for: Gladys learns it at the first
  connection and keeps its SHA-256 fingerprint in its `/data` volume. If the
  router later shows another certificate (a reset, a new certificate, or
  another device at this address), Gladys stops **before sending anything**
  and says so in the status: if you changed the certificate yourself, save
  the configuration to accept the new one. **HTTP** sends the password in
  clear on your network; many routers redirect HTTP to HTTPS anyway.
- **Port**: empty, 443 in HTTPS and 80 in HTTP.
- **User name**: `admin` by default.
- **Password**: kept by Gladys in its database, never shown again, sent only
  to the router. It is taken as you type it (a space at the start or the
  end counts). The integration never writes it to its logs nor to `/data`,
  nor the session token of the router.
- **Refresh**: how often the modems are read (every minute by default, one
  request each time). The router gives a token valid for about five
  minutes: Gladys logs in again about every five minutes. The model and the
  firmware are read again once an hour.
- **Allow rebooting the router**: off by default (see below).

The **Test the connection** button says what the router answers. Like the
scan of the Discovery tab and a restart of Gladys, it reads the router again
only when the last reading is older than the refresh; after a failure, it
gives the status of that failure until the next retry, without a request.
Only saving the configuration reads at once.

## The values

- **Signal (bars)**: our own scale from the RSSI: 5 bars at -65 dBm or
  better, 4 at -75, 3 at -85, 2 at -95, 1 at -105, 0 below. The RutOS web
  interface may show another scale.
- **RSSI**, **RSRP** (dBm), **RSRQ**, **SINR** (dB): as the router gives
  them. Gladys has no dBm unit: the unit is in the name of the feature.
- **Rates** (kbit/s): averages between two readings, from the counters of
  the modem. No rate at the first reading, after an outage, nor when a
  counter starts again from zero.
- **Data received / sent** (MB, millions of bytes): the counters of the
  modem as RutOS gives them; they start again from zero when the modem
  reconnects or restarts. They are not the counters of your plan.
- **SIM card**: the state of the card, or what it asks for (PIN, PUK).
- A modem offline keeps its device, shown not connected.

## Rebooting the router

A reboot cuts the Internet of everything behind the router for a minute or
two, Gladys included if it goes through it. Therefore:

- the button refuses until **Allow rebooting the router** is on;
- it is a button, never a switch: a "turn everything off" of a voice
  assistant or a scene never reaches it;
- before sending, Gladys reads the router again and checks it is the same
  one (same serial number, kept only as a fingerprint); the option is
  checked again right before sending; when the router is too slow, the
  reboot is not sent and Gladys says so;
- one reboot every 10 minutes at most (even across a restart of the
  integration): a scene in a loop cannot reboot it again and again;
- when the router does not answer after the request was sent, Gladys says
  "sent, without confirmation": it may have rebooted.

## Scene triggers

- **Mobile data lost**: a modem that had a data connection lost it at the
  next reading.
- **Mobile data back**: a modem that had no data connection has one again.

Filter on a modem or leave empty for any. Variables: the name of the modem
and the operator. No trigger fires at the first reading nor after an outage
of the router (each reading is compared with the previous one only).

## Troubleshooting

The connection status of the integration says what is going on:

- **User name or password refused**: Gladys stops and does not try again by
  itself, even after a restart (the router could lock the account after a
  few failures). Check them and save the configuration.
- **The router accepts the login but refuses the readings**: the account
  lacks the rights on the API; Gladys retries, spaced out.
- **HTTPS certificate changed**: see Protocol above.
- **HTTP 429 or a server error (5xx)**: every request is paused (one minute
  to six hours), and the pause survives a restart.
- **No answer, wrong address, wrong protocol**: Gladys retries, never faster
  than the refresh, waiting longer each time (up to 30 minutes).

## Privacy

Gladys keeps only what it shows. The IMEI, the IMSI, the ICCID, the serial
numbers, the MAC addresses, the cell ids and the phone numbers the router
returns are never taken: not into Gladys, not into the logs, not into
`/data`. A text holding a long run of digits (a number that has no business
there) or a MAC address is not shown.

The integration does not list the devices connected to the router nor
presence yet (see TODO.md).
