# Poolside ScreenLogic monitor

A read-only local dashboard for pool and outside temperature and salt level, with Pushover notifications for controller alarms, sustained system delays, and loss of contact with ScreenLogic. The full original requirements are in [the monitoring spec](docs/monitoring-spec.md).

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

When the controller alarm count changes to or from a nonzero value, the monitor appends the timestamp, decoded equipment state, and raw equipment response frame to `.alarm-events.jsonl` with owner-only permissions. This captures evidence for future alarms; it does not recover past frames or decode the alert description shown by Pentair's app.

**Pump limitation:** when a controller does not expose an IntelliFlo pump through this library, the monitor receives no RPM, watts, or direct pump fault status. It cannot confirm a relay-controlled pump is running or identify a controller alarm as a pump fault. Pentair's app displays named alerts, but the library call currently used by this monitor returns only their count. A controller alarm notification tells you to check the Pentair panel or app for the description. System delays can be normal during transitions, so they have a grace period. The monitor does not decode chlorinator numeric flags into warnings.

### Keep it running on Linux

Use a current Linux distribution, including Raspberry Pi OS, with Node.js 22 or newer. Follow the setup above before creating a service.

After one successful `npm start`, create a systemd user service so monitoring starts after reboot. Run the following **from the project directory**:

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

`loginctl enable-linger` keeps the user service running after logout and at boot; if it asks for elevated privileges, run that one command with `sudo`. Use `journalctl --user -u screenlogic-monitor -f` to see reads and notification errors. Before moving the service to another machine, copy `.monitor-state.json` with it if you want to preserve notification deduplication.

## Run diagnostics

The diagnostic collects a broader report than the live dashboard. Run it on the same local subnet as the adapter.

```sh
npm install
npm run diagnostics
```

The command broadcasts a ScreenLogic discovery request, connects to the first adapter found, prints formatted JSON, and saves the same report to `diagnostics.json`. Progress and read errors go to stderr. The file is excluded from Git and created with owner-only permissions because it may contain local network and equipment details.

If broadcast discovery does not work, copy `.env.example` to `.env` and set `SCREENLOGIC_HOST` to the adapter's IPv4 address. `SCREENLOGIC_PORT` defaults to 80 **only** for a manually configured host; discovery uses the returned port. You can also set the variables in your shell. `.env` is excluded from Git.

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
