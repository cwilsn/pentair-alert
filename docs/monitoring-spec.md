# Pentair ScreenLogic Local Monitoring Service

## Goal

Build a small local service that connects directly to a Pentair ScreenLogic system over the local network and exposes pool equipment status through a clean API.

The initial version should be **read-only**.

We do **not** need to reverse engineer the Pentair iOS app unless the existing ScreenLogic libraries fail to expose information we need.

The primary goal is to retrieve equipment state and eventually generate alerts when something is wrong without relying on the Pentair ScreenLogic app.

---

## High-Level Architecture

```text
Pentair Pool Equipment
        |
        v
ScreenLogic Protocol Adapter
        |
        | Local LAN
        v
Pool Monitoring Service
        |
        +--> REST API
        |
        +--> WebSocket / Event Stream
        |
        +--> Alert Engine
        |
        +--> Optional Database / History
        |
        v
Future Web App / iOS App / SMS / Push / Email
```

---

## Recommended Technology

Use:

- Node.js
- TypeScript
- Existing ScreenLogic library where practical
- Express or Fastify for REST endpoints

Preferred ScreenLogic library to evaluate first:

- `node-screenlogic`

Also evaluate whether `nodejs-poolController` provides a cleaner abstraction or exposes additional useful equipment data.

Do not implement the ScreenLogic binary protocol from scratch unless necessary.

---

# Phase 1 - ScreenLogic Discovery

## Objective

Automatically locate the Pentair ScreenLogic Protocol Adapter on the local network.

ScreenLogic adapters typically support discovery through UDP broadcast.

The implementation should:

1. Broadcast a ScreenLogic discovery request.
2. Detect available ScreenLogic adapters.
3. Return:
   - IP address
   - port
   - adapter name if available
   - controller information if available

Example internal object:

```json
{
  "ip": "192.168.1.123",
  "port": 80,
  "name": "Pentair ScreenLogic",
  "controllerType": "EasyTouch"
}
```

The exact port and metadata should come from discovery rather than being hardcoded when possible.

---

# Phase 2 - Connect to ScreenLogic

## Objective

Establish a persistent local connection to the ScreenLogic adapter.

The service should:

1. Discover the adapter.
2. Connect to it.
3. Authenticate/register if required by the ScreenLogic protocol.
4. Maintain the connection.
5. Reconnect automatically if the adapter becomes unavailable.

Connection failures should not crash the process.

Use exponential backoff or another reasonable retry strategy.

Example states:

```text
DISCONNECTED
DISCOVERING
CONNECTING
CONNECTED
RECONNECTING
```

---

# Phase 3 - Dump All Available Equipment Data

Before building a normalized API, create a diagnostic command that dumps everything the ScreenLogic library can retrieve from the user's system.

This is important because different Pentair installations expose different equipment.

Create something similar to:

```bash
npm run diagnostics
```

The output should include as much of the following as the system supports.

---

## Controller

Retrieve:

- controller type
- controller model
- firmware/software version if available
- system time
- controller mode
- communication status

Possible controller types include:

- EasyTouch
- IntelliTouch
- IntelliCenter
- other Pentair-compatible systems

---

## Temperatures

Retrieve:

- air temperature
- pool temperature
- spa temperature
- heater setpoint
- pool setpoint
- spa setpoint
- freeze protection threshold if available

Example:

```json
{
  "air": 76,
  "pool": 82,
  "spa": 84,
  "poolSetpoint": 84,
  "spaSetpoint": 101
}
```

---

## Pumps

Enumerate all pumps.

For each pump retrieve whatever is available:

- pump ID
- pump name
- running / stopped
- RPM
- watts
- flow rate
- GPM
- current program
- status
- error state
- communication status

Example:

```json
{
  "id": 1,
  "name": "Pool Pump",
  "running": true,
  "rpm": 2250,
  "watts": 680,
  "gpm": null,
  "status": "OK"
}
```

Do not assume every pump exposes every field.

---

## Chlorinator / Salt System

Retrieve IntelliChlor or other salt chlorinator information if available.

Try to retrieve:

- enabled
- output percentage
- salt level
- salt status
- flow status
- cell status
- super chlorination state
- remaining super chlorination time
- error codes
- warning codes
- communication status

Example:

