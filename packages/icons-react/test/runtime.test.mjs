import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { act, createElement, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { AddIcon, Plus, PadIcon } from '../dist/index.js';
import { WorkbenchIcon } from '../dist/dynamic.js';

let dom, root, host;
beforeEach(() => {
  dom = new JSDOM('<!doctype html><div id="root"></div>');
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.getElementById('root');
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  dom.window.close();
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

test('forwards the native SVG ref, events and overrides while retaining grid and absolute-stroke behavior', () => {
  const ref = createRef();
  let clicks = 0;
  act(() => root.render(createElement(AddIcon, { ref, size: 16, absoluteStrokeWidth: true, className: 'selected', onClick: () => clicks++ })));
  const svg = host.querySelector('svg');
  assert.equal(ref.current, svg);
  assert.equal(svg.getAttribute('viewBox'), '0 0 24 24');
  assert.equal(svg.getAttribute('width'), '16');
  assert.equal(svg.getAttribute('height'), '16');
  assert.equal(svg.getAttribute('stroke'), 'currentColor');
  assert.equal(svg.getAttribute('stroke-width'), '1.75');
  assert.equal(svg.getAttribute('class'), 'selected');
  assert.equal(svg.querySelector('path').getAttribute('vector-effect'), 'non-scaling-stroke');
  act(() => svg.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
  assert.equal(clicks, 1);
  act(() => root.render(createElement(AddIcon, { ref, size: '1em', width: 32, stroke: 'blue', strokeWidth: 2.5 })));
  assert.equal(ref.current, svg);
  assert.equal(svg.getAttribute('width'), '32');
  assert.equal(svg.getAttribute('height'), '1em');
  assert.equal(svg.getAttribute('stroke'), 'blue');
  assert.equal(svg.getAttribute('stroke-width'), '2.5');
  assert.equal(svg.querySelector('path').hasAttribute('vector-effect'), false);
});

test('keeps decorative glyphs quiet and supports named, externally labeled and dynamic standalone icons', () => {
  assert.equal(AddIcon, Plus);
  act(() => root.render(createElement('div', null,
    createElement(AddIcon),
    createElement(PadIcon, { 'aria-label': 'Extrude the selected profile' }),
    createElement(WorkbenchIcon, { name: 'warning', 'aria-labelledby': 'caption' }, createElement('title', { id: 'caption' }, 'Needs attention'))
  )));
  const [decorative, named, dynamic] = host.querySelectorAll('svg');
  assert.equal(decorative.getAttribute('aria-hidden'), 'true');
  assert.equal(decorative.getAttribute('focusable'), 'false');
  assert.equal(decorative.hasAttribute('role'), false);
  assert.equal(named.getAttribute('role'), 'img');
  assert.equal(named.getAttribute('aria-label'), 'Extrude the selected profile');
  assert.equal(named.hasAttribute('aria-hidden'), false);
  assert.equal(dynamic.getAttribute('role'), 'img');
  assert.equal(dynamic.getAttribute('aria-labelledby'), 'caption');
  assert.equal(dynamic.querySelector('title').textContent, 'Needs attention');
  assert.equal(host.querySelectorAll('svg [id]').length, 1);
});
