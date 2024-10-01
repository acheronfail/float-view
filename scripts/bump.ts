import { readFile, writeFile } from 'node:fs/promises';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import semver, { ReleaseType } from 'semver';

/**
 * Script
 */

// get current version
const versionString = env('npm_package_version');
const version = semver.parse(versionString);
if (!version) {
  throw new Error(`Unable to parse version: ${versionString}`);
}

// get commit message
const { stdout } = await promisify(exec)('git log -1 --pretty="%B"');
const commitMessage = stdout.trim();
if (commitMessage.startsWith('[skip ci]')) {
  process.exit(0);
}

// extract commit message prefix
const match = /^(major|minor|patch):/.exec(commitMessage);
if (!match || !match[1]) {
  throw new Error(`Commit message must start with 'major:', 'minor:' or 'patch:'`);
}

// bump version in package.json
const newVersion = version.inc(match[1] as ReleaseType).format();
const pkgJsonPath = env('npm_package_json');
const pkgJson = JSON.parse(await readFile(pkgJsonPath, 'utf-8'));
pkgJson.version = newVersion;
await writeFile(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + '\n');

/**
 * Helpers
 */

function env(key: string): string {
  const val = process.env[key];
  if (!val) {
    throw new Error(`Expected ${key} to be set in the environment`);
  }

  return val;
}
