import { useState } from 'react';
import illustration from '@/assets/cad-cam-design-to-part.png';
import { Skeleton } from '@/components/ui/skeleton';
import './WorkbenchEmptyState.css';

/** Illustrated empty content, without an overlay, focus owner or storage preference. */
export function WorkbenchEmptyState({ context }: { context: 'library' | 'preview' }) {
  const [imageState, setImageState] = useState<'loading' | 'ready' | 'failed'>('loading');
  return <div className="workbench-empty" data-workbench-empty={context}>
    <div className="workbench-empty-art-slot" data-image-state={imageState} aria-busy={imageState === 'loading'}>
      {imageState === 'loading' && <Skeleton className="workbench-empty-art-skeleton" data-empty-image-skeleton />}
      <img className="workbench-empty-art" src={illustration} width={1659} height={948}
        alt="A CAD wireframe becoming a machined part" onLoad={() => setImageState('ready')} onError={() => setImageState('failed')} />
    </div>
    <div className="workbench-empty-copy">
      <h3>{context === 'library' ? 'No saved projects yet' : 'No drawable toolpath loaded'}</h3>
      <p>{context === 'library' ? 'Design in CAD, import DXF geometry for CAM or open a machine program using Start work.'
        : 'Open a saved project or import geometry from the dashboard to begin.'}</p>
    </div>
  </div>;
}
