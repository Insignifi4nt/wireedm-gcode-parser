import tetrahedron from '@/domain/simulation/machine-import/__tests__/fixtures/tetrahedron-mm.step?raw';
import type { CadDocument } from '../cadDocument';
import { createCadDocument } from '../cadSchema';

export const CAD_BUDGET_APP_ID = 'cad_01234567-89ab-4cde-8012-3456789abcde';
export const CAD_BUDGET_ISO_TIME = '+275760-09-13T00:00:00.000Z';
/** Historical regression marker, not an application policy. */
export const CAD_FORMER_DOCUMENT_BYTES = 4 * 1024 * 1024;
export const utf8Bytes = (text: string) => new TextEncoder().encode(text).length;
export async function utf8Hash(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Complete real STEP originals with harmless trailing spaces, sized in UTF-8. */
export function cadBudgetFixture(bytes: number, id = CAD_BUDGET_APP_ID): CadDocument {
  const source = `\uFEFF/* Piesă Ω 名称 */\r\n${tetrahedron}`;
  const document: CadDocument = { ...createCadDocument('Limită Ω part', id), parameters: { depth: 10.123456789012345 }, features: [
    ...['source_a', 'source_b', 'source_c'].map(featureId => ({ kind: 'imported' as const, id: featureId, name: 'Original Ω', suppressed: false,
      source: { format: 'step' as const, encoding: 'utf8' as const, fileName: `${featureId}.step`, data: source } })),
    { kind: 'sketch', id: 'section', name: 'Secţiune', suppressed: false, plane: 'XY', offset: 'depth / 2', profiles: [
      { id: 'profile', name: 'Piesă', construction: false,
        geometry: { kind: 'rectangle', x: 0.123456789012345, y: -2, width: ' 1e1 ', height: 3.123456789012345, cornerRadius: 0 } },
    ] },
  ] };
  const padding = bytes - utf8Bytes(JSON.stringify(document));
  if (padding < 0) throw new Error('Fixture budget is smaller than its complete geometry.');
  const features = document.features.map((feature, index) => {
    if (feature.kind !== 'imported') return feature;
    const data = feature.source.data + ' '.repeat(Math.floor(padding / 3) + (index < padding % 3 ? 1 : 0));
    return { ...feature, source: { ...feature.source, data } };
  });
  return { ...document, features };
}

export function cadBudgetOriginals(document: CadDocument) {
  return document.features.flatMap(feature => feature.kind === 'imported' ? [feature.source.data] : []);
}