```json
{
  "enabled": true,
  "outputPercent": 40,
  "saltPpm": 3300,
  "flow": true,
  "status": "OK",
  "warnings": []
}
```

This is especially important because one of the primary project goals is alerting on low salt and chlorinator problems.

---

## Heaters

Enumerate heaters.

Retrieve:

- heater type
- heater enabled
- currently heating
- requested temperature
- current temperature
- status
- error / fault codes if available

---

## Circuits

Retrieve all configured circuits/features.

Examples:

- Pool
- Spa
- Cleaner
- Waterfall
- Lights
- Jets
- Blower
- Feature circuits

For each circuit retrieve:

```json
{
  "id": 1,
  "name": "Pool",
  "active": true
}
```

---

## Chemistry

If compatible chemistry equipment exists, retrieve:

- pH
- ORP
- sanitizer level
- chemical tank levels
- chemistry warnings
- chemistry faults

Do not assume chemistry equipment exists.

---

## Schedules

Retrieve configured schedules if exposed.

For each schedule retrieve:

- circuit
- start time
- stop time
- days of week
- enabled
- egg timer / duration if applicable

This information will later allow us to detect conditions such as:

> Pump should currently be running but is not.

---

## Equipment Errors and Warnings

This is a priority.

Determine what errors and warnings are available from ScreenLogic.

Capture:

- pump errors
- chlorinator warnings
- heater faults
- controller faults
- communication errors
- sensor errors
- equipment offline conditions

If the library exposes raw status codes, preserve the raw code in addition to any normalized text.

Example:

```json
{
  "source": "chlorinator",
  "code": 4,
  "message": "Low Salt",
  "severity": "warning"
}
```

---

# Phase 4 - Normalize the Data

After determining what the user's actual system exposes, create a normalized internal representation.

Example:

```ts
interface PoolState {
  connected: boolean;
  controller: ControllerState;
  temperatures: TemperatureState;
  pumps: PumpState[];
  chlorinators: ChlorinatorState[];
  heaters: HeaterState[];
  circuits: CircuitState[];
  chemistry?: ChemistryState;
  schedules: ScheduleState[];
  alerts: EquipmentAlert[];
  updatedAt: string;
}
```

---

## Example Normalized State

```json
{
  "connected": true,
  "controller": {
    "type": "EasyTouch",
    "status": "OK"
  },
  "temperatures": {
    "air": 76,
    "pool": 82,
    "spa": 84
  },
  "pumps": [
    {
      "id": 1,
      "name": "Pool Pump",
      "running": true,
      "rpm": 2250,
      "watts": 680,
      "status": "OK"
    }
  ],
  "chlorinators": [
    {
      "id": 1,
      "enabled": true,
      "outputPercent": 40,
      "saltPpm": 3300,
      "flow": true,
      "status": "OK"
    }
  ],
  "heaters": [],
  "circuits": [
    {
      "id": 1,
      "name": "Pool",
      "active": true
    }
  ],
  "alerts": [],
  "updatedAt": "2026-09-28T22:00:00Z"
}
```

---

# Phase 5 - REST API

Expose the normalized state through a small REST API.

Minimum endpoints:

```http
GET /api/status
GET /api/controller
GET /api/temperatures
GET /api/pumps
GET /api/chlorinators
GET /api/heaters
GET /api/circuits
GET /api/schedules
GET /api/alerts
```

---

## GET /api/status

Return a summary of the entire system.

Example:

```json
{
  "connected": true,
  "poolTemperature": 82,
  "airTemperature": 76,
  "pumpRunning": true,
  "chlorinatorStatus": "OK",
  "activeAlerts": 0,
  "updatedAt": "2026-09-28T22:00:00Z"
}
```

---

# Phase 6 - Event Handling

If the ScreenLogic library supports equipment change events, use them.

Prefer receiving state change events over aggressively polling the controller.

However, still perform periodic full-state synchronization to protect against missed events.

Suggested strategy:

```text
ScreenLogic event
      |
      v
Update internal state
      |
      v
Evaluate alerts
      |
      v
Broadcast WebSocket update
```

Perform a full synchronization periodically, such as every 30-60 seconds.

The exact interval should be configurable.

---

# Phase 7 - Alert Engine

Create an alert engine independent of the ScreenLogic protocol code.

Alert rules should operate against normalized state.

