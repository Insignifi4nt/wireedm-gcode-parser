import { useState } from 'react';

/** Copy is explicit and local; a selectable fallback also works without Clipboard API permission. */
export function AgentRepairPrompt({ prompt }: { prompt: string }) {
  const [copiedPrompt, setCopiedPrompt] = useState<string | null>(null);
  const [failedPrompt, setFailedPrompt] = useState<string | null>(null);
  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopiedPrompt(prompt);
      setFailedPrompt(null);
    } catch {
      setFailedPrompt(prompt);
      setCopiedPrompt(null);
    }
  }
  return (
    <div className="mt-2 grid gap-2 text-foreground">
      <button className="h-7 w-fit border border-border px-2" onClick={() => void copy()} type="button">Copy agent repair prompt</button>
      <span aria-live="polite">{copiedPrompt === prompt ? 'Copied.' : failedPrompt === prompt ? 'Clipboard unavailable. Select and copy the prompt below.' : ''}</span>
      <details open={failedPrompt === prompt || undefined}>
        <summary className="cursor-pointer text-muted-foreground">Review repair prompt</summary>
        <textarea aria-label="Agent repair prompt" className="mt-2 h-48 w-full border border-border bg-background p-2 font-mono text-[11px]" onFocus={(event) => event.currentTarget.select()} readOnly value={prompt} />
      </details>
    </div>
  );
}
