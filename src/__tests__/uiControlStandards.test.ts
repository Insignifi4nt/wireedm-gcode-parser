// @vitest-environment node
import { expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkUiControls, unsharedControlLocations } from '../../scripts/check-ui-controls';

async function checkFixture(files: Record<string, string>) {
  const root = await mkdtemp(path.join(tmpdir(), 'wireedm-ui-standard-'));
  try {
    for (const [name, source] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(root, name)), { recursive: true });
      await writeFile(path.join(root, name), source);
    }
    return await checkUiControls(root);
  } finally { await rm(root, { recursive: true, force: true }); }
}

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

it('detects factory calls in TypeScript modules as well as TSX', () => {
  expect(unsharedControlLocations(`const node = React.createElement('select', { name: 'view' });`, 'view.ts')).toEqual([{ tag: 'select', line: 1, column: 14 }]);
  expect(unsharedControlLocations(`type select = string; const value = <select>input;`, 'assertion.ts')).toEqual([]);
});

it('finds one-off inputs, buttons, menus and native hover titles without treating domain component props as controls', () => {
  const source = `<><input /><button>Save</button><textarea /><div role="menu" /><span title="Details" /><Dialog title="Import" /><MenuSurface /><Button title="Save" /></>`;
  expect(unsharedControlLocations(source, 'fields.tsx').map(location => location.tag)).toEqual(['input', 'button', 'textarea', 'menu', 'native-tooltip']);
});

it('rejects forced uppercase styles in class variants, class helpers and CSS while retaining source data', async () => {
  const violations = await checkFixture({
    'src/view.tsx': `const source = 'uppercase';
const view = <Button className={cn('text-sm md:uppercase', active && '!uppercase', { 'focus:uppercase': ready })} style={{ textTransform: 'uppercase' }} />;
const arbitrary = <Button className="hover:[text-transform:uppercase]" />;
const factory = React.createElement(Button, { className: 'uppercase' });`,
    'src/view.css': `/* text-transform: uppercase; */
.label { text-transform: uppercase; }
.label-utility { @apply text-sm uppercase; }
.source::before { content: 'text-transform: uppercase'; }`
  });
  expect(violations.map(value => value.match(/\(([^)]+)\)$/)?.[1]).sort()).toEqual([
    'uppercase-class', 'uppercase-class', 'uppercase-class', 'uppercase-class', 'uppercase-class', 'uppercase-class', 'uppercase-style', 'uppercase-style'
  ]);
});

it('keeps literal control colors in the theme while allowing semantic colors, source content and geometry palettes', async () => {
  const violations = await checkFixture({
    'src/components/ui/theme.css': ':root { --primary: #56bfd0; --primary-hover: color-mix(in srgb, var(--primary), white 12%); }',
    'src/components/ui/button.css': `@layer components {
.ui-button { color: #fff; background: rgb(1 2 3); box-shadow: 0 4px 14px #0005; }
.ui-button:hover { background: color-mix(in srgb, var(--primary), white 12%); }
.ui-button-danger { border-color: red; }
.ui-button-outline { color: var(--foreground); background: transparent; border-color: currentColor; }
.ui-icon { mask-image: url("data:image/svg+xml,%3Csvg fill='%23000'%3E%3C/svg%3E"); }
.ui-source::before { content: '#fff red rgb(1 2 3)'; }
}`,
    'src/features/cad/geometry.css': '.geometry { stroke: #56bfd0; fill: rgb(1 2 3); }'
  });
  expect(violations).toHaveLength(5);
  expect(violations.every(value => value.startsWith('src/components/ui/button.css:') && value.endsWith('(literal-control-color)'))).toBe(true);
});

it('reserves shared-control appearance for its owners while leaving feature layout and semantic indicators alone', async () => {
  const violations = await checkFixture({
    'src/feature.css': `@layer components {
.ui-button { padding: 4px; color: var(--foreground); }
.ui-input:focus { outline: 2px solid var(--ring); }
.panel .ui-menu-item { min-width: 180px; }
.selected-row[data-selected] { color: #56bfd0; }
}`,
    'src/components/ui/fixture.css': '.ui-button { color: var(--foreground); transform: translateX(calc(tan(0rad) * 1px)); }'
  });
  expect(violations).toHaveLength(2);
  expect(violations.every(value => value.startsWith('src/feature.css:') && value.endsWith('(shared-control-paint)'))).toBe(true);
});
