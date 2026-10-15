import { Info } from '@wire-edm/icons-react';
import { Button } from './button';

/** Optional explanation beside a heading, without adding another text block. */
export function InfoTip({ label, content }: { label: string; content: string }) {
  return <Button type="button" size="icon" aria-label={label} title={content}>
    <Info aria-hidden="true" />
  </Button>;
}
