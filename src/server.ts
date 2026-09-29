import { existsSync } from 'node:fs';
import { appendFile, readFile, rename, writeFile } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfig } from './config.js';
import { initialStatus, reconcileAlerts, updateStatus, type AlertRecord, type MonitorStatus } from './monitor.js';
import { PushoverProvider } from './pushover.js';
import { readEquipmentState } from './screenlogic.js';

if (existsSync('.env')) process.loadEnvFile('.env');

function positiveInteger(name: string, fallback: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error(`${name} must be an integer from 1 to ${max}`);
  return value;
}

const screenlogic = readConfig();
const port = positiveInteger('PORT', 3000, 65535);
const bindHost = process.env.BIND_HOST?.trim() || '0.0.0.0';
const pollSeconds = positiveInteger('POLL_INTERVAL_SECONDS', 30, 3600);
const settings = {
  delayMinutes: positiveInteger('ALERT_DELAY_MINUTES', 5, 1440),
  offlineMinutes: positiveInteger('ALERT_OFFLINE_MINUTES', 5, 1440),
};
const stateFile = resolve(process.env.MONITOR_STATE_FILE?.trim() || '.monitor-state.json');
const alarmEventsFile = resolve('.alarm-events.jsonl');
const appToken = process.env.PUSHOVER_APP_TOKEN?.trim();
const userKey = process.env.PUSHOVER_USER_KEY?.trim();
if (Boolean(appToken) !== Boolean(userKey)) throw new Error('Set both PUSHOVER_APP_TOKEN and PUSHOVER_USER_KEY');
const notifier = appToken && userKey ? new PushoverProvider(appToken, userKey) : null;
const startedAt = new Date();
let status: MonitorStatus = initialStatus();
let alerts: AlertRecord[] = [];
let stopping = false;
let pollTimer: NodeJS.Timeout | null = null;

async function loadAlerts(): Promise<void> {
  try {
    const stored = JSON.parse(await readFile(stateFile, 'utf8')) as { alerts?: AlertRecord[] };
    if (Array.isArray(stored.alerts)) alerts = stored.alerts.filter(alert =>
      typeof alert.id === 'string' && typeof alert.firstSeenAt === 'string' &&
      (alert.notifiedAt === null || typeof alert.notifiedAt === 'string'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error('Could not load alert state:', error);
  }
}

async function saveAlerts(): Promise<void> {
  const temporary = `${stateFile}.tmp`;
  await writeFile(temporary, JSON.stringify({ alerts }, null, 2) + '\n', { mode: 0o600 });
  await rename(temporary, stateFile);
}

async function poll(): Promise<void> {
  const previousAlarmCount = status.alarmCount;
  try {
    const snapshot = await readEquipmentState(screenlogic);
    status = updateStatus(status, snapshot.state, new Date());
    const alarmCount = snapshot.state.alarms;
    if (alarmCount !== previousAlarmCount && (alarmCount > 0 || (previousAlarmCount ?? 0) > 0)) {
      try {
        await appendFile(alarmEventsFile, JSON.stringify({
          observedAt: status.checkedAt,
          alarmCount,
          decodedEquipmentState: snapshot.state,
          rawEquipmentResponseHex: snapshot.rawResponseHex,
        }) + '\n', { mode: 0o600 });
      } catch (error) {
        console.error('Could not save alarm evidence:', error);
      }
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ScreenLogic read failed:`, error);
    status = updateStatus(status, null, new Date());
  }

  const now = new Date();
  const result = reconcileAlerts(alerts, status, now, startedAt, settings);
  const changed = JSON.stringify(alerts) !== JSON.stringify(result.alerts);
  alerts = result.alerts;
  status.alerts = status.connected ? alerts : alerts.filter(alert => alert.id === 'screenlogic-offline');
  if (changed) {
    try { await saveAlerts(); }
    catch (error) { console.error('Could not save alert state:', error); }
  }
  for (const alert of result.due) {
    if (!notifier) continue;
    try {
      await notifier.send(alert);
      alert.notifiedAt = new Date().toISOString();
      await saveAlerts();
      console.log(`[${alert.notifiedAt}] Pushover sent: ${alert.title}`);
    } catch (error) {
      console.error(`Could not send ${alert.id} through Pushover:`, error);
    }
  }
}

async function pollLoop(): Promise<void> {
  if (stopping) return;
  try { await poll(); }
  catch (error) { console.error('Monitor poll failed:', error); }
  if (!stopping) pollTimer = setTimeout(() => { void pollLoop(); }, pollSeconds * 1000);
}

const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), '../public');
const assets = new Map([
  ['/', { file: 'index.html', type: 'text/html; charset=utf-8' }],
  ['/styles.css', { file: 'styles.css', type: 'text/css; charset=utf-8' }],
  ['/app.js', { file: 'app.js', type: 'text/javascript; charset=utf-8' }],
  ['/favicon.svg', { file: 'favicon.svg', type: 'image/svg+xml' }],
]);

function send(response: ServerResponse, code: number, body: string | Buffer, type: string): void {
  response.writeHead(code, {
    'content-type': type,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'",
  });
  response.end(body);
}

const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    send(response, 405, 'Method not allowed', 'text/plain; charset=utf-8');
    return;
  }
  let path: string;
  try { path = new URL(request.url || '/', 'http://localhost').pathname; }
  catch {
    send(response, 400, 'Bad request', 'text/plain; charset=utf-8');
    return;
  }
  if (path === '/api/status') {
    send(response, 200, JSON.stringify({ ...status, notificationsEnabled: Boolean(notifier) }), 'application/json; charset=utf-8');
    return;
  }
  const asset = assets.get(path);
  if (!asset) {
    send(response, 404, 'Not found', 'text/plain; charset=utf-8');
    return;
  }
  try {
    send(response, 200, await readFile(resolve(publicDir, asset.file)), asset.type);
  } catch (error) {
    console.error(`Could not read ${asset.file}:`, error);
    send(response, 500, 'Internal server error', 'text/plain; charset=utf-8');
  }
});

await loadAlerts();
server.listen(port, bindHost, () => {
  console.log(`ScreenLogic monitor listening on http://${bindHost}:${port}`);
  if (!notifier) console.warn('Pushover is not configured; alerts will appear on the page only.');
  void pollLoop();
});

function shutdown(): void {
  stopping = true;
  if (pollTimer) clearTimeout(pollTimer);
  server.close();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
