
import { ContourDetector } from './geometry/ContourDetection.js';

// Helper functions for organizing G-code into sections
export function isHeaderCommand(raw) {
    if (!raw) return false;
    const cleaned = raw.replace(/^N\d+\s+/i, '').replace(/[;(].*$/g, '').trim().toUpperCase();
    if (cleaned === '') return false;

    // Program control and setup commands
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

export function isMotionCommand(raw) {
    if (!raw) return false;
    const cleaned = raw.replace(/^N\d+\s+/i, '').replace(/[;(].*$/g, '').trim().toUpperCase().replace(/\bG0+([0-3])(?!\d)/g, 'G$1');
    return /^(G0|G1|G2|G3)(?=\D|$)/.test(cleaned);
}

export function isFooterCommand(raw) {
    if (!raw) return false;
    const cleaned = raw.replace(/^N\d+\s+/i, '').replace(/[;(].*$/g, '').trim().toUpperCase();
    return /^(M02|M30)\b/.test(cleaned) || /^%$/.test(cleaned);
}

/**
 * Organize lines into header, body with contours, and footer sections
 * @param {Array<string>} lines - Array of G-code lines
 * @returns {Object} Sections object { header, body, footer }
 */
export function organizeGCodeStructure(lines) {
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

        // Handle empty lines and comments - they follow context
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

        // Check for footer commands first
        // Special case: % is footer only if we've already seen body or header content
        // Actually, % is ambiguous. If it's the first line, it's definitely header.
        const isPercent = trimmedLine === '%';
        if (isFooterCommand(text) && (!isPercent || inBody || sections.header.lines.length > 0)) {
            if (sections.footer.lines.length === 0) sections.footer.startLineNum = currentLineNum;
            sections.footer.lines.push({ num: currentLineNum, text });
            currentLineNum++;
            continue;
        }

        // Check for motion commands
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

        // Check for explicit header commands
        if (isHeaderCommand(text)) {
            if (inBody && foundFirstMotion) {
                // Unusual - setup command in middle of motion commands
                sections.body.lines.push({ num: currentLineNum, text });
            } else {
                if (sections.header.lines.length === 0) sections.header.startLineNum = currentLineNum;
                sections.header.lines.push({ num: currentLineNum, text });
            }
            currentLineNum++;
            continue;
        }

        // For other commands, use context
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

    // Detect contours within the body section
    if (sections.body.lines.length > 0) {
        sections.body.contours = structureContours(sections.body.lines);
    }

    return sections;
}

/**
 * Detect closed contours within body lines and structure them
 * @param {Array<{num:number, text:string}>} bodyLines 
 * @returns {Array<Object>} Processed contours/folders
 */
export function structureContours(bodyLines) {
    const lineTexts = bodyLines.map(l => l.text);
    const contours = ContourDetector.detectContours(lineTexts);

    // Process detected contours and create folder structure
    const processedContours = [];
    let lastEndIndex = -1;

    for (let i = 0; i < contours.length; i++) {
        const contour = contours[i];
        const contourId = `contour-${i + 1}`;

        // Add any lines between last contour and this one as "loose" commands
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

        // Add the contour folder
        const contourLines = bodyLines.slice(contour.startIndex, contour.endIndex + 1);
        processedContours.push({
            id: contourId,
            type: contour.type || 'contour', // 'toolpath-open' or 'toolpath-closed'
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

    // Add any remaining lines after the last contour
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

    // If no contours were detected, treat all body lines as loose
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
