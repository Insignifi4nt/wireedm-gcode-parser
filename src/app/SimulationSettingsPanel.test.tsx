import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createBlankMachineProfile,
  createVerifiedCharmillesRobofil100Profile,
  machineProfileVerificationFingerprint
} from '@/domain/machine/machineProfiles';
import type { WorkbenchSimulationSettings } from '@/domain/simulation/simulationConfig';
import { updateWorkbenchSimulationSettings } from '@/domain/storage/updateSimulationSettings';
import type {
  ConnectedWorkbench,
  WorkbenchStorageAdapter
} from '@/domain/storage/workbenchStorage';

import {
  cleanupAppTestContext,
  createAppTestContext,
  flushAsync,
  renderApp,
  setInputValue,
  setSelectValue,
  type AppTestContext
} from '../__tests__/appTestHelpers';

describe('3D simulation settings', () => {
  let context: AppTestContext;

  beforeEach(() => {
    context = createAppTestContext();
    window.showDirectoryPicker = undefined;
  });

  afterEach(() => cleanupAppTestContext(context));

  it('persists machine-specific visual values without changing export machine verification', async () => {
    const workbench = createWorkbench();
    const activeMachineId = workbench.activeMachineProfile.id;
    const verificationBefore = structuredClone(
      workbench.activeMachineProfile.controller.verification
    );
    const fingerprintBefore = machineProfileVerificationFingerprint(
      workbench.activeMachineProfile
    );
    const updateSimulation = vi.fn(updateWorkbenchSimulationSettings);

    await renderApp(context, {
      connectCachedWorkbench: async () => workbench,
      updateWorkbenchSimulationSettings: updateSimulation
    });
    await openSimulationSettings(context.container);

    const profileSelect = requireSelect(context.container, 'Simulation machine profile');
    expect([...profileSelect.options].map(({ value }) => value)).toEqual([
      activeMachineId,
      'secondary-machine'
    ]);

    const upperGuide = requireInput(context.container, 'Upper guide Z');
    await act(async () => setInputValue(upperGuide, '42'));
    await act(async () => setSelectValue(profileSelect, 'secondary-machine'));

    expect(requireInput(context.container, 'Upper guide Z').value).toBe('18');
    const wireDiameter = requireInput(context.container, 'Default wire diameter');
    await act(async () => setInputValue(wireDiameter, '0.18'));
    await act(async () => {
      setSelectValue(requireSelect(context.container, 'Simulation rendering quality'), 'quality');
    });
    await act(async () => {
      context.container
        .querySelector<HTMLButtonElement>('button[aria-label="Save 3D simulation settings"]')
        ?.click();
    });
    await flushAsync();

    expect(updateSimulation).toHaveBeenCalledTimes(1);
    const [savedWorkbench, savedSettings] = updateSimulation.mock.calls[0] as [
      ConnectedWorkbench,
      WorkbenchSimulationSettings
    ];
    expect(savedSettings).toMatchObject({
      renderingQuality: 'quality',
      machines: {
        [activeMachineId]: { upperGuideZMm: 42 },
        'secondary-machine': { defaultWireDiameterMm: 0.18 }
      }
    });
    expect(savedWorkbench.activeMachineProfile.id).toBe(activeMachineId);
    expect(savedWorkbench.manifest.activeMachineProfileId).toBe(activeMachineId);
    expect(savedWorkbench.activeMachineProfile.controller.verification).toEqual(
      verificationBefore
    );
    expect(machineProfileVerificationFingerprint(savedWorkbench.activeMachineProfile)).toBe(
      fingerprintBefore
    );

    await act(async () => setSelectValue(profileSelect, activeMachineId));
    expect(requireInput(context.container, 'Upper guide Z').value).toBe('42');
    expect(workbench.activeMachineProfile.controller.verification).toEqual(verificationBefore);
  });
});

async function openSimulationSettings(container: HTMLDivElement) {
  await act(async () => {
    container.querySelector<HTMLButtonElement>('button[aria-label="Open settings"]')?.click();
  });
  await act(async () => {
    container
      .querySelector<HTMLButtonElement>('button[aria-label="3D Simulation settings"]')
      ?.click();
  });
}

function requireInput(container: HTMLElement, label: string) {
  const input = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  expect(input, `${label} input`).not.toBeNull();
  return input!;
}

function requireSelect(container: HTMLElement, label: string) {
  const select = container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);
  expect(select, `${label} select`).not.toBeNull();
  return select!;
}

function createWorkbench(): ConnectedWorkbench {
  const activeMachineProfile = createVerifiedCharmillesRobofil100Profile(
    'verified-export-machine',
    new Date('2026-07-15T10:00:00.000Z')
  );
  const secondary = createBlankMachineProfile('secondary-machine');
  const adapter: WorkbenchStorageAdapter = {
    name: 'Simulation settings test',
    kind: 'memory',
    ensureDirectory: async () => undefined,
    readText: async () => null,
    deleteText: async () => undefined,
    writeText: async () => undefined
  };

  return {
    adapter,
    manifest: {
      schemaVersion: 1,
      name: 'Simulation settings test',
      createdAt: '2026-07-15T10:00:00.000Z',
      updatedAt: '2026-07-15T10:00:00.000Z',
      templates: {
        headerPath: 'templates/header.gcode',
        footerPath: 'templates/footer.gcode'
      },
      output: activeMachineProfile.output,
      activeMachineProfileId: activeMachineProfile.id,
      machineProfiles: [activeMachineProfile, secondary],
      simulation: {
        schemaVersion: 1,
        renderingQuality: 'balanced',
        machines: {
          [activeMachineProfile.id]: {
            upperGuideZMm: 25,
            lowerGuideZMm: -25,
            tankDepthMm: 80,
            defaultWireDiameterMm: 0.25,
            fixtureClearanceMm: 10
          },
          [secondary.id]: {
            upperGuideZMm: 18,
            lowerGuideZMm: -20,
            tankDepthMm: 70,
            defaultWireDiameterMm: 0.2,
            fixtureClearanceMm: 8
          }
        }
      },
      projects: []
    },
    activeMachineProfile,
    header: activeMachineProfile.templates.header,
    footer: activeMachineProfile.templates.footer
  };
}
