import { ContourDetector } from './src/utils/geometry/ContourDetection.js';
import { readFileSync, existsSync } from 'fs';

// Read test file (CLI arg or fallback to repo sample)
const filePath = process.argv[2] || 'testing_gcode_files/ArcTestFile2.txt';
if (!existsSync(filePath)) {
  console.error(`Input file not found: ${filePath}\nUsage: node test_contour_detection.js <path-to-gcode>`);
  process.exit(1);
}
const testFile = readFileSync(filePath, 'utf8');
const lines = testFile.split(/\r?\n/);

console.log('Testing ContourDetector with test file:');
console.log('Total lines:', lines.length);

// Detect contours
const contours = ContourDetector.detectContours(lines);

console.log('\nDetected contours:');
contours.forEach((contour, i) => {
  console.log(`Contour ${i + 1}:`);
  console.log(`  Lines: ${contour.startIndex} - ${contour.endIndex}`);
  console.log(`  Start: (${contour.startCoord.x}, ${contour.startCoord.y})`);
  console.log(`  End: (${contour.endCoord.x}, ${contour.endCoord.y})`);
  console.log(`  Length: ${contour.length?.toFixed(2)} mm`);
  console.log(`  Direction: ${contour.direction}`);
  console.log();
});

if (contours.length === 0) {
  console.log('No closed contours detected.');
  
  // Debug: show some sample lines
  console.log('\nSample lines:');
  lines.slice(0, 10).forEach((line, i) => {
    console.log(`${i + 1}: ${line}`);
  });
}