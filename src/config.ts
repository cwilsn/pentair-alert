import { isIP } from 'node:net';

export interface DiagnosticConfig {
  host: string | null;
  port: number | null;
  systemName: string;
  password: string;
  discoveryMs: number;
  requestTimeoutMs: number;
  output: string;
}

function integer(name: string, value: string | undefined, fallback: number, max: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
    throw new Error(`${name} must be an integer from 1 to ${max}`);
  }
  return parsed;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): DiagnosticConfig {
  const host = env.SCREENLOGIC_HOST?.trim() || null;
  const portValue = env.SCREENLOGIC_PORT?.trim();
  if (portValue && !host) throw new Error('SCREENLOGIC_PORT requires SCREENLOGIC_HOST');
  if (host && isIP(host) !== 4) {
    throw new Error('SCREENLOGIC_HOST must be a reachable IPv4 address');
  }
  return {
    host,
    port: host ? integer('SCREENLOGIC_PORT', portValue, 80, 65535) : null,
    systemName: env.SCREENLOGIC_SYSTEM_NAME?.trim() || '',
    password: env.SCREENLOGIC_PASSWORD || '',
    discoveryMs: integer('SCREENLOGIC_DISCOVERY_MS', env.SCREENLOGIC_DISCOVERY_MS, 5000, 60000),
    requestTimeoutMs: integer('SCREENLOGIC_REQUEST_TIMEOUT_MS', env.SCREENLOGIC_REQUEST_TIMEOUT_MS, 10000, 120000),
    output: env.DIAGNOSTICS_OUTPUT?.trim() || 'diagnostics.json',
  };
}
