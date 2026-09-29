import assert from 'node:assert/strict';
import test from 'node:test';
import { readConfig } from '../src/config.js';
import { emptyReadings, summarize } from '../src/report.js';

test('missing equipment remains unknown, rather than appearing healthy', () => {
  const summary = summarize(emptyReadings());
  assert.equal(summary.controller.alarmCount, null);
  assert.equal(summary.chlorinator.installed, null);
  assert.equal(summary.chlorinator.saltPpm, null);
  assert.equal(summary.pumpTelemetry, 'unknown');
  assert.deepEqual(summary.pumps, []);
});

test('zero configured pumps does not imply a pump read failure', () => {
  const raw = emptyReadings();
  raw.equipmentConfig = { numPumps: 0, pumps: [] } as NonNullable<typeof raw.equipmentConfig>;
  const summary = summarize(raw);
  assert.equal(summary.pumpTelemetry, 'not-configured');
  assert.deepEqual(summary.pumps, []);
});

test('raw chlorinator status and controller alarm count survive summarization', () => {
  const raw = emptyReadings();
  raw.chlorinator = {
    senderId: 0,
    installed: true,
    status: 17,
    poolSetPoint: 40,
    spaSetPoint: 10,
    salt: 2600,
    flags: 129,
    superChlorTimer: 0,
  };
  raw.equipmentState = {
    senderId: 0,
    panelMode: 0,
    freezeMode: 0,
    remotes: 0,
    poolDelay: 0,
    spaDelay: 0,
    cleanerDelay: 0,
    airTemp: 72,
    bodiesCount: 1,
    bodies: [{ id: 0, currentTemp: 81, heatStatus: 0, setPoint: 84, coolSetPoint: 0, heatMode: 0 }],
    circuitArray: [{ id: 505, state: 1, colorSet: 0, colorPos: 0, colorStagger: 0, delay: 0 }],
    pH: 0,
    orp: 0,
    saturation: 0,
    saltPPM: 2600,
    pHTank: 0,
    orpTank: 0,
    alarms: 2,
  };
  const summary = summarize(raw);
  assert.equal(summary.chlorinator.statusRaw, 17);
  assert.equal(summary.chlorinator.flagsRaw, 129);
  assert.equal(summary.controller.alarmCount, 2);
  assert.equal(summary.temperatures.bodies[0]?.current, 81);
  assert.equal(summary.circuits[0]?.active, true);
});

test('manual endpoint requires a valid IPv4 host and port', () => {
  assert.throws(() => readConfig({ SCREENLOGIC_PORT: '80' }), /requires SCREENLOGIC_HOST/);
  assert.throws(() => readConfig({ SCREENLOGIC_HOST: 'example.com' }), /reachable IPv4/);
  assert.throws(() => readConfig({ SCREENLOGIC_HOST: '192.168.1.10', SCREENLOGIC_PORT: '0' }), /integer/);
  const config = readConfig({ SCREENLOGIC_HOST: '192.168.1.10' });
  assert.equal(config.port, 80);
});
