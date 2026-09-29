# Poolside ScreenLogic monitor

A read-only local dashboard for pool and outside temperature, with Pushover notifications for controller alarms, sustained system delays, and loss of contact with ScreenLogic. The full original requirements are in [the monitoring spec](docs/monitoring-spec.md).

## Run the website

Requires Node.js 22 or newer; Node.js 24 LTS is recommended. On a computer on the same network as the ScreenLogic adapter:

```sh
npm ci
npm run build
cp .env.example .env
# Edit .env with your ScreenLogic address and Pushover keys.
npm start
```

Open `http://<computer-ip>:3000` on another device on the same network. Set `SCREENLOGIC_HOST` to the adapter address found by diagnostics and `SCREENLOGIC_PORT` to its port to avoid repeated UDP discovery. The dashboard uses `GET /api/status` and refreshes every 15 seconds; the service reads ScreenLogic every 30 seconds by default. The web server binds to the local network; keep it behind your home firewall because it has no login.

Create a Pushover application at [Pushover's application page](https://pushover.net/apps/build). Put its API token and your Pushover user key in `.env` as `PUSHOVER_APP_TOKEN` and `PUSHOVER_USER_KEY`, then run `chmod 600 .env`. Check delivery with `npm run pushover:test`, which sends one test push. The application sends notifications through [Pushover's Message API](https://pushover.net/api). If either key is missing, the dashboard still runs, but push notifications are disabled.

Alerts are sent once per ongoing condition and their notification state survives service restarts in `.monitor-state.json`. An increase in the controller alarm count sends a new push. Controller alarms alert immediately; pool, spa, and cleaner delays alert after five continuous minutes; loss of contact alerts after five minutes. Both grace periods are configurable in `.env`. Clearing a condition resets it for the next occurrence. The page shows current conditions and marks temperatures as old when the adapter is unreachable.

**Pump limitation:** this controller reports no IntelliFlo pumps, so ScreenLogic supplies no RPM, watts, or direct pump fault status. The monitor cannot confirm a relay-controlled pump is actually running or identify a controller alarm as a pump fault. A controller alarm notification tells you to check the Pentair panel or app for the detail. System delays can be normal during transitions, so they have a grace period. The monitor does not decode chlorinator numeric flags into warnings.

### Keep it running on a Raspberry Pi

Check `cat /etc/os-release`, `uname -m`, and `node --version` on the Pi before copying the project. If it still runs Raspbian based on Debian 9, use [Raspberry Pi Imager](https://www.raspberrypi.com/documentation/computers/getting-started.html) to install a current **64-bit Raspberry Pi OS Lite** image, with SSH and Wi-Fi configured in Imager. Raspberry Pi 3 supports the 64-bit image. Reimaging erases the card, so copy anything important first. A monitor is not needed for that setup. Install Node.js 24 LTS on the fresh OS.

After `npm ci`, `npm run build`, `.env` setup, and one successful `npm start`, create a systemd user service on the Pi so monitoring starts after reboot. Run the following **from the project directory on the Pi**:

```sh
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/screenlogic-monitor.service <<EOF
[Unit]
Description=ScreenLogic pool monitor
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$PWD
ExecStart=$(command -v node) $PWD/dist/server.js
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now screenlogic-monitor
loginctl enable-linger "$(whoami)"
systemctl --user status screenlogic-monitor
```

`loginctl enable-linger` keeps the user service running after SSH logout and at boot; if it asks for elevated privileges, run that one command with `sudo`. Use `journalctl --user -u screenlogic-monitor -f` to see reads and notification errors. Before moving the service to another machine, copy `.monitor-state.json` with it if you want to preserve notification deduplication.

## Run diagnostics

The diagnostic collects a broader report than the live dashboard. Run it on the same local subnet as the adapter.

```sh
npm install
npm run diagnostics
```

The command broadcasts a ScreenLogic discovery request, connects to the first adapter found, prints formatted JSON, and saves the same report to `diagnostics.json`. Progress and read errors go to stderr. The file is excluded from Git and created with owner-only permissions because it may contain local network and equipment details.

If broadcast discovery does not work, copy `.env.example` to `.env` and set `SCREENLOGIC_HOST` to the adapter's IPv4 address. `SCREENLOGIC_PORT` defaults to 80 **only** for a manually configured host; discovery uses the returned port. You can also set the variables in your shell. `.env` is excluded from Git.

### Running on a remote VM

The diagnostic uses UDP broadcast for discovery, which does not cross the internet or a typical VPN. A remote VM needs a private route to the adapter's home LAN address. One option is a Tailscale subnet router on an always-on home router, NAS, or small computer, with the VM joined to the same tailnet. Approve the advertised route and enable `accept-routes` on a Linux VM. See [Tailscale's subnet router guide](https://tailscale.com/docs/use-cases/personal-or-at-home-use/access-devices-without-tailscale).

On the VM, configure `SCREENLOGIC_HOST` with the adapter's home IPv4 address and `SCREENLOGIC_PORT` with its discovered port, then run `npm run diagnostics`. This bypasses UDP discovery and connects directly through the private route. Do not expose the adapter's TCP port to the public internet.

Pentair's app can use a remote relay, but `node-screenlogic` does not implement that relay connection. Its `RemoteLogin` only asks Pentair's dispatcher for a gateway address, then `UnitConnection` connects to that address directly. A working Pentair app relay therefore would not, by itself, give this project a VM connection. Relay support would require a separate protocol implementation and a working Pentair relay service.

The report includes a `summary`, all decoded `node-screenlogic` responses under `raw`, and `readErrors` for individual failed reads. It covers controller configuration and state, system time, temperatures, pumps, chlorinator, heater configuration and status, circuits, schedules, and chemistry when available. Unknown numeric status and alarm values are retained. A failed optional read remains `null`; it does not mean the equipment is healthy or absent.

Pump status is requested only for pumps listed in controller configuration. A `pumpTelemetry` value of `not-configured` means the controller lists no IntelliFlo pumps. A relay-controlled pump can still be represented by an active pool circuit without exposing RPM or watts. `unknown` means configuration or pump status could not be read.

`node-screenlogic` exposes an alarm count and chlorinator status bitmasks, but it does not decode every equipment fault. The monitor uses the confirmed alarm and delay fields and leaves unverified numeric statuses alone.

```sh
npm run typecheck
npm test
```

## Library choice

The diagnostic uses [node-screenlogic](https://github.com/parnic/node-screenlogic) because it directly connects to an existing ScreenLogic adapter and exposes the relevant read calls. [nodejs-poolController](https://github.com/tagyoureit/nodejs-poolController) is a full controller service with broad equipment support and a REST/WebSocket API, but adds a substantially larger runtime and control surface. It remains a useful reference if the direct library omits data we need. The chosen library's maintainer has [said that they can no longer test against ScreenLogic hardware](https://github.com/parnic/node-screenlogic#readme), so the diagnostic results need validation against the actual system.

## Scope

The live service exposes a small read-only status API and temperature page. It does not send equipment control commands. Pump-specific faults and detailed controller alarm text require additional data that this installation has not exposed through `node-screenlogic`.
