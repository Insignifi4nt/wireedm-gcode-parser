import { createEmptyPostLibrary, installPostPackage } from '@/domain/post-processor/postLibrary';
import { parseWireEdmPostPackage } from '@/domain/post-processor/postPackage';
import { minimalPostPackage } from '@/domain/post-processor/__tests__/postPackageFixture';

import {
  createMachinePostBinding,
  parseMachineDefinition,
  type MachineDefinitionValue
} from '../machineDefinition';

export function machineDefinitionValue(name = 'Shop Robofil 100'): MachineDefinitionValue {
  return {
    format: 'wire-edm-machine',
    schemaVersion: 1,
    id: 'shop.robofil-100',
    name,
    identity: {
      manufacturer: 'Charmilles',
      model: 'Robofil 100',
      serialNumber: 'R100-42',
      controller: {
        manufacturer: 'Charmilles',
        model: 'Robofil Classic',
        firmware: 'Local verified configuration'
      }
    },
    limits: {
      xTravel: { status: 'known', millimeters: 220 },
      yTravel: { status: 'unknown' }
    },
    hardware: { manualThreading: true, automaticThreading: false },
    evidence: [],
    bindings: [],
    notes: 'Physical facts only.'
  };
}

export function machineDefinitionFixture(name?: string) {
  const parsed = parseMachineDefinition(JSON.stringify(machineDefinitionValue(name)));
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return parsed.machine;
}

export function compatibilityFixture() {
  return {
    status: 'acknowledged' as const,
    acknowledgedAt: '2026-08-28T12:00:00.000Z',
    acknowledgedBy: 'Cristian',
    notes: 'Controller and machine target checked against the local manual.'
  };
}

export async function postInstallationFixture(version = '1.0.0') {
  const rawPackage = minimalPostPackage();
  rawPackage.manifest.version = version;
  const parsed = parseWireEdmPostPackage(JSON.stringify(rawPackage));
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  const installed = await installPostPackage(createEmptyPostLibrary(), parsed.package);
  if (!installed.ok) throw new Error(installed.error.message);
  return installed.installation;
}

export async function boundMachineFixture(version = '1.0.0') {
  const installation = await postInstallationFixture(version);
  const bound = createMachinePostBinding(machineDefinitionFixture(), installation, {
    id: 'production',
    name: 'Production',
    properties: { coordinatePrecision: 3 },
    compatibility: compatibilityFixture()
  });
  if (!bound.ok) throw new Error(bound.error.message);
  return { machine: bound.machine, installation };
}
