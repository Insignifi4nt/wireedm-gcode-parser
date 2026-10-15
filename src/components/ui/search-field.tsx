import { useEffect, useId, useRef, useState } from 'react';
import { Search } from '@wire-edm/icons-react';
import { Button } from './button';
import { Input } from './input';
import './search-field.css';

interface SearchFieldProps {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
}

/** One controlled query; collapsed search never hides an active filter. */
export function SearchField({ label, value, onValueChange }: SearchFieldProps) {
  const [requestedOpen, setRequestedOpen] = useState(false);
  const expanded = requestedOpen || value.length > 0;
  const field = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => { if (requestedOpen) field.current?.focus(); }, [requestedOpen]);

  return <div className="ui-search" data-expanded={expanded} onBlur={event => {
    if (!value && !(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) setRequestedOpen(false);
  }}>
    <Input ref={field} id={id} type="search" aria-label={label} placeholder={label} value={value}
      aria-hidden={!expanded} tabIndex={expanded ? 0 : -1} className="ui-search-input"
      onChange={event => onValueChange(event.currentTarget.value)} onKeyDown={event => {
        if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
          event.preventDefault(); event.stopPropagation(); onValueChange(''); setRequestedOpen(false); trigger.current?.focus();
        }
      }} />
    <Button ref={trigger} type="button" size="icon" className="ui-search-trigger" aria-label={label}
      aria-expanded={expanded} aria-controls={id} title={label} onClick={() => { setRequestedOpen(true); field.current?.focus(); }}>
      <Search aria-hidden="true" />
    </Button>
  </div>;
}
