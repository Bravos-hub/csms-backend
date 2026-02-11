#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const prismaEnvPath = path.join(rootDir, 'prisma', '.env');
const prismaPkgPath = path.join(rootDir, 'node_modules', 'prisma', 'package.json');
const prismaClientPkgPath = path.join(rootDir, 'node_modules', '@prisma', 'client', 'package.json');
const generatedClientDir = path.join(rootDir, 'node_modules', '.prisma', 'client');
const generatedClientPkgPath = path.join(generatedClientDir, 'package.json');
const generatedClientIndexPath = path.join(generatedClientDir, 'index.js');
const prismaRuntimeDir = path.join(rootDir, 'node_modules', '@prisma', 'client', 'runtime');

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function parseActiveEnvKeys(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  const keys = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match) {
      keys.push(match[1]);
    }
  }

  return keys;
}

function printRemediation() {
  console.error('');
  console.error('Remediation:');
  console.error('1. Keep backend env vars only in root `.env`');
  console.error('2. Make `prisma/.env` empty (or remove active key=value lines)');
  console.error('3. Rebuild generated Prisma client: `npm run prisma:refresh`');
}

function main() {
  const issues = [];

  const prismaEnvKeys = parseActiveEnvKeys(prismaEnvPath);
  if (prismaEnvKeys.length > 0) {
    issues.push(
      `Root .env policy violation: \`prisma/.env\` has active keys (${prismaEnvKeys.join(', ')}).`
    );
  }

  let prismaVersion;
  let prismaClientVersion;

  if (!fs.existsSync(prismaPkgPath)) {
    issues.push('Missing `node_modules/prisma/package.json`. Install dependencies first.');
  } else {
    prismaVersion = readJson(prismaPkgPath).version;
  }

  if (!fs.existsSync(prismaClientPkgPath)) {
    issues.push('Missing `node_modules/@prisma/client/package.json`. Install dependencies first.');
  } else {
    prismaClientVersion = readJson(prismaClientPkgPath).version;
  }

  if (prismaVersion && prismaClientVersion && prismaVersion !== prismaClientVersion) {
    issues.push(
      `Version mismatch: prisma@${prismaVersion} does not match @prisma/client@${prismaClientVersion}.`
    );
  }

  if (!fs.existsSync(generatedClientDir)) {
    issues.push('Missing generated Prisma client at `node_modules/.prisma/client`.');
  }

  if (fs.existsSync(generatedClientPkgPath) && prismaClientVersion) {
    const generatedVersion = readJson(generatedClientPkgPath).version;
    if (generatedVersion !== prismaClientVersion) {
      issues.push(
        `Generated client drift: node_modules/.prisma/client@${generatedVersion} ` +
          `does not match @prisma/client@${prismaClientVersion}.`
      );
    }
  } else if (fs.existsSync(generatedClientDir) && !fs.existsSync(generatedClientPkgPath)) {
    issues.push('Generated Prisma client package metadata is missing (`node_modules/.prisma/client/package.json`).');
  }

  if (fs.existsSync(generatedClientIndexPath)) {
    const generatedIndex = fs.readFileSync(generatedClientIndexPath, 'utf8');
    const runtimeMatches = Array.from(
      generatedIndex.matchAll(/@prisma\/client\/runtime\/([A-Za-z0-9._/-]+)/g)
    );
    const runtimeTargets = new Set(runtimeMatches.map((m) => m[1]));

    for (const runtimeTarget of runtimeTargets) {
      const runtimeFilePath = path.join(prismaRuntimeDir, runtimeTarget);
      if (!fs.existsSync(runtimeFilePath)) {
        issues.push(
          `Invalid generated runtime import target: @prisma/client/runtime/${runtimeTarget} ` +
            `does not exist at ${path.relative(rootDir, runtimeFilePath)}.`
        );
      }
    }
  } else if (fs.existsSync(generatedClientDir)) {
    issues.push('Generated Prisma client entry file is missing (`node_modules/.prisma/client/index.js`).');
  }

  if (issues.length > 0) {
    console.error('[prisma:check] Failed with the following issue(s):');
    for (const issue of issues) {
      console.error(`- ${issue}`);
    }
    printRemediation();
    process.exit(1);
  }

  console.log(
    `[prisma:check] OK - prisma@${prismaVersion} and @prisma/client@${prismaClientVersion} are aligned, generated client is valid.`
  );
}

main();
