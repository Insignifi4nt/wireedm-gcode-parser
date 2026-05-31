#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

import { buildWorkbenchCacheSeed } from './playwright-workbench-cache.mjs';

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

try {
  const seed = buildWorkbenchCacheSeed({
    folder: args.folder,
    namespace: args.namespace,
    project: args.project
  });
  for (const [key, value] of seed.entries) {
    runCli(args.cli, ['localstorage-set', key, value]);
  }
  if (args.reload) {
    runCli(args.cli, ['reload']);
  }

  console.log(
    `Seeded Playwright browser cache from ${seed.folder}: ${seed.selectedProject.id} (${seed.files.length} files).`
  );
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

function parseArgs(argv) {
  const parsed = {
    cli: 'playwright-cli',
    folder: undefined,
    help: false,
    namespace: undefined,
    project: process.env.WIREDM_PLAYWRIGHT_PROJECT ?? 'latest',
    reload: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else if (arg === '--reload') {
      parsed.reload = true;
    } else if (arg === '--folder') {
      parsed.folder = readValue(argv, index, arg);
      index += 1;
    } else if (arg === '--project') {
      parsed.project = readValue(argv, index, arg);
      index += 1;
    } else if (arg === '--namespace') {
      parsed.namespace = readValue(argv, index, arg);
      index += 1;
    } else if (arg === '--cli') {
      parsed.cli = readValue(argv, index, arg);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function readValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}.`);
  }
  return value;
}

function printHelp() {
  console.log(`Seed the current playwright-cli browser with a Wire EDM workbench.

Usage:
  node scripts/seed-playwright-workbench.mjs [options]

Options:
  --folder <path>      Workbench folder. Defaults to WIREDM_PLAYWRIGHT_WORKBENCH,
                       then USERPROFILE/Documents/WireEDM_WEB_FOLDER.
  --project <id|path>  Project to seed. Defaults to latest.
  --namespace <name>   Browser-cache namespace. Defaults to wire-edm-workbench.
  --cli <command>      Browser agent command. Defaults to playwright-cli.
  --reload            Reload the current browser after seeding.
`);
}

function runCli(cli, cliArgs) {
  const result = spawnSync(cli, cliArgs, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${cli} ${cliArgs[0]} failed with exit code ${result.status}.`);
  }
}
