import { useRef, useState } from 'react';
import { FileUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { readGCodeInspectionFile, validateGCodeInspectionSource } from '@/domain/editor/gcodeInspectionSource';

export function GCodeInspectionInput({ onInspect }: {
  onInspect: (source: { text: string; fileName: string }) => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  function inspect(contents: string, fileName: string) {
    const problem = validateGCodeInspectionSource(contents);
    setError(problem);
    if (!problem) onInspect({ text: contents, fileName });
  }

  return (
    <div className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-3 overflow-hidden p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={reading} variant="outline" onClick={() => fileInput.current?.click()}>
          <FileUp />{reading ? 'Reading file…' : 'Choose G-code file'}
        </Button>
        <input ref={fileInput} className="hidden" type="file" aria-label="G-code inspection file"
          accept=".gcode,.nc,.iso,.txt,.tap,.cnc,.mpf,text/plain" disabled={reading}
          onChange={async (event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (!file) return;
            setReading(true);
            setError(null);
            try { inspect(await readGCodeInspectionFile(file), file.name); }
            catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not read this file. Choose it again or paste its text.'); }
            finally { setReading(false); }
          }} />
        <p className="text-xs text-muted-foreground">Open a text file or paste code. No project, machine setup, or folder access required.</p>
      </div>
      <label className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-2 text-xs">
        G-code to inspect
        <textarea className="gcode-text-input min-h-0 min-w-0 resize-none overflow-auto border border-border bg-background p-3 outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={text} onChange={(event) => setText(event.currentTarget.value)} spellCheck={false}
          placeholder="Paste the controller program here…" disabled={reading} />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={reading || !text.trim()} onClick={() => inspect(text, 'Pasted program')}>Inspect pasted code</Button>
        <span className="text-[11px] text-muted-foreground">Text stays in this inspection session. Up to 2 MiB / 50,000 lines.</span>
        {error && <p className="w-full text-xs text-destructive" role="alert">{error}</p>}
      </div>
    </div>
  );
}
