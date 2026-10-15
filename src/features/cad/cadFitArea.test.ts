import { expect, it } from 'vitest';
import { cadUnobscuredFitArea } from './cadFitArea';

it('chooses the largest unobscured rectangle from actual floating panel bounds', () => {
  expect(cadUnobscuredFitArea({ left: 224, top: 76, width: 903, height: 795 }, [{ left: 795, top: 88, width: 320, height: 630 }]))
    .toEqual({ left: 0, top: 0, width: 571, height: 795 });
});
it('uses the full-width space below a minimized panel and ignores hidden/off-canvas occlusions', () => {
  expect(cadUnobscuredFitArea({ left: 100, top: 50, width: 700, height: 500 }, [{ left: 480, top: 62, width: 308, height: 24 }]))
    .toEqual({ left: 0, top: 36, width: 700, height: 464 });
  expect(cadUnobscuredFitArea({ left: 100, top: 50, width: 700, height: 500 }, [{ left: 900, top: 50, width: 100, height: 50 }]))
    .toEqual({ left: 0, top: 0, width: 700, height: 500 });
});
it('clips overlapping panels and supports narrow canvases without inventing a fitting area', () => {
  expect(cadUnobscuredFitArea({ left: 0, top: 0, width: 200, height: 300 }, [{ left: 10, top: 10, width: 320, height: 230 }]))
    .toEqual({ left: 0, top: 240, width: 200, height: 60 });
  expect(cadUnobscuredFitArea({ left: 0, top: 0, width: 200, height: 300 }, [{ left: -1, top: -1, width: 300, height: 400 }])).toBeNull();
});
it.each([Number.NaN, Infinity, -Infinity])('rejects nonfinite fit geometry (%s)', value => {
  expect(cadUnobscuredFitArea({ left: 0, top: 0, width: value, height: 300 }, [])).toBeNull();
  expect(cadUnobscuredFitArea({ left: 0, top: 0, width: 200, height: 300 }, [{ left: value, top: 0, width: 50, height: 50 }])).toBeNull();
});
