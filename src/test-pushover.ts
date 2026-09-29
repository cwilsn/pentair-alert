import { existsSync } from 'node:fs';
import { PushoverProvider } from './pushover.js';

if (existsSync('.env')) process.loadEnvFile('.env');
const appToken = process.env.PUSHOVER_APP_TOKEN?.trim();
const userKey = process.env.PUSHOVER_USER_KEY?.trim();
if (!appToken || !userKey) {
  console.error('Set PUSHOVER_APP_TOKEN and PUSHOVER_USER_KEY in .env first.');
  process.exitCode = 1;
} else {
  const provider = new PushoverProvider(appToken, userKey);
  try {
    await provider.send({
      id: 'test',
      title: 'Poolside test notification',
      message: 'Pushover is connected to your ScreenLogic monitor.',
      severity: 'warning',
      firstSeenAt: new Date().toISOString(),
      notifiedAt: null,
      value: 1,
    });
    console.log('Test notification sent.');
  } catch (error) {
    console.error('Could not send test notification:', error);
    process.exitCode = 1;
  }
}
