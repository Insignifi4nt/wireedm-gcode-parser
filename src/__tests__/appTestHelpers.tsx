import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import App from '../App';
import type { AppServices } from '../app/appServices';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class FakeFileHandle {
  constructor(
    readonly name: string,
    private readonly getContents: () => string,
    private readonly setContents: (contents: string) => void
  ) {}

  async getFile() {
    return new File([this.getContents()], this.name);
  }

  async createWritable() {
    return {
      write: async (contents: string) => this.setContents(String(contents)),
      close: async () => undefined
    };
  }
}

export class FakeDirectoryHandle {
  readonly kind = 'directory';
  readonly directories = new Set<string>();
  readonly files = new Map<string, string>();

  constructor(
    readonly name: string,
    private readonly prefix = '',
    private readonly root?: FakeDirectoryHandle
  ) {}

  async getDirectoryHandle(name: string, options: { create?: boolean } = {}) {
    const root = this.root ?? this;
    const path = this.prefix ? `${this.prefix}/${name}` : name;

    if (!root.directories.has(path)) {
      if (!options.create) throw new DOMException('Not found', 'NotFoundError');
      root.directories.add(path);
    }

    return new FakeDirectoryHandle(name, path, root);
  }

  async getFileHandle(name: string, options: { create?: boolean } = {}) {
    const root = this.root ?? this;
    const path = this.prefix ? `${this.prefix}/${name}` : name;

    if (!root.files.has(path)) {
      if (!options.create) throw new DOMException('Not found', 'NotFoundError');
      root.files.set(path, '');
    }

    return new FakeFileHandle(
      name,
      () => root.files.get(path) || '',
      (contents) => root.files.set(path, contents)
    );
  }
}

export interface AppTestContext {
  container: HTMLDivElement;
  previousPicker: Window['showDirectoryPicker'];
  root: Root;
}

let autoOpenEditorWorkspacePanels = false;

export function enableAutoOpenEditorWorkspacePanels() {
  autoOpenEditorWorkspacePanels = true;
}

export function createAppTestContext(): AppTestContext {
  const container = document.createElement('div');
  document.body.appendChild(container);

  return {
    container,
    previousPicker: window.showDirectoryPicker,
    root: createRoot(container)
  };
}

export function cleanupAppTestContext(context: AppTestContext) {
  act(() => context.root.unmount());
  context.container.remove();
  window.showDirectoryPicker = context.previousPicker;
  window.localStorage.clear();
  autoOpenEditorWorkspacePanels = false;
}

export async function renderApp(
  context: AppTestContext,
  services?: Partial<AppServices>
) {
  await act(async () => {
    context.root.render(<App services={services} />);
  });
  await flushAsync();
}

export async function flushAsync() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    if (autoOpenEditorWorkspacePanels) {
      openEditorWorkspacePanelsOnce();
      await Promise.resolve();
      await Promise.resolve();
      openEditorWorkspacePanelsOnce();
      await Promise.resolve();
      await Promise.resolve();
    }
  });
}

function openEditorWorkspacePanelsOnce() {
  for (const button of document.querySelectorAll('button[aria-label^="Expand "]')) {
    const label = button.getAttribute('aria-label') ?? '';
    if (
      label === 'Expand Inspector Rail' ||
      label === 'Expand Inspector Dock' ||
      label === 'Expand Panel Dock' ||
      label === 'Expand workbench sidebar'
    ) {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
  }

  for (const toolbar of document.querySelectorAll('[data-editor-panel-toolbar]')) {
    for (const button of toolbar.querySelectorAll('button[data-editor-panel-menu-item]')) {
      if (button.getAttribute('aria-label')?.startsWith('Show')) {
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
    }
  }
}

export function setTextAreaValue(element: HTMLTextAreaElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    'value'
  )?.set;

  valueSetter?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

export function setSelectValue(element: HTMLSelectElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLSelectElement.prototype,
    'value'
  )?.set;

  valueSetter?.call(element, value);
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

export function setInputValue(element: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;

  valueSetter?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

export function parseSvgViewBox(value: string) {
  const [minX, minY, width, height] = value.split(/\s+/).map(Number);
  return { minX, minY, width, height };
}

export function dispatchTouchEvent(
  element: Element | null,
  type: string,
  touches: Array<Partial<Touch>>,
  changedTouches: Array<Partial<Touch>>
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', { value: touches });
  Object.defineProperty(event, 'changedTouches', { value: changedTouches });
  element?.dispatchEvent(event);
}

export function simpleLineDxf() {
  return [
    '0',
    'SECTION',
    '2',
    'ENTITIES',
    '0',
    'LINE',
    '10',
    '0',
    '20',
    '0',
    '11',
    '10',
    '21',
    '0',
    '0',
    'ENDSEC',
    '0',
    'EOF'
  ].join('\n');
}
