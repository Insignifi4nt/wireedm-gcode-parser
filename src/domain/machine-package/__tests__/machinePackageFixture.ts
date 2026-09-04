import {
  createMachinePostBinding,
  parseMachineDefinition
} from '@/domain/machine-definition/machineDefinition';
import { machineDefinitionValue } from '@/domain/machine-definition/__tests__/machineDefinitionFixture';
import { minimalPostPackage } from '@/domain/post-processor/__tests__/postPackageFixture';
import { createEmptyPostLibrary, installPostPackage } from '@/domain/post-processor/postLibrary';
import { parseWireEdmPostPackage } from '@/domain/post-processor/postPackage';

import type {
  MachinePackageArchiveInput,
  MachinePackageDocumentValue
} from '../machinePackage';

export async function machinePackageFixture(
  options: {
    readonly packageVersion?: string;
    readonly postVersion?: string;
    readonly bindingId?: string;
    readonly machineId?: string;
    readonly controllerModel?: string;
    readonly firmware?: string;
  } = {}
): Promise<MachinePackageArchiveInput> {
  const evidenceText = 'Verified local Robofil controller program.\n';
  const evidenceBytes = new TextEncoder().encode(evidenceText);
  const postValue = minimalPostPackage();
  postValue.manifest.version = options.postVersion ?? '1.0.0';
  postValue.manifest.targets[0].controller = options.controllerModel ?? 'Robofil Classic';
  postValue.manifest.targets[0].firmware = {
    status: 'known',
    versions: [options.firmware ?? 'Local verified configuration']
  };
  postValue.evidence[0].appliesTo.controllerModels = [options.controllerModel ?? 'Robofil Classic'];
  postValue.evidence[0].appliesTo.firmware = options.firmware ?? 'Local verified configuration';
  postValue.sources[0].contentSha256 = await sha256(evidenceBytes);
  const parsedPost = parseWireEdmPostPackage(JSON.stringify(postValue));
  if (!parsedPost.ok) throw new Error(JSON.stringify(parsedPost.diagnostics));
  const installed = await installPostPackage(createEmptyPostLibrary(), parsedPost.package);
  if (!installed.ok) throw new Error(installed.error.message);

  const machineValue = machineDefinitionValue();
  machineValue.id = options.machineId ?? machineValue.id;
  machineValue.identity.controller.model = options.controllerModel ?? machineValue.identity.controller.model;
  machineValue.identity.controller.firmware = options.firmware ?? machineValue.identity.controller.firmware;
  const parsedMachine = parseMachineDefinition(JSON.stringify(machineValue));
  if (!parsedMachine.ok) throw new Error(JSON.stringify(parsedMachine.diagnostics));
  const bindingId = options.bindingId ?? 'production';
  const bound = createMachinePostBinding(parsedMachine.machine, installed.installation, {
    id: bindingId,
    name: `Production ${postValue.manifest.version}`,
    properties: { coordinatePrecision: 3 },
    compatibility: {
      status: 'acknowledged',
      acknowledgedAt: '2026-09-04T00:00:00.000Z',
      acknowledgedBy: 'Machine package fixture',
      notes: 'Fixture machine and post reviewed together.'
    }
  });
  if (!bound.ok) throw new Error(bound.error.message);

  const document: MachinePackageDocumentValue = {
    format: 'wire-edm-machine-package',
    schemaVersion: 1,
    manifest: {
      id: 'shop.robofil-100.package',
      name: 'Shop Robofil 100 package',
      version: options.packageVersion ?? '1.0.0',
      description: 'Complete deterministic test package.'
    },
    machine: bound.machine,
    posts: [parsedPost.package],
    activeBindingId: bindingId
  };
  return {
    document,
    files: {
      'evidence/local-robofil-100-program.iso': evidenceBytes
    }
  };
}

async function sha256(value: Uint8Array) {
  const copied = new Uint8Array(value.byteLength);
  copied.set(value);
  const digest = await crypto.subtle.digest('SHA-256', copied.buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
