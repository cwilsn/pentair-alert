import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  FindUnits,
  SchedTypes,
  UnitConnection,
  type LocalUnit,
} from 'node-screenlogic';
import { readConfig } from './config.js';
import {
  emptyReadings,
  summarize,
  type Adapter,
  type DiagnosticReport,
} from './report.js';

if (existsSync('.env')) process.loadEnvFile('.env');

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function timeout<T>(task: Promise<T>, milliseconds: number, label: string): Promise<T> {
  return new Promise((accept, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${milliseconds} ms`)), milliseconds);
    task.then(
      value => { clearTimeout(timer); accept(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}

function fromUnit(unit: LocalUnit): Adapter {
  return {
    address: unit.address,
    port: unit.port,
    gatewayName: unit.gatewayName.trim() || null,
    gatewayType: unit.gatewayType,
    gatewaySubtype: unit.gatewaySubtype,
    discoveryType: unit.type,
    source: 'discovery',
  };
}

async function discover(milliseconds: number): Promise<Adapter[]> {
  const finder = new FindUnits();
  let socketError: Error | null = null;
  finder.on('error', (error: Error) => { socketError = error; });
  try {
    const units = await timeout(finder.searchAsync(milliseconds), milliseconds + 2000, 'discovery');
    if (socketError) throw socketError;
    return units.filter(unit => unit.port > 0).map(fromUnit);
  } finally {
    finder.close();
  }
}

async function collect(client: UnitConnection, report: DiagnosticReport, requestTimeoutMs: number): Promise<void> {
  const raw = report.raw;
  async function read<T>(label: string, operation: () => Promise<T>): Promise<T | null> {
    process.stderr.write(`Reading ${label}...\n`);
    try {
      return await timeout(operation(), requestTimeoutMs * (label === 'circuitNames' ? 4 : 2), label);
    } catch (error) {
      const message = errorText(error);
      report.readErrors[label] = message;
      process.stderr.write(`  ${label}: ${message}\n`);
      return null;
    }
  }

  raw.version = await read('version', () => client.getVersionAsync());
  raw.controllerConfig = await read('controllerConfig', () => client.equipment.getControllerConfigAsync());
  raw.equipmentConfig = await read('equipmentConfig', () => client.equipment.getEquipmentConfigurationAsync());
  raw.equipmentState = await read('equipmentState', () => client.equipment.getEquipmentStateAsync());
  raw.systemTime = await read('systemTime', () => client.equipment.getSystemTimeAsync());

  const configuredPumps = raw.equipmentConfig?.pumps ?? [];
  const pumpPresence = Array.from({ length: 8 }, (_, index) =>
    raw.controllerConfig?.equipment?.[`POOL_IFLOWPRESENT${index}` as keyof typeof raw.controllerConfig.equipment] === true ? index + 1 : 0,
  );
  const count = Math.min(8, Math.max(raw.equipmentConfig?.numPumps ?? 0, configuredPumps.length, ...pumpPresence));
  for (let id = 1; id <= count; id++) {
    const status = await read(`pump.${id}`, () => client.pump.getPumpStatusAsync(id));
    raw.pumps.push({ requestedId: id, configuration: configuredPumps[id - 1] ?? null, status });
    // All pump reads use the same response event; a stale listener can mislabel the next pump.
    if (!status) break;
  }

  raw.recurringSchedules = await read('recurringSchedules', () => client.schedule.getScheduleDataAsync(SchedTypes.RECURRING));
  if (raw.recurringSchedules) raw.runOnceSchedules = await read('runOnceSchedules', () => client.schedule.getScheduleDataAsync(SchedTypes.RUNONCE));
  raw.chlorinator = await read('chlorinator', () => client.chlor.getIntellichlorConfigAsync());
  raw.chemistry = await read('chemistry', () => client.chem.getChemicalDataAsync());
  raw.circuitNames = await read('circuitNames', () => client.equipment.getAllCircuitNamesAsync());
  raw.circuitDefinitions = await read('circuitDefinitions', () => client.equipment.getCircuitDefinitionsAsync());
  raw.customNames = await read('customNames', () => client.equipment.getCustomNamesAsync());
}

async function main(): Promise<void> {
  const config = readConfig();
  const report: DiagnosticReport = {
    capturedAt: new Date().toISOString(),
    connected: false,
    adapter: null,
    discoveredAdapters: [],
    summary: null,
    raw: emptyReadings(),
    readErrors: {},
    limitations: [
      'The library provides an alarm count, but not individual controller alarm messages.',
      'Chlorinator status and flags are raw numeric values; their meanings are not yet verified for this system.',
    ],
  };
  let client: UnitConnection | null = null;
  let failed = false;
  try {
    if (config.host) {
      report.adapter = {
        address: config.host,
        port: config.port!,
        gatewayName: config.systemName || null,
        gatewayType: null,
        gatewaySubtype: null,
        discoveryType: null,
        source: 'manual',
      };
    } else {
      process.stderr.write('Discovering ScreenLogic adapters on the local network...\n');
      report.discoveredAdapters = await discover(config.discoveryMs);
      report.adapter = report.discoveredAdapters[0] ?? null;
      if (!report.adapter) throw new Error('No ScreenLogic adapter found. Check the local subnet or set SCREENLOGIC_HOST.');
    }
    const adapter = report.adapter;
    process.stderr.write(`Connecting to ${adapter.address}:${adapter.port}...\n`);
    client = new UnitConnection();
    client.netTimeout = config.requestTimeoutMs;
    client.init(config.systemName || adapter.gatewayName || '', adapter.address, adapter.port, config.password);
    await timeout(client.connectAsync(), config.requestTimeoutMs * 2, 'connection');
    report.connected = true;
    await collect(client, report, config.requestTimeoutMs);
  } catch (error) {
    failed = true;
    report.readErrors.fatal = errorText(error);
    process.stderr.write(`Diagnostic stopped: ${report.readErrors.fatal}\n`);
  } finally {
    if (client) await client.closeAsync();
  }

  report.summary = summarize(report.raw);
  if (report.summary.pumpTelemetry === 'not-configured') {
    report.limitations.push('The controller lists no IntelliFlo pumps. A relay-controlled pump may still run, but ScreenLogic does not report its RPM or watts.');
  }
  const output = resolve(config.output);
  const json = JSON.stringify(report, null, 2) + '\n';
  await writeFile(output, json, { mode: 0o600 });
  process.stdout.write(json);
  process.stderr.write(`Saved decoded diagnostic report to ${output}\n`);
  if (failed) process.exitCode = 1;
}

main().catch(error => {
  process.stderr.write(`Diagnostic failed: ${errorText(error)}\n`);
  process.exitCode = 1;
});
