import { CircularPatternIcon, LinearPatternIcon, PatternIcon } from '@wire-edm/icons-react';
import type { CadFeature } from '@/domain/cad/cadDocument';
import { CadToolbarMenu } from './CadToolbarMenu';

type PatternKind = Extract<CadFeature['kind'], 'linear-pattern' | 'circular-pattern'>;

export function CadPatternCommand({ disabled, onChoose, context = 'body' }: { disabled: boolean; context?: 'sketch' | 'body'; onChoose(kind: PatternKind): void }) {
  return <CadToolbarMenu label="Pattern" menuLabel="Pattern commands" icon={<PatternIcon size={15} strokeWidth={1.5} />} disabled={disabled} items={[
    { key: 'linear-pattern', label: 'Linear pattern', icon: <LinearPatternIcon size={14} />, onSelect: () => onChoose('linear-pattern') },
    ...context === 'body' ? [{ key: 'circular-pattern', label: 'Circular pattern', icon: <CircularPatternIcon size={14} />, onSelect: () => onChoose('circular-pattern') }] : []
  ]} />;
}
