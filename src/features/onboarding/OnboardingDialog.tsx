import { useRef, type MouseEvent } from 'react';
import { X } from 'lucide-react';

import onboardingPoster from '@/assets/wire-edm-onboarding-poster.png';
import { Button } from '@/components/ui/button';
import { useModalFocus } from '@/components/ui/useModalFocus';

interface OnboardingDialogProps {
  open: boolean;
  onDismiss: () => void;
}

export function OnboardingDialog({ open, onDismiss }: OnboardingDialogProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  useModalFocus({ open, overlayRef, dialogRef, initialFocusRef: closeButtonRef, onClose: onDismiss });

  if (!open) return null;

  function handleBackdropClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) onDismiss();
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-3 backdrop-blur-[2px] sm:p-6"
      data-onboarding-backdrop
      onClick={handleBackdropClick}
      ref={overlayRef}
    >
      <section
        aria-describedby="onboarding-description"
        aria-labelledby="onboarding-title"
        aria-modal="true"
        className="relative flex max-h-[calc(100dvh-1.5rem)] w-full max-w-3xl flex-col overflow-hidden rounded-[3px] border border-cyan-300/30 bg-[#0d1418] shadow-[0_24px_90px_rgba(0,0,0,0.75),0_0_45px_rgba(34,211,238,0.08)] outline-none sm:max-h-[calc(100dvh-3rem)]"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <Button
          aria-label="Close onboarding"
          className="absolute right-2 top-2 z-10 border-white/20 bg-black/65 text-white shadow-lg hover:bg-black/90"
          onClick={onDismiss}
          ref={closeButtonRef}
          size="icon"
          type="button"
          variant="outline"
        >
          <X />
        </Button>

        <div className="min-h-0 overflow-hidden border-b border-border bg-black">
          <img
            alt="Wire EDM Workbench surrounded by intricate finished precision parts"
            className="block aspect-[16/9] h-auto max-h-[55dvh] w-full object-cover"
            src={onboardingPoster}
          />
        </div>

        <div className="flex shrink-0 flex-col gap-4 p-4 sm:p-5">
          <div>
            <p className="technical-value mb-1 text-[10px] uppercase tracking-[0.22em] text-cyan-300">
              Your workbench is ready
            </p>
            <h2 className="text-base font-semibold text-foreground sm:text-lg" id="onboarding-title">
              Thanks for trying Wire EDM Workbench
            </h2>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground" id="onboarding-description">
              Import geometry, review the cut plan, and export locally with your installed machine package.
            </p>
          </div>
          <Button className="w-full" onClick={onDismiss} type="button">
            Go Build!
          </Button>
        </div>
      </section>
    </div>
  );
}
