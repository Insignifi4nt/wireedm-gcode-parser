// @vitest-environment node
import { expect, it } from 'vitest';
import { checkUiControls, unsharedControlLocations } from '../../scripts/check-ui-controls';

it('detects real native controls and factory calls without flagging comments, text, types or shared components', () => {
  const source = `// <select />
const example = '<select />';
type Props = { select: string };
const shared = <Select><option>One</option></Select>;
const raw = <select aria-label="Choice"><option>One</option></select>;
const empty = <select />;
const factory = React.createElement('select', { name: 'choice' });
const named = createElement('select');`;
  expect(unsharedControlLocations(source, 'fixture.tsx').map(position => position.line)).toEqual([5, 6, 7, 8]);
});

it('keeps all production controls, menus and tooltips on shared components', async () => {
  expect(await checkUiControls()).toEqual([]);
});

it('detects factory calls in TypeScript modules as well as TSX', () => {
  expect(unsharedControlLocations(`const node = React.createElement('select', { name: 'view' });`, 'view.ts')).toEqual([{ tag: 'select', line: 1, column: 14 }]);
  expect(unsharedControlLocations(`type select = string; const value = <select>input;`, 'assertion.ts')).toEqual([]);
});

it('finds one-off inputs, buttons, menus and native hover titles without treating domain component props as controls', () => {
  const source = `<><input /><button>Save</button><textarea /><div role="menu" /><span title="Details" /><Dialog title="Import" /><MenuSurface /><Button title="Save" /></>`;
  expect(unsharedControlLocations(source, 'fields.tsx').map(location => location.tag)).toEqual(['input', 'button', 'textarea', 'menu', 'native-tooltip']);
});
