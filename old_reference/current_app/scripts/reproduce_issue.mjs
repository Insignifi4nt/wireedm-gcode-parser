
import fs from 'fs';
import path from 'path';

// --- Constants ---
const COORDINATES = {
    ORIGIN: { X: 0, Y: 0 },
    UNITS: 'mm',
    PRECISION: 3,
    Y_AXIS_FLIPPED: true
};

// --- Utils ---
class PrecisionUtils {
    static round(value, precision = COORDINATES.PRECISION) {
        const factor = Math.pow(10, precision);
        return Math.round(value * factor) / factor;
    }
}

class ValidationUtils {
    static isValidCoordinate(value) {
        return typeof value === 'number' && isFinite(value) && !isNaN(value);
    }
    static sanitizeCoordinate(value, defaultValue = 0) {
        const parsed = parseFloat(value);
        return ValidationUtils.isValidCoordinate(parsed) ? parsed : defaultValue;
    }
}

class MeasurementUtils {
    static distance(x1, y1, x2, y2) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        return Math.sqrt(dx * dx + dy * dy);
    }
}

// --- Contour Detection ---
class CoordinateTracker {
    constructor() {
        this.currentPosition = { x: 0, y: 0 };
        this.absoluteMode = true;
        this.absoluteIJMode = false;
    }

    processMotion(motionData) {
        if (!motionData) return this.currentPosition;

        if (motionData.command === 'G90') this.absoluteMode = true;
        if (motionData.command === 'G91') this.absoluteMode = false;
        if (motionData.command === 'G90.1') this.absoluteIJMode = true;
        if (motionData.command === 'G91.1') this.absoluteIJMode = false;

        switch (motionData.command) {
            case 'G0':
            case 'G1':
                this._processLinearMove(motionData);
                break;
            case 'G2':
            case 'G3':
                this._processArcMove(motionData);
                break;
        }
        return this.currentPosition;
    }

    _processLinearMove(motionData) {
        if (this.absoluteMode) {
            if (motionData.x !== null) this.currentPosition.x = motionData.x;
            if (motionData.y !== null) this.currentPosition.y = motionData.y;
        } else {
            if (motionData.x !== null) this.currentPosition.x += motionData.x;
            if (motionData.y !== null) this.currentPosition.y += motionData.y;
        }
    }

    _processArcMove(motionData) {
        if (this.absoluteMode) {
            if (motionData.x !== null) this.currentPosition.x = motionData.x;
            if (motionData.y !== null) this.currentPosition.y = motionData.y;
        } else {
            if (motionData.x !== null) this.currentPosition.x += motionData.x;
            if (motionData.y !== null) this.currentPosition.y += motionData.y;
        }
    }
}

class ContourDetector {
    static DEFAULT_TOLERANCE = 1e-4;

    static detectContours(lines, options = {}) {
        const { tolerance = ContourDetector.DEFAULT_TOLERANCE } = options;
        const toolpaths = [];
        const tracker = new CoordinateTracker();

        let currentToolpath = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const motionData = ContourDetector._parseMotion(line);

            const prevPosition = { ...tracker.currentPosition };
            if (motionData) {
                tracker.processMotion(motionData);
            }

            if (ContourDetector._isMotionCommand(line)) {
                if (!currentToolpath) {
                    currentToolpath = {
                        startIndex: i,
                        endIndex: i,
                        startCoord: { ...prevPosition },
                        endCoord: { ...tracker.currentPosition },
                        lines: [line],
                        type: 'toolpath'
                    };
                } else {
                    currentToolpath.endIndex = i;
                    currentToolpath.endCoord = { ...tracker.currentPosition };
                    currentToolpath.lines.push(line);
                }
            } else if (motionData && motionData.command === 'G0') {
                if (currentToolpath) {
                    toolpaths.push(ContourDetector._finalizeToolpath(currentToolpath, lines, tolerance));
                    currentToolpath = null;
                }
            } else {
                if (currentToolpath) {
                    currentToolpath.endIndex = i;
                    currentToolpath.lines.push(line);
                }
            }
        }

        if (currentToolpath) {
            toolpaths.push(ContourDetector._finalizeToolpath(currentToolpath, lines, tolerance));
        }

