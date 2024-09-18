import { readFile, writeFile } from 'node:fs/promises';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import semver, { ReleaseType } from 'semver';

function env(key: string): string {
  const val = process.env[key];
  if (!val) {
    throw new Error(`Expected ${key} to be set in the environment`);
  }

  return val;
}

const versionString = env('npm_package_version');
const version = semver.parse(versionString);
if (!version) {
  throw new Error(`Unable to parse version: ${versionString}`);
}

const { stdout: commitMessage } = await promisify(exec)('git log -1 --pretty="%B"');

const match = /^(major|minor|patch):/.exec(commitMessage.trim());
if (!match || !match[1]) {
  throw new Error(`Commit message must start with 'major:', 'minor:' or 'patch:'`);
}

const pkgJsonPath = env('npm_package_json');
const pkgJson = JSON.parse(await readFile(pkgJsonPath, 'utf-8'));
pkgJson.version = version.inc(match[1] as ReleaseType).format();
await writeFile(pkgJsonPath, JSON.stringify(pkgJson, null, 2));
