const elements = {
  connection: document.getElementById('connection'),
  connectionText: document.getElementById('connection-text'),
  pool: document.getElementById('pool-temp'),
  air: document.getElementById('air-temp'),
  salt: document.getElementById('salt-ppm'),
  poolUnit: document.getElementById('pool-unit'),
  airUnit: document.getElementById('air-unit'),
  updated: document.getElementById('updated-text'),
  alertPanel: document.getElementById('alert-panel'),
  alertTitle: document.getElementById('alert-title'),
  alertMessage: document.getElementById('alert-message'),
};

function showTemperature(element, value) {
  element.textContent = typeof value === 'number' && Number.isFinite(value) ? String(Math.round(value)) : '--';
}

function render(data) {
  const live = data.connected && data.temperatures?.updatedAt;
  const connecting = !data.checkedAt;
  elements.connection.className = `connection ${connecting ? 'is-connecting' : live ? 'is-live' : 'is-offline'}`;
  elements.connectionText.textContent = connecting ? 'Connecting' : live ? 'System online' : 'System offline';
  showTemperature(elements.pool, data.temperatures?.pool);
  showTemperature(elements.air, data.temperatures?.air);
  elements.salt.textContent = typeof data.saltPpm === 'number' && Number.isFinite(data.saltPpm)
    ? Math.round(data.saltPpm).toLocaleString()
    : '--';
  elements.poolUnit.textContent = data.temperatures?.unit || 'F';
  elements.airUnit.textContent = data.temperatures?.unit || 'F';

  if (data.temperatures?.updatedAt) {
    const time = new Date(data.temperatures.updatedAt);
    const label = time.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    elements.updated.textContent = `${live ? 'Updated' : 'Last reading'} ${label}`;
  } else {
    elements.updated.textContent = 'Waiting for first reading…';
  }

  const alert = data.alerts?.[0];
  elements.alertPanel.hidden = !alert;
  if (alert) {
    elements.alertTitle.textContent = data.alerts.length > 1 ? `${alert.title} + ${data.alerts.length - 1} more` : alert.title;
    elements.alertMessage.textContent = alert.message;
  }
}

async function refresh() {
  try {
    const response = await fetch('/api/status', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    render(await response.json());
  } catch {
    elements.connection.className = 'connection is-offline';
    elements.connectionText.textContent = 'Monitor unavailable';
    elements.updated.textContent = 'Could not reach the monitor. Retrying…';
  } finally {
    setTimeout(refresh, 15_000);
  }
}

void refresh();