        return toolpaths;
    }

    static _finalizeToolpath(toolpath, allLines, tolerance) {
        const isClosed = ContourDetector._coordinatesEqual(toolpath.startCoord, toolpath.endCoord, tolerance);
        const slice = allLines.slice(toolpath.startIndex, toolpath.endIndex + 1);

        return {
            startIndex: toolpath.startIndex,
            endIndex: toolpath.endIndex,
            startCoord: toolpath.startCoord,
            endCoord: toolpath.endCoord,
            length: ContourDetector._calculateContourLength(slice),
            direction: ContourDetector._determineDirection(slice),
            type: isClosed ? 'toolpath-closed' : 'toolpath-open',
            lines: toolpath.lines
        };
    }

    static _parseMotion(line) {
        if (!line || typeof line !== 'string') return null;
        const normalized = line.replace(/^N\d+\s+/i, '').trim().toUpperCase()
            .replace(/\bG0+([0-3])(?!\d)/g, 'G$1');
        const motionMatch = normalized.match(/^(G(?:0|1|2|3|90(?:\.1)?|91(?:\.1)?))\b/);
        if (!motionMatch) return null;

        const command = motionMatch[1];
        const xMatch = normalized.match(/X([-+]?\d*\.?\d+)/);
        const yMatch = normalized.match(/Y([-+]?\d*\.?\d+)/);
        const iMatch = normalized.match(/I([-+]?\d*\.?\d+)/);
        const jMatch = normalized.match(/J([-+]?\d*\.?\d+)/);

        return {
            command,
            x: xMatch ? parseFloat(xMatch[1]) : null,
            y: yMatch ? parseFloat(yMatch[1]) : null,
            i: iMatch ? parseFloat(iMatch[1]) : null,
            j: jMatch ? parseFloat(jMatch[1]) : null
        };
    }

    static _isMotionCommand(line) {
        const motionData = ContourDetector._parseMotion(line);
        return motionData && ['G1', 'G2', 'G3'].includes(motionData.command);
    }

    static _coordinatesEqual(coord1, coord2, tolerance) {
        return Math.abs(coord1.x - coord2.x) <= tolerance &&
            Math.abs(coord1.y - coord2.y) <= tolerance;
    }

    static _calculateContourLength(contourLines) {
        const tracker = new CoordinateTracker();
        let totalLength = 0;
        for (const line of contourLines) {
            const motionData = ContourDetector._parseMotion(line);
            if (!motionData) continue;
            const prevPosition = { ...tracker.currentPosition };
            tracker.processMotion(motionData);
            if (motionData.command === 'G0' || motionData.command === 'G1') {
                totalLength += MeasurementUtils.distance(
                    prevPosition.x, prevPosition.y,
                    tracker.currentPosition.x, tracker.currentPosition.y
                );
            } else if (motionData.command === 'G2' || motionData.command === 'G3') {
                totalLength += MeasurementUtils.distance(
                    prevPosition.x, prevPosition.y,
                    tracker.currentPosition.x, tracker.currentPosition.y
                ) * 1.2;
            }
        }
        return totalLength;
    }

    static _determineDirection(contourLines) {
        let cwCount = 0;
        let ccwCount = 0;
        for (const line of contourLines) {
            const motionData = ContourDetector._parseMotion(line);
            if (!motionData) continue;
            if (motionData.command === 'G2') cwCount++;
            if (motionData.command === 'G3') ccwCount++;
        }
        if (cwCount > ccwCount) return 'CW';
        if (ccwCount > cwCount) return 'CCW';
        return 'UNKNOWN';
    }
}

// --- IsoNormalizer Logic ---
function canonicalizeMotionCodes(text) {
    if (typeof text !== 'string') return '' + text;
    return text.replace(/\bG0+([0-3])(?!\d)/gi, 'G$1');
}

