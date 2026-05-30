/**
 * Sanitize helpers
 * Extracted from GCodeDrawer private methods to keep behavior identical.
 */

/**
 * Sanitize arbitrary text input by stripping HTML and control characters.
 * Mirrors previous GCodeDrawer._sanitizeInput behavior.
 *
 * @param {string} input
 * @returns {string}
 */
export function sanitizeText(input) {
  if (!input || typeof input !== 'string') return '';

  // Create a temporary div to decode HTML entities and strip tags
  const tempDiv = document.createElement('div');
  tempDiv.textContent = input; // This automatically escapes HTML
  let sanitized = tempDiv.innerHTML; // Get the escaped version

  // Decode common HTML entities back to plain text
  const entityMap = {
    '&lt;': '<',
    '&gt;': '>',
    '&amp;': '&',
    '&quot;': '"',
    '&#x27;': "'",
    '&#x2F;': '/'
  };

  sanitized = sanitized.replace(/&(lt|gt|amp|quot|#x27|#x2F);/g, (match, entity) => {
    return entityMap[`&${entity};`] || match;
  });

  // Remove any remaining HTML-like content and control characters
  sanitized = sanitized
    .replace(/<[^>]*>/g, '') // Remove any HTML tags
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove control chars except tab, newline
    .trim();

  return sanitized;
}

/**
 * Sanitize a contentEditable element's textContent with caret preservation.
 * Mirrors previous GCodeDrawer._sanitizeContentEditableInput behavior.
 *
 * @param {HTMLElement} element
 */
export function sanitizeContentEditable(element) {
  if (!element) return;

  const originalText = element.textContent || '';
  const sanitized = sanitizeText(originalText);

  // Only update if content changed to avoid cursor jumping
  if (originalText !== sanitized) {
    const selection = window.getSelection();
    const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    const cursorOffset = range ? range.startOffset : 0;

    element.textContent = sanitized;

    // Restore cursor position if possible
    try {
      if (range && sanitized.length >= cursorOffset) {
        range.setStart(element.childNodes[0] || element, Math.min(cursorOffset, sanitized.length));
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    } catch (_e) {
      // Cursor restoration failed, not critical
    }
  }
}

