import { Crosshair, X } from 'lucide-react';

import { Button } from '@/components/ui/button';

import {
  EDITOR_GUIDE_LANGUAGES,
  getEditorGuideCopy,
  type EditorGuideLanguage,
  type EditorGuideTarget
} from './editorGuideContent';

interface EditorGuideDialogProps {
  language: EditorGuideLanguage;
  onClose: () => void;
  onHighlight: (target: EditorGuideTarget) => void;
  onLanguageChange: (language: EditorGuideLanguage) => void;
  open: boolean;
}

export function EditorGuideDialog({
  language,
  onClose,
  onHighlight,
  onLanguageChange,
  open
}: EditorGuideDialogProps) {
  if (!open) return null;

  const copy = getEditorGuideCopy(language);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4"
      data-editor-guide-overlay
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        aria-label={copy.title}
        aria-modal="true"
        className="grid max-h-[86vh] w-full max-w-4xl grid-rows-[auto_auto_minmax(0,1fr)] border border-border bg-card shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border p-4">
          <div>
            <h2 className="font-mono text-base font-semibold">{copy.title}</h2>
            <p className="mt-2 max-w-3xl font-mono text-[11px] leading-5 text-muted-foreground">
              {copy.overview}
            </p>
          </div>
          <button
            aria-label={copy.closeLabel}
            className="flex size-7 shrink-0 items-center justify-center border border-border text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>

        <div
          aria-label={copy.languageLabel}
          className="flex h-9 items-center gap-1 border-b border-border px-4"
        >
          {(Object.keys(EDITOR_GUIDE_LANGUAGES) as EditorGuideLanguage[]).map((key) => (
            <button
              aria-pressed={language === key}
              className={`h-6 border px-2 font-mono text-[10px] outline-none transition hover:bg-accent ${
                language === key ? 'border-primary text-primary' : 'border-border text-muted-foreground'
              }`}
              data-editor-guide-language={key}
              key={key}
              onClick={() => onLanguageChange(key)}
              type="button"
            >
              {EDITOR_GUIDE_LANGUAGES[key]}
            </button>
          ))}
        </div>

        <div className="min-h-0 overflow-auto p-4">
          <div className="grid gap-4">
            {copy.sections.map((section) => (
              <section className="border border-border bg-background/45" key={section.title}>
                <h3 className="border-b border-border px-3 py-2 font-mono text-xs font-semibold">
                  {section.title}
                </h3>
                <ol className="grid gap-2 p-3">
                  {section.steps.map((step, index) => (
                    <li
                      className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-start gap-2 font-mono text-[11px] leading-5"
                      key={`${section.title}-${step.text}`}
                    >
                      <span className="text-muted-foreground">{index + 1}.</span>
                      <span className="text-muted-foreground">
                        {step.text}
                        {step.mock && (
                          <span
                            className={`ml-2 inline-flex h-6 items-center border px-2 text-[10px] ${
                              step.mock.tone === 'danger'
                                ? 'border-red-500/60 text-red-300'
                                : step.mock.tone === 'primary'
                                  ? 'border-primary/60 text-primary'
                                  : 'border-border text-foreground'
                            }`}
                          >
                            {step.mock.label}
                          </span>
                        )}
                      </span>
                      {step.highlightTarget && (
                        <Button
                          data-editor-guide-highlight={step.highlightTarget}
                          onClick={() => onHighlight(step.highlightTarget!)}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          <Crosshair />
                          {copy.highlightLabel}
                        </Button>
                      )}
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
