import { readFile, writeFile } from 'node:fs/promises';
import { exec } from 'node:child_process';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import semver, { ReleaseType } from 'semver';

/**
 * Script
 */

const versionString = env('npm_package_version');
const version = semver.parse(versionString);
if (!version) {
  throw new Error(`Unable to parse version: ${versionString}`);
}

const { stdout } = await promisify(exec)('git log -1 --pretty="%B"');
const commitMessage = stdout.trim();
if (commitMessage.startsWith('[skip ci]')) {
  process.exit(0);
}

const match = /^(major|minor|patch):/.exec(commitMessage);
if (!match || !match[1]) {
  throw new Error(`Commit message must start with 'major:', 'minor:' or 'patch:'`);
}

const newVersion = version.inc(match[1] as ReleaseType).format();
await updatePkgFile(env('npm_package_json'));
await updatePkgFile(join(dirname(env('npm_package_json')), 'package-lock.json'));

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

async function updatePkgFile(path: string) {
  const pkgJson = JSON.parse(await readFile(path, 'utf-8'));
  pkgJson.version = newVersion;
  await writeFile(path, JSON.stringify(pkgJson, null, 2) + '\n');
}
