import type { MachineDefinition } from '@/domain/machine-definition/machineDefinition';
import type { PhysicalMachineFitResult } from '@/domain/machine-definition/machineFit';

export function EditorPlanningMachineSummary({ machine, result }: {
  machine: MachineDefinition | null;
  result: PhysicalMachineFitResult | null;
}) {
  const status = result?.ok ? result.fit.status : result ? 'invalid' : 'not-evaluated';
  return (
    <div className="grid gap-2">
      <dl className="grid grid-cols-[78px_minmax(0,1fr)] gap-y-1.5">
        <dt className="text-muted-foreground">Planning ref.</dt>
        <dd className="truncate" data-editor-machine="definition" title={machine?.name}>
          {machine?.name ?? 'Not selected'}
        </dd>
        {result?.ok && <>
          <dt className="text-muted-foreground">Source span</dt>
          <dd>{result.fit.bounds.xSpanMm.toFixed(3)} × {result.fit.bounds.ySpanMm.toFixed(3)} mm</dd>
        </>}
      </dl>
      <p className={status === 'fits' || status === 'not-evaluated' ? 'text-muted-foreground' : 'text-amber-200'}
        data-editor-machine-fit={status}>
        {fitMessage(result)}
      </p>
      <p className="text-muted-foreground">
        This compares source spans only. Controller export checks planned cutting and positioning
        against the machine selected there.
      </p>
    </div>
  );
}

function fitMessage(result: PhysicalMachineFitResult | null): string {
  if (!result) {
    return 'Choose a default planning machine in Workbench Settings to compare source spans.';
  }
  if (!result.ok) return result.error.message;
  switch (result.fit.status) {
    case 'not-evaluated': return 'Choose a default planning machine in Workbench Settings to compare source spans.';
    case 'fits': return 'Source spans are within the known X/Y travel.';
    case 'indeterminate': return `Source fit is unconfirmed. Unknown travel: ${result.fit.unknownAxes.map((axis) => axis.toUpperCase()).join(', ')}.`;
    case 'too-large': return `Source exceeds travel: ${result.fit.issues.map((issue) => `${issue.axis.toUpperCase()} ${issue.actualMm.toFixed(3)} > ${issue.limitMm.toFixed(3)} mm`).join('; ')}.`;
    default: {
      const exhaustive: never = result.fit;
      return exhaustive;
    }
  }
}
