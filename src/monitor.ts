import type { SLEquipmentStateData } from 'node-screenlogic';

export interface TemperatureSnapshot {
  air: number | null;
  pool: number | null;
  unit: 'F';
  updatedAt: string | null;
}

export interface MonitorStatus {
  connected: boolean;
  checkedAt: string | null;
  temperatures: TemperatureSnapshot;
  saltPpm: number | null;
  alarmCount: number | null;
  delays: { pool: boolean; spa: boolean; cleaner: boolean } | null;
  alerts: AlertRecord[];
}

export interface AlertRecord {
  id: string;
  title: string;
  message: string;
  severity: 'warning' | 'error';
  firstSeenAt: string;
  notifiedAt: string | null;
  value: number;
  unconfirmed?: boolean;
}

export interface AlertSettings {
  delayMinutes: number;
  offlineMinutes: number;
}

export function initialStatus(): MonitorStatus {
  return {
    connected: false,
    checkedAt: null,
    temperatures: { air: null, pool: null, unit: 'F', updatedAt: null },
    saltPpm: null,
    alarmCount: null,
    delays: null,
    alerts: [],
  };
}

export function updateStatus(previous: MonitorStatus, reading: SLEquipmentStateData | null, now: Date): MonitorStatus {
  const checkedAt = now.toISOString();
  if (!reading) return { ...previous, connected: false, checkedAt };
  return {
    ...previous,
    connected: true,
    checkedAt,
    temperatures: {
      air: reading.airTemp,
      pool: reading.bodies.find(body => body.id === 1)?.currentTemp ?? null,
      unit: 'F',
      updatedAt: checkedAt,
    },
    saltPpm: Number.isFinite(reading.saltPPM) && reading.saltPPM >= 0 ? reading.saltPPM : null,
    alarmCount: reading.alarms,
    delays: {
      pool: reading.poolDelay !== 0,
      spa: reading.spaDelay !== 0,
      cleaner: reading.cleanerDelay !== 0,
    },
  };
}

interface Condition {
  id: string;
  title: string;
  message: string;
  severity: AlertRecord['severity'];
  value: number;
}

export function reconcileAlerts(
  previous: AlertRecord[],
  status: MonitorStatus,
  now: Date,
  startedAt: Date,
  settings: AlertSettings,
): { alerts: AlertRecord[]; due: AlertRecord[] } {
  const conditions: Condition[] = [];
  if (status.connected) {
    if ((status.alarmCount ?? 0) > 0) {
      const count = status.alarmCount!;
      conditions.push({
        id: 'controller-alarm',
        title: 'ScreenLogic system alarm',
        message: `The controller reports ${count} active alarm${count === 1 ? '' : 's'}. Check the ScreenLogic app or panel for the description; this monitor currently receives only the count.`,
        severity: 'error',
        value: count,
      });
    }
    for (const key of ['pool', 'spa', 'cleaner'] as const) {
      if (status.delays?.[key]) {
        conditions.push({
          id: `${key}-delay`,
          title: `${key[0].toUpperCase()}${key.slice(1)} system delay`,
          message: `The ScreenLogic controller reports an active ${key} delay. Check the Pentair panel or app if it persists.`,
          severity: 'warning',
          value: 1,
        });
      }
    }
  } else {
    const lastGood = status.temperatures.updatedAt ? new Date(status.temperatures.updatedAt) : startedAt;
    if (now.getTime() - lastGood.getTime() >= settings.offlineMinutes * 60_000) {
      conditions.push({
        id: 'screenlogic-offline',
        title: 'ScreenLogic is unreachable',
        message: `The monitor has not received a ScreenLogic reading for at least ${settings.offlineMinutes} minutes. Check the adapter and network.`,
        severity: 'error',
        value: 1,
      });
    }
  }

  const old = new Map(previous.map(alert => [alert.id, alert]));
  const alerts: AlertRecord[] = conditions.map(condition => {
    const prior = old.get(condition.id);
    return {
      ...condition,
      firstSeenAt: prior?.unconfirmed && condition.id.endsWith('-delay') && !prior.notifiedAt
        ? now.toISOString() : prior?.firstSeenAt ?? now.toISOString(),
      notifiedAt: prior && condition.value <= prior.value ? prior.notifiedAt : null,
      unconfirmed: false,
    };
  });
  // A failed read cannot prove that a previously reported alarm cleared.
  // Keep its notification state until the next successful reading.
  if (!status.connected) alerts.push(...previous.filter(alert => alert.id !== 'screenlogic-offline').map(alert =>
    alert.id.endsWith('-delay') && !alert.notifiedAt ? { ...alert, unconfirmed: true } : alert,
  ));
  const currentIds = new Set(conditions.map(condition => condition.id));
  const due = alerts.filter(alert => {
    if (!currentIds.has(alert.id)) return false;
    if (alert.notifiedAt) return false;
    const graceMs = alert.id.endsWith('-delay') ? settings.delayMinutes * 60_000 : 0;
    return now.getTime() - new Date(alert.firstSeenAt).getTime() >= graceMs;
  });
  return { alerts, due };
}
