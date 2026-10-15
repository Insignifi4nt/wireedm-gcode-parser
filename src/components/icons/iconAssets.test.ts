import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { iconCatalog } from './iconCatalog';

const directory = resolve('src/assets/icons');
describe('original icon assets', () => {
  it('keeps every exported SVG safe, accessible, sized and identical to its catalog geometry', () => {
    const files = readdirSync(directory).filter(file => file.endsWith('.svg') && file !== 'favicon.svg');
    expect(files.length).toBe(Object.keys(iconCatalog).length);
    for (const [id, entry] of Object.entries(iconCatalog)) {
      const source = readFileSync(`${directory}/${id}.svg`, 'utf8');
      const xml = new DOMParser().parseFromString(source, 'image/svg+xml');
      expect(xml.querySelector('parsererror'), id).toBeNull();
      const svg = xml.documentElement;
      expect(svg.namespaceURI, id).toBe('http://www.w3.org/2000/svg');
      expect(svg.getAttribute('viewBox'), id).toBe('0 0 24 24');
      expect(svg.getAttribute('width'), id).toBe('24');
      expect(svg.getAttribute('height'), id).toBe('24');
      expect(svg.getAttribute('stroke'), id).toBe('currentColor');
      expect(svg.getAttribute('stroke-width'), id).toBe('1.75');
      expect(svg.getAttribute('stroke-linecap'), id).toBe('round');
      expect(svg.getAttribute('stroke-linejoin'), id).toBe('round');
      expect(svg.getAttribute('aria-label'), id).toBe(entry.label);
      expect(svg.getAttribute('role'), id).toBe('img');
      expect([...svg.children].map(child => child.tagName), id).toEqual(entry.paths.map(() => 'path'));
      expect([...svg.children].map(child => child.getAttribute('d')), id).toEqual([...entry.paths]);
      expect(svg.querySelector('[id], [href], script, image, foreignObject, style, use'), id).toBeNull();
      expect(source, id).not.toMatch(/\bon\w+=|url\(/i);
    }
  });
  it('keeps the review catalog searchable, filterable and usable in both themes', () => {
    const html = readFileSync(resolve('icon-catalog/index.html'), 'utf8');
    const dom = new JSDOM(html, { runScripts: 'dangerously' });
    try {
      const { document, Event } = dom.window;
      const search = document.querySelector<HTMLInputElement>('#search');
      const category = document.querySelector<HTMLSelectElement>('#category');
      expect(document.querySelectorAll('article').length).toBe(Object.keys(iconCatalog).length);
      if (!search || !category) throw new Error('Missing catalog controls');
      search.value = 'pocket'; search.dispatchEvent(new Event('input'));
      expect([...document.querySelectorAll<HTMLElement>('article')].filter(card => !card.hidden)).toHaveLength(2);
      category.value = 'files'; category.dispatchEvent(new Event('change'));
      expect(document.querySelector('output')?.textContent).toBe('0 icons');
      document.querySelector<HTMLButtonElement>('#theme')?.click();
      expect(document.body.classList.contains('light')).toBe(true);
      expect(document.querySelector('#theme')?.getAttribute('aria-pressed')).toBe('true');
    } finally { dom.window.close(); }
  });
});
