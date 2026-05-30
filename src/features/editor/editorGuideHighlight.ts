import type { EditorGuideTarget } from './editorGuideContent';

export function guideTargetProps(target: EditorGuideTarget, activeTarget: EditorGuideTarget | null) {
  return {
    'data-guide-highlighted': activeTarget === target ? 'true' : undefined,
    'data-guide-target': target
  };
}

export function guideHighlightClass(
  target: EditorGuideTarget,
  activeTarget: EditorGuideTarget | null
) {
  return activeTarget === target
    ? 'relative z-40 ring-2 ring-red-400 ring-offset-2 ring-offset-background'
    : '';
}
