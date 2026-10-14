import { expect, type Page } from '@playwright/test';

// Exercise production registrations without a browser-specific WebMCP transport.
// Native WebMCP interoperability is also checked in the Codex in-app browser.
export async function prepareCadTools(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('wireedm.onboarding.dismissed', 'true');
    const tools = new Map<string, { execute(input: unknown): Promise<unknown> }>();
    Object.defineProperty(document, 'modelContext', { configurable: true, value: {
      registerTool(tool: { name: string; execute(input: unknown): Promise<unknown> }, options: { signal: AbortSignal }) {
        tools.set(tool.name, tool);
        options.signal.addEventListener('abort', () => { if (tools.get(tool.name) === tool) tools.delete(tool.name); });
      }
    } });
    Object.defineProperty(document, '__cadTestTools', { value: tools });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Design in CAD' })).toBeEnabled();
}

export async function rawCadToolCall(page: Page, name: string, input: unknown = {}) {
  return page.evaluate(async ({ name, input }) => {
    const tools = (document as Document & { __cadTestTools: Map<string, { execute(input: unknown): Promise<unknown> }> }).__cadTestTools;
    const tool = tools.get(name);
    if (!tool) throw new Error(`Missing registered tool ${name}`);
    return tool.execute(input);
  }, { name, input });
}

export async function callCadTool(page: Page, name: string, input: unknown = {}): Promise<Record<string, unknown>> {
  const result = await rawCadToolCall(page, name, input);
  expect(result, `${name}: ${JSON.stringify(result)}`).toMatchObject({ ok: true });
  if (!result || typeof result !== 'object' || !('data' in result) || !result.data || typeof result.data !== 'object') throw new Error('Invalid tool result');
  return result.data as Record<string, unknown>;
}

export async function cadContext(page: Page): Promise<Record<string, unknown> & { version: string; documentId: string }> {
  const value = await callCadTool(page, 'cad_get_context');
  if (!('version' in value) || typeof value.version !== 'string' || !('documentId' in value) || typeof value.documentId !== 'string') throw new Error('Invalid CAD context');
  return { ...value, version: value.version, documentId: value.documentId };
}
