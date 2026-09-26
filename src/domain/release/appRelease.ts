import packageInfo from '../../../package.json';

export const APP_VERSION = packageInfo.version;
export const DOCUMENTATION_URL = 'https://insignifi4nt.github.io/wireedm-gcode-parser/documentation/';
export const APP_SOURCE_URL = `https://github.com/Insignifi4nt/wireedm-gcode-parser/tree/v${APP_VERSION}`;

/** App provenance is informational. Exact schemas, capabilities and conformance decide execution. */
export const POST_CONTRACT_CHANGES = [
  'Post schema v2 replaces the wireSeparation boolean with exact mechanism names: manual-before-positioning, automatic-before-positioning, or automatic-during-positioning. Legacy booleans remain readable but do not authorize a mechanism.',
  'Arc commands require an explicit arcDirection. Motion audit checks formatted, quantized coordinates and declared state effects.',
  'UPID v2 represents after-positioning stops and separation during positioning. A legacy saved plan that differs from the current compiler requires a new saved revision.',
  'UPID v3 adds after-contour-distance stops measured along the exit lead and next positioning. The program-stop placement vocabulary expands and travel moves may be split around a pause. Strict posts or posts assuming unsplit moves may reject these jobs; inspect exact controller output and preserve installed packages and saved revisions. Older apps reject v3.'
] as const;
