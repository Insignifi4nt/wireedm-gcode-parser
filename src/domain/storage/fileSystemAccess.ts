export function supportsWorkbenchDirectoryAccess(win: Pick<Window, 'showDirectoryPicker'> = window) {
  return typeof win.showDirectoryPicker === 'function';
}

export async function requestWorkbenchDirectory(
  win: Pick<Window, 'showDirectoryPicker'> = window
) {
  if (!supportsWorkbenchDirectoryAccess(win) || !win.showDirectoryPicker) {
    throw new Error('This browser does not support workbench folder access.');
  }

  return win.showDirectoryPicker({
    id: 'wire-edm-workbench',
    mode: 'readwrite'
  });
}