function stripForEditing(inputText) {
    if (typeof inputText !== 'string') return '';
    const lines = inputText.split(/\r?\n/);
    const out = [];
    // Remove top-level % if present
    let i = 0;
    if (lines.length && lines[0].trim() === '%') {
        i = 1;
    }
    for (; i < lines.length; i++) {
        let s = lines[i];
        if (!s) { out.push(''); continue; }
        let t = s.trim();
        // Skip pure % lines anywhere
        if (t === '%') continue;
        // Remove leading block numbers
        t = t.replace(/^N\d+\s+/i, '');
        // Canonicalize motion codes (e.g., G01 -> G1)
        t = canonicalizeMotionCodes(t);
        // If a bare G92 appears (without X or Y), make it explicit as G92 X0 Y0
        // so the drawer shows concrete start coordinates matching parser semantics.
        if (/\bG92\b/i.test(t)) {
            const hasX = /\bX-?\d+(?:\.\d+)?\b/i.test(t);
            const hasY = /\bY-?\d+(?:\.\d+)?\b/i.test(t);
            if (!hasX && !hasY) {
                const zero = (0).toFixed(3); // Hardcoded precision 3
                // Append with a single space to preserve minimal formatting impact
                t = `${t} X${zero} Y${zero}`.trim();
            }
        }
        // Skip trailing M02 only if it's the last non-empty content
        // We'll collect now; a later pass will drop final sole M02.
        out.push(t);
    }
    // Drop final M02 if last non-empty line is M02
    for (let j = out.length - 1; j >= 0; j--) {
        if (out[j].trim() === '') { continue; }
        if (/\bM0?2\b/i.test(out[j]) && out.slice(j + 1).every(x => x.trim() === '')) {
            out.splice(j, 1);
        }
        break;
    }
    return out.join('\n');
}

