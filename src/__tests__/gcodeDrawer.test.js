import { describe, it, expect } from 'vitest';
import { organizeGCodeStructure, isHeaderCommand, isMotionCommand, isFooterCommand } from '../utils/GCodeStructure.js';
import { stripForEditing, canonicalizeMotionCodes } from '../utils/IsoNormalizer.js';

describe('GCode Structure Logic', () => {
    describe('Command Classification', () => {
        it('identifies header commands', () => {
            expect(isHeaderCommand('%')).toBe(true);
            expect(isHeaderCommand('G92 X0 Y0')).toBe(true);
            expect(isHeaderCommand('G60')).toBe(true);
            expect(isHeaderCommand('G90')).toBe(true);
            expect(isHeaderCommand('G1 X10')).toBe(false);
        });

        it('identifies motion commands', () => {
            expect(isMotionCommand('G0 X0 Y0')).toBe(true);
            expect(isMotionCommand('G1 X10')).toBe(true);
            expect(isMotionCommand('G2 I5')).toBe(true);
            expect(isMotionCommand('G3 J5')).toBe(true);
            expect(isMotionCommand('G00 X0')).toBe(true); // Canonicalization check
            expect(isMotionCommand('G92')).toBe(false);
        });

        it('identifies footer commands', () => {
            expect(isFooterCommand('M02')).toBe(true);
            expect(isFooterCommand('M30')).toBe(true);
            expect(isFooterCommand('G1 X0')).toBe(false);
        });
    });

    describe('Structure Organization', () => {
        it('splits code into header, body, and footer', () => {
            const lines = [
                '%',
                'G92 X0 Y0',
                'G90',
                'G0 X10 Y10', // Body start
                'G1 X20 Y10',
                'M02' // Footer
            ];

            const sections = organizeGCodeStructure(lines);

            expect(sections.header.lines.length).toBe(3);
            expect(sections.header.lines[0].text).toBe('%');

            expect(sections.body.lines.length).toBe(2);
            expect(sections.body.lines[0].text).toBe('G0 X10 Y10');

            expect(sections.footer.lines.length).toBe(1);
            expect(sections.footer.lines[0].text).toBe('M02');
        });

        it('detects contours within body', () => {
            const lines = [
                'G90',
                'G0 X0 Y0',
                'G1 X10 Y0', // Contour 1
                'G1 X10 Y10',
                'G0 X20 Y20', // Break
                'G1 X30 Y30', // Contour 2
                'M02'
            ];

            const sections = organizeGCodeStructure(lines);

            // Header: G90 (1 line)
            expect(sections.header.lines.length).toBe(1);

            // Body: G0...G1...G1...G0...G1 (5 lines)
            expect(sections.body.lines.length).toBe(5);

            // Contours should be detected
            // 1. G0 X0 Y0 (loose/rapid start often part of first move logic or separate?)
            // Let's check how structureContours handles it.
            // G0 usually breaks contours.
            // G1/G2/G3 form contours.

            const contours = sections.body.contours;
            expect(contours).toBeDefined();
            expect(contours.length).toBeGreaterThan(0);

            // We expect at least 2 contours/groups
            // The exact grouping depends on ContourDetector logic which we are testing indirectly here
            // but primarily we want to ensure the structure object is populated.
        });
    });

    describe('IsoNormalizer', () => {
        it('canonicalizes motion codes', () => {
            expect(canonicalizeMotionCodes('G00 X10')).toBe('G0 X10');
            expect(canonicalizeMotionCodes('G01 Y20')).toBe('G1 Y20');
            expect(canonicalizeMotionCodes('G02 I5')).toBe('G2 I5');
            expect(canonicalizeMotionCodes('G03 J5')).toBe('G3 J5');
        });

        it('strips for editing correctly', () => {
            const input = `
%
N10 G92 X0 Y0
N20 G01 X10 Y10
N30 M02
`;
            const expected = `G92 X0 Y0
G1 X10 Y10`;

            const result = stripForEditing(input);
            expect(result.trim()).toBe(expected);
        });

        it('handles G92 without coordinates by adding X0 Y0', () => {
            const input = 'N10 G92';
            const result = stripForEditing(input);
            expect(result).toBe('G92 X0.000 Y0.000');
        });
    });
});
