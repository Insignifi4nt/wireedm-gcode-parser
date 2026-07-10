import type { ConnectedWorkbench } from '@/domain/storage/workbenchStorage';

interface DashboardHeaderProps {
  connectedWorkbench: ConnectedWorkbench | null;
  workbenchStatus: 'initializing' | 'ready' | 'connecting-storage' | 'error';
}

export function DashboardHeader({
  connectedWorkbench,
  workbenchStatus
}: DashboardHeaderProps) {
  const isPreparing = workbenchStatus === 'initializing';
  const storageLabel = getStorageLabel(connectedWorkbench, isPreparing);

  return (
    <section className="border-b border-border bg-background/80 p-4">
      <div>
        <p className="font-mono text-[10px] uppercase text-muted-foreground">Workbench</p>
        <h2 className="mt-1 font-mono text-base font-semibold">{storageLabel}</h2>
      </div>
    </section>
  );
}

function getStorageLabel(connectedWorkbench: ConnectedWorkbench | null, isPreparing: boolean) {
  if (isPreparing) return 'Preparing local storage workbench';
  if (!connectedWorkbench) return 'Storage not connected';
  if (connectedWorkbench.adapter.kind === 'directory') return 'Workbench folder active';
  if (connectedWorkbench.adapter.kind === 'memory') return 'Temporary storage workbench active';
  return 'Browser cache workbench active';
}
