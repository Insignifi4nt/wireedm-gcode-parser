// Rebuilds scripts/unit-test-shard-weights.json from the Vitest JSON reports of every unit shard of one review run
// (the unit-test-timings-* artifacts). Usage: tsx scripts/update-unit-test-shard-weights.ts <report.json>...
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseUnitShardWeights, unitShardWeightsFromReports, unitShardWeightsPath, type VitestJsonReport } from './unit-test-shards';

const reports = process.argv.slice(2);
if (!reports.length) throw new Error('Pass the JSON report of every unit shard of one run.');
const root = process.cwd();
const target = path.join(root, unitShardWeightsPath);
const { overheadSeconds } = parseUnitShardWeights(readFileSync(target, 'utf8'));
const weights = unitShardWeightsFromReports(reports.map((file) => JSON.parse(readFileSync(file, 'utf8')) as VitestJsonReport), root, overheadSeconds);
writeFileSync(target, `${JSON.stringify(weights, null, 2)}\n`);
console.log(`Wrote ${Object.keys(weights.seconds).length} measured files to ${unitShardWeightsPath}.`);