// --- GCodeDrawer Logic Simulation ---
function isHeaderCommand(raw) {
    if (!raw) return false;
    const cleaned = raw.replace(/^N\d+\s+/i, '').replace(/[;(].*$/g, '').trim().toUpperCase();
    if (cleaned === '') return false;
    if (/^%/.test(cleaned)) return true;
    if (/^(G92|G60|G38|G50|G51|G52|G53|G54|G55|G56|G57|G58|G59)/.test(cleaned)) return true;
    if (/^(G90|G91|G90\.1|G91\.1)/.test(cleaned)) return true;
    if (/^(G40|G41|G42|G43|G44|G45|G46|G47|G48|G49)/.test(cleaned)) return true;
    if (/^(G17|G18|G19)/.test(cleaned)) return true;
    if (/^(G20|G21)/.test(cleaned)) return true;
    if (/^(G94|G95|G96|G97|G98|G99)/.test(cleaned)) return true;
    if (/^(M[0-9]|M1[0-9]|M2[0-9]|M3[0-9]|M[4-9][0-9]|M28|M30)/.test(cleaned) && !/^M02\b/.test(cleaned)) return true;
    return false;
}

function isMotionCommand(raw) {
    if (!raw) return false;
    const cleaned = raw.replace(/^N\d+\s+/i, '').replace(/[;(].*$/g, '').trim().toUpperCase().replace(/\bG0+([0-3])(?!\d)/g, 'G$1');
    return /^(G0|G1|G2|G3)\b/.test(cleaned);
}

function isFooterCommand(raw) {
    if (!raw) return false;
    const cleaned = raw.replace(/^N\d+\s+/i, '').replace(/[;(].*$/g, '').trim().toUpperCase();
    return /^(M02|M30)\b/.test(cleaned) || /^%$/.test(cleaned);
}

function organizeLinesIntoSections(lines) {
    const sections = {
        header: { lines: [], startLineNum: 1 },
        body: { lines: [], startLineNum: 1 },
        footer: { lines: [], startLineNum: 1 }
    };

    let inBody = false;
    let foundFirstMotion = false;
    let currentLineNum = 1;

    for (let i = 0; i < lines.length; i++) {
        const text = lines[i];
        const trimmedLine = (text || '').trim();

        if (trimmedLine === '' || trimmedLine.startsWith(';') || trimmedLine.startsWith('(')) {
            if (inBody && foundFirstMotion) {
                sections.body.lines.push({ num: currentLineNum, text });
            } else if (sections.footer.lines.length > 0) {
                if (sections.footer.lines.length === 1) sections.footer.startLineNum = currentLineNum;
                sections.footer.lines.push({ num: currentLineNum, text });
            } else {
                if (sections.header.lines.length === 0) sections.header.startLineNum = currentLineNum;
                sections.header.lines.push({ num: currentLineNum, text });
            }
            currentLineNum++;
            continue;
        }

        if (isFooterCommand(text)) {
            if (sections.footer.lines.length === 0) sections.footer.startLineNum = currentLineNum;
            sections.footer.lines.push({ num: currentLineNum, text });
            currentLineNum++;
            continue;
        }

        if (isMotionCommand(text)) {
            if (!foundFirstMotion) {
                foundFirstMotion = true;
                inBody = true;
                sections.body.startLineNum = currentLineNum;
            }
            sections.body.lines.push({ num: currentLineNum, text });
            currentLineNum++;
            continue;
        }

        if (isHeaderCommand(text)) {
            if (inBody && foundFirstMotion) {
                sections.body.lines.push({ num: currentLineNum, text });
            } else {
                if (sections.header.lines.length === 0) sections.header.startLineNum = currentLineNum;
                sections.header.lines.push({ num: currentLineNum, text });
            }
            currentLineNum++;
            continue;
        }

        if (inBody && foundFirstMotion) {
            sections.body.lines.push({ num: currentLineNum, text });
        } else if (sections.footer.lines.length > 0) {
            sections.footer.lines.push({ num: currentLineNum, text });
        } else {
            if (sections.header.lines.length === 0) sections.header.startLineNum = currentLineNum;
            sections.header.lines.push({ num: currentLineNum, text });
        }
        currentLineNum++;
    }

    if (sections.body.lines.length > 0) {
        sections.body.contours = detectContours(sections.body.lines);
    }

    return sections;
}

function detectContours(bodyLines) {
    const lineTexts = bodyLines.map(l => l.text);
    const contours = ContourDetector.detectContours(lineTexts);

    const processedContours = [];
    let lastEndIndex = -1;

    for (let i = 0; i < contours.length; i++) {
        const contour = contours[i];
        const contourId = `contour-${i + 1}`;

        if (contour.startIndex > lastEndIndex + 1) {
            const looseLines = bodyLines.slice(lastEndIndex + 1, contour.startIndex);
            if (looseLines.length > 0) {
                processedContours.push({
                    id: `loose-${processedContours.length}`,
                    type: 'loose',
                    lines: looseLines,
                    startLineNum: looseLines[0].num,
                    count: looseLines.length
                });
            }
        }

        const contourLines = bodyLines.slice(contour.startIndex, contour.endIndex + 1);
        processedContours.push({
            id: contourId,
            type: contour.type || 'contour',
            lines: contourLines,
            startLineNum: contourLines[0].num,
            count: contourLines.length,
            length: contour.length,
            direction: contour.direction,
            startCoord: contour.startCoord,
            endCoord: contour.endCoord
        });

        lastEndIndex = contour.endIndex;
    }

    if (lastEndIndex < bodyLines.length - 1) {
        const remainingLines = bodyLines.slice(lastEndIndex + 1);
        if (remainingLines.length > 0) {
            processedContours.push({
                id: `loose-${processedContours.length}`,
                type: 'loose',
                lines: remainingLines,
                startLineNum: remainingLines[0].num,
                count: remainingLines.length
            });
        }
    }

    if (processedContours.length === 0 && bodyLines.length > 0) {
        processedContours.push({
            id: 'loose-0',
            type: 'loose',
            lines: bodyLines,
            startLineNum: bodyLines[0].num,
            count: bodyLines.length
        });
    }

    return processedContours;
}

import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Main Execution ---
const filePath = path.join(__dirname, '../testing_gcode_files/2K-Filera-Face-12-002.gcode');
try {
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const lines = fileContent.split(/\r?\n/);
    console.log(`Original file lines: ${lines.length}`);

    // Test stripForEditing
    const strippedText = stripForEditing(fileContent);
    const strippedLines = strippedText.split(/\n/);
    console.log(`Stripped file lines: ${strippedLines.length}`);

    const sections = organizeLinesIntoSections(strippedLines);

    let totalProcessedLines = 0;
    totalProcessedLines += sections.header.lines.length;
    console.log(`Header lines: ${sections.header.lines.length}`);

    if (sections.body.contours) {
        let bodyLines = 0;
        sections.body.contours.forEach(c => {
            bodyLines += c.lines.length;
        });
        console.log(`Body lines (contours): ${bodyLines}`);
        totalProcessedLines += bodyLines;
    } else {
        console.log(`Body lines (no contours): ${sections.body.lines.length}`);
        totalProcessedLines += sections.body.lines.length;
    }

    totalProcessedLines += sections.footer.lines.length;
    console.log(`Footer lines: ${sections.footer.lines.length}`);

    console.log(`Total processed lines: ${totalProcessedLines}`);

    if (totalProcessedLines !== strippedLines.length) {
        console.error(`MISMATCH: Expected ${strippedLines.length}, got ${totalProcessedLines}`);
        const diff = strippedLines.length - totalProcessedLines;
        console.error(`Missing ${diff} lines`);
    } else {
        console.log('SUCCESS: Line counts match');
    }

} catch (err) {
    console.error('Error reading file:', err);
}
