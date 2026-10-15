// @vitest-environment node
import { expect, it } from 'vitest';
import { checkUiControls, nativeSelectLocations } from '../../scripts/check-ui-controls';

it('detects real native controls and factory calls without flagging comments, text, types or shared components', () => {
  const source = `// <select />
const example = '<select />';
type Props = { select: string };
const shared = <Select><option>One</option></Select>;
const raw = <select aria-label="Choice"><option>One</option></select>;
const empty = <select />;
const factory = React.createElement('select', { name: 'choice' });
const named = createElement('select');`;
  expect(nativeSelectLocations(source, 'fixture.tsx').map(position => position.line)).toEqual([5, 6, 7, 8]);
});

it('keeps production select controls on the shared primitive across the platform', async () => {
  expect(await checkUiControls()).toEqual([]);
});

it('detects factory calls in TypeScript modules as well as TSX', () => {
  expect(nativeSelectLocations(`const node = React.createElement('select', { name: 'view' });`, 'view.ts')).toEqual([{ line: 1, column: 14 }]);
  expect(nativeSelectLocations(`type select = string; const value = <select>input;`, 'assertion.ts')).toEqual([]);
});