Initial rules should include:

---

## ScreenLogic Offline

Trigger when the ScreenLogic adapter cannot be reached for a configurable amount of time.

Example:

```text
ScreenLogic adapter has been offline for more than 5 minutes.
```

---

## Pump Expected But Not Running

If a schedule or active pool circuit indicates a pump should be running but:

```text
RPM == 0
```

or the pump reports stopped/offline, create an alert.

Allow a short grace period to avoid false positives during startup.

Example:

```text
Pool pump should be running but has reported 0 RPM for more than 2 minutes.
```

---

## Pump Communication Error

Trigger when the controller cannot communicate with a configured pump.

---

## Low Salt

Trigger when:

- ScreenLogic reports a low-salt warning, or
- salt PPM falls below a configurable threshold.

Example:

```text
Salt level is low: 2500 ppm.
```

---

## Chlorinator No Flow

If the chlorinator should be operating but reports no flow for a configurable period, create an alert.

---

## Chlorinator Fault

Surface any chlorinator error or warning codes.

---

## Heater Fault

Surface heater fault/error codes.

---

## Unexpected Temperature Condition

Support configurable temperature alerts.

Example:

```text
Pool temperature below 40°F.
```

---

## Freeze Protection

If freeze protection data is available, create alerts when:

- air temperature is below the configured threshold
- freeze protection should be active
- required equipment is not running

---

# Phase 8 - Alert Deduplication

Do not repeatedly notify for the same ongoing condition.

Track alert lifecycle:

```text
NEW
ACTIVE
RESOLVED
```

Example:

```json
{
  "id": "chlorinator-low-salt",
  "status": "ACTIVE",
  "firstDetectedAt": "...",
  "lastDetectedAt": "...",
  "resolvedAt": null
}
```

Only send a notification when:

1. an alert becomes NEW, or
2. an existing alert changes severity.

Optionally send a recovery notification when the condition becomes resolved.

---

# Phase 9 - Persistence

Persistence is optional for the first proof of concept.

Eventually store:

- equipment state snapshots
- alerts
- alert resolutions
- pump RPM
- pump wattage
- temperatures
- salt levels
- connection outages

SQLite is acceptable for the initial local service.

The persistence layer should be abstracted so a different database can be used later.

---

# Phase 10 - Historical Monitoring

Longer term, historical data can help detect abnormal behavior.

Examples:

```text
Pump normally consumes ~650 watts at 2200 RPM.

Current consumption: 1100 watts.
```

Potential alerts:

- unusually high pump wattage
- declining flow rate
- pump cycling unexpectedly
- salt level trending downward quickly
- heater taking unusually long to reach temperature

Do not implement anomaly detection in the first version.

Simply structure historical storage so it can be added later.

---

# Phase 11 - Notifications

Do not tightly couple notifications to the ScreenLogic integration.

Create an interface such as:

```ts
interface NotificationProvider {
  send(alert: EquipmentAlert): Promise<void>;
}
```

Possible future implementations:

- Email
- SMS
- Apple Push Notifications
- Pushover
- Slack
- Discord
- Webhook

For the first version, logging the alert to the console is acceptable.

---

# Phase 12 - WebSocket API

Expose live state updates.

Example:

```text
ws://localhost:3000/ws
```

Potential event types:

```json
{
  "type": "pump.updated",
  "data": {}
}
```

```json
{
  "type": "chlorinator.updated",
  "data": {}
}
```

```json
{
  "type": "alert.created",
  "data": {}
}
```

```json
{
  "type": "alert.resolved",
  "data": {}
}
```

This will make it easy to build a future iOS or web interface.

---

# Phase 13 - Configuration

Use environment variables or a config file.

Example:

```env
PORT=3000

SCREENLOGIC_AUTO_DISCOVER=true
SCREENLOGIC_HOST=
SCREENLOGIC_PORT=

POLL_INTERVAL_SECONDS=30

ALERT_OFFLINE_MINUTES=5
ALERT_PUMP_ZERO_RPM_SECONDS=120
ALERT_LOW_SALT_PPM=2800
```

Allow manual ScreenLogic IP configuration as a fallback if discovery does not work.

---

# Project Structure

Suggested structure:

