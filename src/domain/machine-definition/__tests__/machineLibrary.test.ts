import { describe, expect, it } from 'vitest';

import {
  createEmptyMachineLibrary,
  installMachineDefinition,
  machineBindingReferences
} from '../machineLibrary';
import { boundMachineFixture, machineDefinitionFixture } from './machineDefinitionFixture';

describe('machine definition library', () => {
  it('installs exact definitions idempotently and rejects same-ID replacement', async () => {
    const first = await installMachineDefinition(createEmptyMachineLibrary(), machineDefinitionFixture());
    if (!first.ok) throw new Error(first.error.message);
    const repeated = await installMachineDefinition(first.library, machineDefinitionFixture());

    expect(repeated).toMatchObject({ ok: true, kind: 'already-installed' });
    expect(repeated.ok && repeated.library.machines).toHaveLength(1);
    expect(await installMachineDefinition(first.library, machineDefinitionFixture('Different machine'))).toMatchObject({
      ok: false,
      error: { code: 'MACHINE_LIBRARY_ID_CONFLICT', machineId: 'shop.robofil-100' }
    });
  });

  it('produces the complete post-reference index from persisted machines', async () => {
    const bound = await boundMachineFixture();
    const installed = await installMachineDefinition(createEmptyMachineLibrary(), bound.machine);
    if (!installed.ok) throw new Error(installed.error.message);

    expect(machineBindingReferences(installed.library)).toEqual([{
      machineId: 'shop.robofil-100',
      bindingId: 'production',
      post: bound.machine.bindings[0].post
    }]);
  });
});
