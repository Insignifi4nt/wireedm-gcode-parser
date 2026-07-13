import { machineProfileHasCurrentVerification } from '@/domain/machine/machineProfiles';
import type { MachineProfile } from '@/domain/workbench/types';

export function verifiedRobofilPostEnvelopeIsReady(machine: MachineProfile) {
  return (
    machineProfileHasCurrentVerification(machine) &&
    matchesVerifiedRobofilPostEnvelope(machine)
  );
}

export function matchesVerifiedRobofilPostEnvelope(machine: MachineProfile) {
  return (
    machine.controller.family === 'charmilles-robofil-classic' &&
    machine.controller.postVersion === 1 &&
    machine.controller.blockFormatting === 'spaced' &&
    machine.controller.coordinateSystem === 'wire-position-g92' &&
    machine.controller.unitsCode === 'omit' &&
    machine.controller.planeCode === 'omit' &&
    machine.controller.workOffsetCode === 'omit' &&
    machine.controller.distanceMode === 'G90' &&
    machine.controller.arcCenterMode === 'absolute' &&
    machine.controller.programEnd === 'M02' &&
    machine.compensation.supported &&
    machine.compensation.activation === 'charmilles-g38' &&
    machine.compensation.cancellation === 'program-end' &&
    machine.compensation.lifecycleScope === 'program' &&
    machine.compensation.offsetSelection.address === 'D' &&
    machine.compensation.offsetSelection.index === 0 &&
    machine.compensation.preActivationCodes.length === 1 &&
    machine.compensation.preActivationCodes[0] === 'G60' &&
    machine.output.coordinatePrecision === 3 &&
    machine.output.lineEnding === 'crlf'
  );
}
