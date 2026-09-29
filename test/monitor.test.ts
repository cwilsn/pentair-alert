import assert from 'node:assert/strict';
import test from 'node:test';
import type { SLEquipmentStateData } from 'node-screenlogic';
import { initialStatus, reconcileAlerts, updateStatus } from '../src/monitor.js';

const settings = { delayMinutes: 5, offlineMinutes: 5 };
const started = new Date('2026-01-01T12:00:00Z');
const at = (minutes: number) => new Date(started.getTime() + minutes * 60_000);

function reading(values: Partial<SLEquipmentStateData> = {}): SLEquipmentStateData {
  return {
    airTemp: 72,
    bodies: [{ id: 1, currentTemp: 81, heatStatus: 0, setPoint: 85, coolSetPoint: 0, heatMode: 0 }],
    alarms: 0,
    poolDelay: 0,
    spaDelay: 0,
    cleanerDelay: 0,
    ...values,
  } as SLEquipmentStateData;
}

test('maps air and pool temperature from actual equipment state fields', () => {
  const status = updateStatus(initialStatus(), reading(), started);
  assert.equal(status.temperatures.air, 72);
  assert.equal(status.temperatures.pool, 81);
  assert.equal(status.temperatures.unit, 'F');
  assert.equal(status.connected, true);
});

test('controller alarm sends once and sends again if alarm count increases', () => {
  const status = updateStatus(initialStatus(), reading({ alarms: 1 }), started);
  const first = reconcileAlerts([], status, started, started, settings);
  assert.deepEqual(first.due.map(alert => alert.id), ['controller-alarm']);
  first.alerts[0]!.notifiedAt = started.toISOString();
  const same = reconcileAlerts(first.alerts, status, at(1), started, settings);
  assert.equal(same.due.length, 0);
  const increased = reconcileAlerts(same.alerts, updateStatus(status, reading({ alarms: 2 }), at(2)), at(2), started, settings);
  assert.deepEqual(increased.due.map(alert => alert.id), ['controller-alarm']);
});

test('short system delay is visible but does not push before grace period', () => {
  const status = updateStatus(initialStatus(), reading({ poolDelay: 1 }), started);
  const first = reconcileAlerts([], status, started, started, settings);
  assert.deepEqual(first.alerts.map(alert => alert.id), ['pool-delay']);
  assert.equal(first.due.length, 0);
  const early = reconcileAlerts(first.alerts, status, at(4), started, settings);
  assert.equal(early.due.length, 0);
  const late = reconcileAlerts(early.alerts, status, at(5), started, settings);
  assert.deepEqual(late.due.map(alert => alert.id), ['pool-delay']);
  const clear = reconcileAlerts(late.alerts, updateStatus(status, reading(), at(6)), at(6), started, settings);
  assert.equal(clear.alerts.length, 0);
});

test('connection loss preserves alarm notification state and alerts after offline threshold', () => {
  const healthy = updateStatus(initialStatus(), reading({ alarms: 1 }), started);
  const observed = reconcileAlerts([], healthy, started, started, settings);
  observed.alerts[0]!.notifiedAt = started.toISOString();
  const disconnected = updateStatus(healthy, null, at(6));
  const offline = reconcileAlerts(observed.alerts, disconnected, at(6), started, settings);
  assert.deepEqual(offline.due.map(alert => alert.id), ['screenlogic-offline']);
  assert.equal(offline.alerts.find(alert => alert.id === 'controller-alarm')?.notifiedAt, started.toISOString());
  const restored = reconcileAlerts(offline.alerts, updateStatus(disconnected, reading({ alarms: 1 }), at(7)), at(7), started, settings);
  assert.equal(restored.due.length, 0);
  assert.deepEqual(restored.alerts.map(alert => alert.id), ['controller-alarm']);
});

test('an interrupted delay must be observed again for the full grace period', () => {
  const delayed = updateStatus(initialStatus(), reading({ poolDelay: 1 }), started);
  const first = reconcileAlerts([], delayed, started, started, settings);
  const disconnected = reconcileAlerts(first.alerts, updateStatus(delayed, null, at(4)), at(4), started, settings);
  const restoredStatus = updateStatus(delayed, reading({ poolDelay: 1 }), at(5));
  const restored = reconcileAlerts(disconnected.alerts, restoredStatus, at(5), started, settings);
  assert.equal(restored.due.length, 0);
  const late = reconcileAlerts(restored.alerts, restoredStatus, at(9), started, settings);
  assert.equal(late.due.length, 0);
  const due = reconcileAlerts(late.alerts, restoredStatus, at(10), started, settings);
  assert.deepEqual(due.due.map(alert => alert.id), ['pool-delay']);
});
