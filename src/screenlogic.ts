import { FindUnits, UnitConnection, type SLEquipmentStateData } from 'node-screenlogic';
import type { DiagnosticConfig } from './config.js';

function timed<T>(operation: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    operation.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}

export async function readEquipmentState(config: DiagnosticConfig): Promise<SLEquipmentStateData> {
  let address = config.host;
  let port = config.port;
  let name = config.systemName;
  if (!address) {
    const finder = new FindUnits();
    let discoveryError: Error | null = null;
    finder.on('error', (error: Error) => { discoveryError = error; });
    try {
      const units = await timed(finder.searchAsync(config.discoveryMs), config.discoveryMs + 2_000, 'discovery');
      if (discoveryError) throw discoveryError;
      const unit = units.find(candidate => candidate.port > 0);
      if (!unit) throw new Error('No ScreenLogic adapter found');
      address = unit.address;
      port = unit.port;
      name ||= unit.gatewayName.trim();
    } finally {
      finder.close();
    }
  }

  const client = new UnitConnection();
  client.netTimeout = config.requestTimeoutMs;
  client.init(name, address, port!, config.password);
  try {
    await timed(client.connectAsync(), config.requestTimeoutMs * 2, 'connection');
    return await timed(client.equipment.getEquipmentStateAsync(), config.requestTimeoutMs * 2, 'equipment state');
  } finally {
    await client.closeAsync();
  }
}