```text
src/
  screenlogic/
    client.ts
    discovery.ts
    mapper.ts
    types.ts

  state/
    pool-state.ts
    state-manager.ts

  alerts/
    alert-engine.ts
    alert-types.ts
    rules/
      screenlogic-offline.ts
      pump-not-running.ts
      low-salt.ts
      chlorinator-no-flow.ts
      heater-fault.ts
      freeze-protection.ts

  api/
    routes/
      status.ts
      pumps.ts
      chlorinators.ts
      heaters.ts
      temperatures.ts
      circuits.ts
      alerts.ts

  websocket/
    server.ts

  notifications/
    notification-provider.ts
    console-provider.ts

  diagnostics/
    dump-system.ts

  index.ts
```

---

# Error Handling

The service must tolerate:

- ScreenLogic adapter reboot
- router/network interruption
- controller restart
- malformed/unknown ScreenLogic response
- unavailable equipment
- equipment that does not support certain fields

Missing data should generally be represented as:

```json
null
```

rather than crashing the application.

Unknown status codes should preserve both the numeric/raw value and a safe fallback description.

Example:

```json
{
  "code": 17,
  "message": "Unknown ScreenLogic status",
  "raw": 17
}
```

---

# Logging

Add structured logging.

Important events:

```text
ScreenLogic discovered
ScreenLogic connected
ScreenLogic disconnected
ScreenLogic reconnecting

Pump state changed
Chlorinator state changed
Heater state changed

Alert created
Alert resolved
```

Do not log excessively noisy state polling at INFO level.

---

# Diagnostics Command

This is the first important deliverable.

Create:

```bash
npm run diagnostics
```

It should:

1. discover ScreenLogic
2. connect
3. retrieve all available controller information
4. retrieve all equipment state
5. print formatted JSON
6. print raw responses where useful

Example:

```text
ScreenLogic Adapter
-------------------
IP: 192.168.1.123
Controller: EasyTouch

Temperatures
------------
Air: 76°F
Pool: 82°F

Pump 1
------
Running: Yes
RPM: 2250
Watts: 680

Chlorinator
-----------
Status: OK
Salt: 3300 ppm
Output: 40%
Flow: Yes
```

Also write the complete raw diagnostic response to a file:

```text
diagnostics.json
```

This file will be used to determine exactly what the user's particular Pentair installation exposes.

---

# Important Development Rule

Do **not** start by implementing write/control commands.

Initial version is strictly:

```text
READ ONLY
```

Do not include endpoints that:

- turn pumps on/off
- change RPM
- change schedules
- activate spa
- activate heaters
- change temperature
- change salt output
- toggle circuits

Those can be added later after the monitoring implementation is stable.

---

# Reverse Engineering Fallback

Only if the existing ScreenLogic libraries fail to expose necessary diagnostic or error information should we investigate lower-level ScreenLogic protocol traffic.

If needed:

1. capture communication between the existing Pentair application and the ScreenLogic adapter
2. identify message IDs
3. compare requests/responses
4. document unknown messages
5. extend the local ScreenLogic client

Do not reverse engineer the iOS application unless there is a specific missing capability.

Prefer inspecting network protocol traffic rather than decompiling the application.

---

# First Implementation Milestone

The first milestone is complete when running:

```bash
npm run diagnostics
```

successfully discovers the user's ScreenLogic adapter and prints:

- controller information
- temperatures
- pumps
- pump RPM
- pump wattage
- chlorinator information
- salt level/status if available
- heaters
- circuits
- schedules
- all available warnings/errors
- raw or unknown status codes

Do not proceed too far into API/UI development until this diagnostic output has been reviewed.

The purpose of the first milestone is to answer:

> What information can we actually retrieve from this specific Pentair pool system?

Once that is known, build the normalized API and alert engine around the confirmed available data.

---

# Ultimate Goal

The finished system should allow an external application to ask:

```http
GET /api/status
```

and receive a reliable representation of the pool:

```json
{
  "connected": true,
  "poolTemperature": 82,
  "airTemperature": 76,

  "pump": {
    "running": true,
    "rpm": 2250,
    "watts": 680
  },

  "chlorinator": {
    "status": "OK",
    "saltPpm": 3300,
    "outputPercent": 40
  },

  "alerts": []
}
```

The system should eventually notify the user automatically when equipment problems occur without requiring the Pentair ScreenLogic application to be opened.
