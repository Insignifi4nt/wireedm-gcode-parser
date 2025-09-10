import { describe, it, expect } from 'vitest';
import { ContourDetector } from '../utils/geometry/ContourDetection.js';

const approxEqual = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

describe('ContourDetector', () => {
  it('detects a closed rectangle in absolute mode (G90)', () => {
    const lines = [
      'G90',
      'G0 X0 Y0',
      'G1 X10 Y0',
      'G1 X10 Y10',
      'G1 X0 Y10',
      'G1 X0 Y0'
    ];
    const contours = ContourDetector.detectContours(lines);
    expect(contours.length).toBeGreaterThan(0);
    const c = contours[0];
    expect(approxEqual(c.startCoord.x, c.endCoord.x)).toBe(true);
    expect(approxEqual(c.startCoord.y, c.endCoord.y)).toBe(true);
    expect(c.length).toBeGreaterThan(0);
  });

  it('handles relative mode (G91) and closes a square path', () => {
    const lines = [
      'G90',
      'G0 X0 Y0',
      'G91',
      'G1 X10 Y0',
      'G1 X0 Y10',
      'G1 X-10 Y0',
      'G1 X0 Y-10'
    ];
    const contours = ContourDetector.detectContours(lines);
    expect(contours.length).toBeGreaterThan(0);
    const c = contours[0];
    expect(approxEqual(c.startCoord.x, c.endCoord.x)).toBe(true);
    expect(approxEqual(c.startCoord.y, c.endCoord.y)).toBe(true);
  });
});

