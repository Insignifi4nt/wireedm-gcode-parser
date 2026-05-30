/**
 * NotificationStyles
 * Style helpers and HTML utilities for notifications.
 */

export function applyContainerStyles(containerEl, position, STATUS, ANIMATION) {
  const styles = {
    position: 'fixed',
    zIndex: '1000',
    pointerEvents: 'none',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    maxWidth: '400px',
    fontFamily: 'Arial, sans-serif',
    fontSize: '14px'
  };
  switch (position) {
    case 'top-right':
      styles.top = STATUS.POSITION.TOP;
      styles.right = STATUS.POSITION.RIGHT;
      styles.alignItems = 'flex-end';
      break;
    case 'top-left':
      styles.top = STATUS.POSITION.TOP;
      styles.left = STATUS.POSITION.LEFT;
      styles.alignItems = 'flex-start';
      break;
    case 'bottom-right':
      styles.bottom = STATUS.POSITION.BOTTOM;
      styles.right = STATUS.POSITION.RIGHT;
      styles.alignItems = 'flex-end';
      styles.flexDirection = 'column-reverse';
      break;
    case 'bottom-left':
      styles.bottom = STATUS.POSITION.BOTTOM;
      styles.left = STATUS.POSITION.LEFT;
      styles.alignItems = 'flex-start';
      styles.flexDirection = 'column-reverse';
      break;
  }
  Object.assign(containerEl.style, styles);
}

export function applyMessageStyles(element, type, STATUS, ANIMATION) {
  const baseStyles = {
    display: 'flex',
    alignItems: 'center',
    padding: '15px 20px',
    borderRadius: '5px',
    color: 'white',
    cursor: 'pointer',
    pointerEvents: 'auto',
    boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
    transition: `all ${ANIMATION.NORMAL}ms ${ANIMATION.EASE}`,
    transform: 'translateX(100%)',
    opacity: '0',
    marginBottom: '10px',
    maxWidth: '100%',
    wordWrap: 'break-word',
    position: 'relative'
  };
  const typeColors = {
    success: STATUS.COLORS.SUCCESS,
    error: STATUS.COLORS.ERROR,
    warning: STATUS.COLORS.WARNING,
    info: STATUS.COLORS.INFO
  };
  baseStyles.backgroundColor = typeColors[type] || STATUS.COLORS.INFO;
  Object.assign(element.style, baseStyles);
}

export function buildMessageContent(messageData, escapeHtml) {
  let html = `
    <div class="status-message-content">
      <div class="status-message-text">${escapeHtml(messageData.message)}</div>
  `;
  if (messageData.progress !== null) {
    html += `
      <div class="status-message-progress">
        <div class="status-message-progress-bar" style="width: ${messageData.progress}%"></div>
      </div>
    `;
  }
  if (messageData.persistent) {
    html += `
      <button class="status-message-dismiss" type="button" aria-label="Dismiss">×</button>
    `;
  }
  html += '</div>';
  return html;
}

export function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

