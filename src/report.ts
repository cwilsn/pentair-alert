import {
  EquipmentConfigurationMessage,
  type SLControllerConfigData,
  type SLEquipmentConfigurationData,
  type SLEquipmentStateData,
  type SLIntellichlorData,
  type SLPumpStatusData,
} from 'node-screenlogic';

export interface Adapter {
  address: string;
  port: number;
  gatewayName: string | null;
  gatewayType: number | null;
  gatewaySubtype: number | null;
  discoveryType: number | null;
  source: 'discovery' | 'manual';
}

export interface PumpReading {
  requestedId: number;
  configuration: SLEquipmentConfigurationData['pumps'][number] | null;
  status: SLPumpStatusData | null;
}

export interface RawReadings {
  version: unknown | null;
  controllerConfig: SLControllerConfigData | null;
  equipmentConfig: SLEquipmentConfigurationData | null;
  equipmentState: SLEquipmentStateData | null;
  systemTime: unknown | null;
  circuitNames: unknown | null;
  circuitDefinitions: unknown | null;
  customNames: unknown | null;
  chlorinator: SLIntellichlorData | null;
  chemistry: unknown | null;
  recurringSchedules: unknown | null;
  runOnceSchedules: unknown | null;
  pumps: PumpReading[];
}

export interface DiagnosticReport {
  capturedAt: string;
  connected: boolean;
  adapter: Adapter | null;
  discoveredAdapters: Adapter[];
  summary: ReturnType<typeof summarize> | null;
  raw: RawReadings;
  readErrors: Record<string, string>;
  limitations: string[];
}

export function emptyReadings(): RawReadings {
  return {
    version: null,
    controllerConfig: null,
    equipmentConfig: null,
    equipmentState: null,
    systemTime: null,
    circuitNames: null,
    circuitDefinitions: null,
    customNames: null,
    chlorinator: null,
    chemistry: null,
    recurringSchedules: null,
    runOnceSchedules: null,
    pumps: [],
  };
}

export function summarize(raw: RawReadings) {
  const controller = raw.controllerConfig;
  const equipment = raw.equipmentConfig;
  const state = raw.equipmentState;
  const chlor = raw.chlorinator;
  const type = controller?.controllerType ?? equipment?.controllerType;
  const hwType = controller?.hwType ?? equipment?.hardwareType;
  const controllerType = type === undefined ? null
    : EquipmentConfigurationMessage.isEasyTouch(type) ? 'EasyTouch'
    : EquipmentConfigurationMessage.isIntelliTouch(type) ? 'IntelliTouch'
    : 'Unknown';
  const names = new Map(controller?.circuitArray?.map(c => [c.circuitId, c.name]) ?? []);
  const configuredPumpCount = equipment ? Math.max(equipment.numPumps ?? 0, equipment.pumps?.length ?? 0) : undefined;
  const pumpPresenceFlags = controller?.equipment
    ? Array.from({ length: 8 }, (_, index) => controller.equipment[`POOL_IFLOWPRESENT${index}` as keyof typeof controller.equipment])
    : null;
  const noPumpConfigured = configuredPumpCount === 0 && (pumpPresenceFlags === null || pumpPresenceFlags.every(flag => flag === false));

  return {
    controller: {
      type: controllerType,
      rawType: type ?? null,
      rawHardwareType: hwType ?? null,
      version: (raw.version as { version?: string } | null)?.version ?? null,
      panelModeRaw: state?.panelMode ?? null,
      alarmCount: state?.alarms ?? null,
      temperatureUnit: controller ? (controller.degC ? 'C' : 'F') : null,
    },
    temperatures: {
      air: state?.airTemp ?? null,
      bodies: state?.bodies?.map(body => ({
        id: body.id,
        current: body.currentTemp,
        heatSetPoint: body.setPoint,
        coolSetPoint: body.coolSetPoint,
        heatModeRaw: body.heatMode,
        heatStatusRaw: body.heatStatus,
      })) ?? [],
    },
    pumpTelemetry: raw.pumps.some(pump => pump.status && pump.status.pumpType !== 0) ? 'available'
      : noPumpConfigured ? 'not-configured'
      : raw.pumps.some(pump => pump.status) ? 'not-exposed' : 'unknown',
    pumps: raw.pumps.filter(pump => pump.configuration || (pump.status && pump.status.pumpType !== 0)).map(pump => ({
      id: pump.requestedId,
      name: pump.configuration?.name ?? null,
      running: pump.status?.isRunning ?? null,
      rpm: pump.status?.pumpRPMs ?? null,
      watts: pump.status?.pumpWatts ?? null,
      gpm: pump.status?.pumpGPMs ?? null,
      pumpTypeRaw: pump.status?.pumpType ?? pump.configuration?.type ?? null,
    })),
    chlorinator: {
      installed: chlor?.installed ?? controller?.equipment?.POOL_CHLORPRESENT ?? null,
      poolOutputPercent: chlor?.poolSetPoint ?? null,
      spaOutputPercent: chlor?.spaSetPoint ?? null,
      saltPpm: chlor?.salt ?? state?.saltPPM ?? null,
      statusRaw: chlor?.status ?? null,
      flagsRaw: chlor?.flags ?? null,
      superChlorTimerRaw: chlor?.superChlorTimer ?? null,
    },
    heaters: {
      configuration: equipment?.heaterConfig ?? null,
      bodies: state?.bodies?.map(body => ({ id: body.id, heatModeRaw: body.heatMode, heatStatusRaw: body.heatStatus })) ?? [],
    },
    circuits: state?.circuitArray?.map(circuit => ({
      id: circuit.id,
      name: names.get(circuit.id) ?? null,
      active: circuit.state === 1,
      stateRaw: circuit.state,
    })) ?? [],
    schedules: {
      recurring: (raw.recurringSchedules as { data?: unknown[] } | null)?.data ?? null,
      runOnce: (raw.runOnceSchedules as { data?: unknown[] } | null)?.data ?? null,
    },
    chemistry: controller?.equipment?.POOL_ICHEMPRESENT === false ? null : raw.chemistry,
    warnings: {
      controllerAlarmCount: state?.alarms ?? null,
      chlorinatorStatusRaw: chlor?.status ?? null,
      chlorinatorFlagsRaw: chlor?.flags ?? null,
    },
  };
}
