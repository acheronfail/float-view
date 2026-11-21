import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const integer = '(0|[1-9][0-9]*)';
const stablePattern = new RegExp(`^v${integer}\\.${integer}\\.${integer}$`);
const candidatePattern = new RegExp(`^v${integer}\\.${integer}\\.${integer}-rc\\.([1-9][0-9]*)$`);
const displayPattern = new RegExp(
  `^v${integer}\\.${integer}\\.${integer}(?:-nightly\\.${integer}\\.g[0-9a-f]{7,40}|-rc\\.([1-9][0-9]*))?$`
);
export type Bump = 'patch' | 'minor' | 'major';

export function isNightlyVersion(value: string): boolean {
  return value.includes('-nightly.') && displayPattern.test(value);
}

export function isCandidateVersion(value: string): boolean {
  return candidatePattern.test(value);
}

export function parseVersion(value: string) {
  const match = displayPattern.exec(value);
  if (!match || match[0] !== value) throw new Error(`Invalid app version: ${value}`);
  const parts = match.slice(1, 4).map(Number);
  if (!parts.every(Number.isSafeInteger)) throw new Error('Version components exceed safe integers');
  if (match[5] && !Number.isSafeInteger(Number(match[5]))) throw new Error('Candidate number exceeds safe integers');
  return { major: parts[0]!, minor: parts[1]!, patch: parts[2]!, appVersion: parts.join('.') };
}

export function bumpVersion(value: string, bump: Bump): string {
  if (!stablePattern.test(value)) throw new Error('A stable base version is required');
  const { major, minor, patch } = parseVersion(value);
  const next =
    bump === 'major'
      ? `v${major + 1}.0.0`
      : bump === 'minor'
        ? `v${major}.${minor + 1}.0`
        : `v${major}.${minor}.${patch + 1}`;
  parseVersion(next);
  return next;
}

const platforms = ['ios', 'android', 'macos'] as const;
type Platform = typeof platforms[number];

export function selectedPlatforms(commit: string, cwd = process.cwd()): readonly Platform[] {
  const message = git(['show', '-s', '--format=%B', commit], cwd);
  return platforms.filter(platform => !message.includes(`[skip ${platform}]`));
}

export function assetNames(version: string, selected: readonly Platform[] = platforms): string[] {
  parseVersion(version);
  const names = {
    ios: `FloatView-${version}.ipa`,
    android: `FloatView-${version}.apk`,
    macos: `FloatView-${version}-macos-universal.zip`,
  };
  return selected.map(platform => names[platform]);
}

export function buildNumber(value: string | undefined): string {
  if (!value || !/^[1-9][0-9]*$/.test(value) || Number(value) > 2_100_000_000) {
    throw new Error('FLOAT_VIEW_BUILD_NUMBER must be a positive integer no greater than 2100000000');
  }
  return value;
}

export function git(args: string[], cwd = process.cwd()): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function isAncestor(ancestor: string, descendant: string, cwd = process.cwd()): boolean {
  const result = spawnSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], { cwd, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0 && result.status !== 1) throw new Error(result.stderr || 'Cannot resolve Git ancestry');
  return result.status === 0;
}

function compareStable(left: string, right: string): number {
  const a = parseVersion(left),
    b = parseVersion(right);
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

export function latestStable(commit: string, cwd = process.cwd(), before?: string): string | null {
  const candidates = git(['tag', '--list'], cwd)
    .split('\n')
    .filter((tag) => stablePattern.test(tag) && (!before || compareStable(tag, before) < 0));
  candidates.sort((a, b) => compareStable(b, a));
  return candidates.find((tag) => isAncestor(tag, commit, cwd)) ?? null;
}

// Incremental RC/nightly notes advance through milestones; nightly tags are not milestones.
export function compareRelease(left: string, right: string): number {
  const version = compareStable(left, right);
  if (version) return version;
  const a = candidatePattern.exec(left), b = candidatePattern.exec(right);
  if (!a) return b ? 1 : 0;
  if (!b) return -1;
  return Number(a[4]) - Number(b[4]);
}

export function latestRelease(commit: string, cwd = process.cwd(), before?: string): string | null {
  const candidates = git(['tag', '--list'], cwd).split('\n')
    .filter(tag => (stablePattern.test(tag) || isCandidateVersion(tag)) &&
      (!before || compareRelease(tag, before) < 0));
  candidates.sort((a, b) => compareRelease(b, a));
  return candidates.find(tag => isAncestor(tag, commit, cwd)) ?? null;
}

export function resolveVersion(commit: string, tag: string | null, cwd = process.cwd(), launchTarget?: string) {
  if (tag !== null) {
    if (!stablePattern.test(tag) && !isCandidateVersion(tag))
      throw new Error('Release tags must match vX.Y.Z or vX.Y.Z-rc.N exactly');
    parseVersion(tag);
    if (git(['rev-parse', `${tag}^{commit}`], cwd) !== commit)
      throw new Error('Release tag does not match the build commit');
    if (!isAncestor(commit, 'origin/master', cwd)) throw new Error('Release commit must be in origin/master history');
    return { version: tag, appVersion: parseVersion(tag).appVersion,
      channel: isCandidateVersion(tag) ? 'candidate' : 'stable', tag, configuration: 'Release' };
  }
  const base = latestStable(commit, cwd);
  if (launchTarget && !stablePattern.test(launchTarget)) throw new Error('Launch target must be a stable version');
  const preparingLaunch = launchTarget && (!base || compareStable(base, launchTarget) < 0);
  // Count all reachable commits before launch, so removing old v0.x tags cannot
  // renumber the preparation channel. After launch use the stable ancestor.
  const count = git(['rev-list', '--count', ...(base && !preparingLaunch ? [`${base}..${commit}`] : [commit])], cwd);
  const sha = git(['rev-parse', '--short=12', commit], cwd);
  const next = preparingLaunch ? launchTarget : bumpVersion(base ?? 'v0.0.0', 'patch');
  const version = `${next}-nightly.${count}.g${sha}`;
  return {
    version,
    appVersion: parseVersion(version).appVersion,
    channel: 'nightly',
    tag: version,
    configuration: 'Debug',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] !== 'native') throw new Error('Usage: version.ts native');
  const version = parseVersion(process.env.FLOAT_VIEW_VERSION ?? '');
  console.log(`${version.appVersion} ${buildNumber(process.env.FLOAT_VIEW_BUILD_NUMBER)}`);
}
