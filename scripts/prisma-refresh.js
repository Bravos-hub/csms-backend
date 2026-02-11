#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const generatedClientDir = path.join(rootDir, 'node_modules', '.prisma', 'client');
const prismaCliPath = path.join(rootDir, 'node_modules', 'prisma', 'build', 'index.js');
const schemaPath = path.join('prisma', 'schema.prisma');
const checkScriptPath = path.join(rootDir, 'scripts', 'prisma-check.js');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
    ...options,
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function main() {
  if (!fs.existsSync(prismaCliPath)) {
    console.error('[prisma:refresh] Local Prisma CLI is missing at `node_modules/prisma`.');
    console.error('Run `npm install` first, then run `npm run prisma:refresh` again.');
    process.exit(1);
  }

  console.log('[prisma:refresh] Removing stale generated client...');
  fs.rmSync(generatedClientDir, { recursive: true, force: true });

  console.log('[prisma:refresh] Regenerating Prisma client with local CLI...');
  run(process.execPath, [prismaCliPath, 'generate', '--schema', schemaPath]);

  console.log('[prisma:refresh] Verifying generated client...');
  run(process.execPath, [checkScriptPath]);

  console.log('[prisma:refresh] Completed successfully.');
}

main();
