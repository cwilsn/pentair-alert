import type { AlertRecord } from './monitor.js';

export interface NotificationProvider {
  send(alert: AlertRecord): Promise<void>;
}

export class PushoverProvider implements NotificationProvider {
  constructor(private readonly appToken: string, private readonly userKey: string) {}

  async send(alert: AlertRecord): Promise<void> {
    const body = new URLSearchParams({
      token: this.appToken,
      user: this.userKey,
      title: alert.title,
      message: alert.message,
      priority: alert.severity === 'error' ? '1' : '0',
    });
    const response = await fetch('https://api.pushover.net/1/messages.json', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Pushover rejected notification (HTTP ${response.status})`);
    const result = await response.json() as { status?: number };
    if (result.status !== 1) throw new Error('Pushover did not confirm the notification');
  }
}
