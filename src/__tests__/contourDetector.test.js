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
    expect(c.type).toBe('toolpath-closed');
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

  it('detects a single-line full circle (G2/G3)', () => {
    const lines = [
      'G90',
      'G0 X10 Y10',
      'G2 I5' // Full circle, end point == start point
    ];
    const contours = ContourDetector.detectContours(lines);
    expect(contours.length).toBe(1);
    const c = contours[0];
    // Check number of lines using indices
    expect(c.endIndex - c.startIndex + 1).toBe(1);
    expect(approxEqual(c.startCoord.x, c.endCoord.x)).toBe(true);
  });

  it('detects a two-line closed shape', () => {
    const lines = [
      'G90',
      'G0 X0 Y0',
      'G1 X10 Y0',
      'G1 X0 Y0' // Back to start
    ];
    const contours = ContourDetector.detectContours(lines);
    expect(contours.length).toBe(1);
    const c = contours[0];
    expect(c.endIndex - c.startIndex + 1).toBe(2);
    expect(c.type).toBe('toolpath-closed');
  });

  it('detects an open toolpath', () => {
    const lines = [
      'G90',
      'G0 X0 Y0',
      'G1 X10 Y0',
      'G1 X20 Y0' // Ends here, not closed
    ];
    const contours = ContourDetector.detectContours(lines);
    expect(contours.length).toBe(1);
    const c = contours[0];
    expect(c.type).toBe('toolpath-open');
    expect(c.lines.length).toBe(2);
  });

  it('detects multiple toolpaths separated by rapids', () => {
    const lines = [
      'G90',
      'G0 X0 Y0',
      'G1 X10 Y0', // Path 1 (Open)
      'G0 X20 Y20', // Rapid
      'G1 X30 Y20', // Path 2 (Open)
      'G1 X30 Y30'
    ];
    const contours = ContourDetector.detectContours(lines);
    expect(contours.length).toBe(2);
    expect(contours[0].type).toBe('toolpath-open');
    expect(contours[1].type).toBe('toolpath-open');
  });
});
