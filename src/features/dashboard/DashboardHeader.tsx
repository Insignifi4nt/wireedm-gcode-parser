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
    <section className="border-b border-border bg-background/80 px-4 py-3">
      <h1 className="font-mono text-base font-semibold">Workbench</h1>
      <p className="mt-1 font-mono text-[10px] text-muted-foreground">{storageLabel}</p>
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
