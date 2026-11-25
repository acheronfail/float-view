import { readSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { releaseNotes, releaseNotesBase } from './notes.ts';
import { bumpVersion, compareRelease, git, isCandidateVersion, latestStable, parseVersion, type Bump } from './version.ts';

export function preview(ref = 'HEAD', cwd = process.cwd()) {
  const commit = git(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], cwd);
  const version = bumpVersion(latestStable(commit, cwd) ?? 'v0.0.0', 'patch');
  const previousTag = releaseNotesBase(version, commit, cwd);
  const notes = releaseNotes(version, commit, previousTag, process.env.GH_REPO ?? 'acheronfail/float-view', cwd);
  return { commit, previousTag, version, notes };
}

function confirmRelease(version: string, commit: string): boolean {
  process.stderr.write(
    `Create tag ${version} at ${commit} and push it to origin? This starts the release workflow. [y/N] `
  );
  const byte = Buffer.alloc(1);
  let answer = '';
  while (answer.length < 1024) {
    if (readSync(0, byte, 0, 1, null) === 0) return false;
    if (byte[0] === 10) return /^(y|yes)$/i.test(answer.trim());
    answer += byte.toString();
  }
  return false;
}

export function release(
  bump = '',
  cwd = process.cwd(),
  candidateBump?: string,
  confirm: (version: string, commit: string) => boolean = confirmRelease
): string {
  if (!['', 'patch', 'minor', 'major', 'candidate'].includes(bump))
    throw new Error('Usage: just release [patch|minor|major|candidate]');
  if (candidateBump !== undefined && (bump !== 'candidate' || !['patch', 'minor', 'major'].includes(candidateBump)))
    throw new Error('Usage: just release candidate [patch|minor|major]');
  if (git(['status', '--porcelain'], cwd)) throw new Error('Release requires a clean working tree');
  if (git(['branch', '--show-current'], cwd) !== 'master') throw new Error('Release requires the master branch');
  git(
    ['fetch', 'origin', '--no-tags', '+refs/heads/master:refs/remotes/origin/master', 'refs/tags/v*:refs/tags/v*'],
    cwd
  );
  const commit = git(['rev-parse', 'HEAD'], cwd);
  if (commit !== git(['rev-parse', 'origin/master'], cwd))
    throw new Error('Master must match origin/master; push or pull first');
  const stable = latestStable(commit, cwd);
  const base = stable ?? 'v0.0.0';
  const candidates = git(['tag', '--list', '--merged', commit], cwd)
    .split('\n')
    .filter((tag) => isCandidateVersion(tag) && (!stable || compareRelease(tag, stable) > 0))
    .sort(compareRelease);
  process.stderr.write(
    `Current release candidates since ${stable ?? 'the start of history'}:\n` +
    (candidates.length ? candidates.map((tag) => `  ${tag}\n`).join('') : '  (none)\n')
  );
  let version: string;
  if (bump === 'candidate') {
    const target = candidateBump
      ? bumpVersion(base, candidateBump as Bump)
      : parseVersion(base).major < 1
        ? 'v1.0.0'
        : bumpVersion(base, 'patch');
    if (git(['tag', '--list', target], cwd)) throw new Error(`Stable version ${target} is already reserved`);
    const prefix = `${target}-rc.`;
    const numbers = git(['tag', '--list', `${prefix}*`], cwd)
      .split('\n')
      .map((tag) => tag.slice(prefix.length))
      .filter((value) => /^[1-9][0-9]*$/.test(value))
      .map(Number);
    version = `${prefix}${Math.max(0, ...numbers) + 1}`;
    parseVersion(version);
  } else {
    const latestCandidate = candidates.at(-1);
    version = !bump && latestCandidate
      ? `v${parseVersion(latestCandidate).appVersion}`
      : bumpVersion(base, (bump || 'patch') as Bump);
  }
  if (git(['tag', '--list', version], cwd)) throw new Error(`Tag ${version} is already reserved`);
  if (!confirm(version, commit)) throw new Error('Release cancelled; no tag created or pushed');
  git(['tag', '-a', version, '-m', `Float View ${version}`, commit], cwd);
  // Keep the local tag on a failed push so a retry cannot accidentally select another commit.
  git(['push', 'origin', `refs/tags/${version}:refs/tags/${version}`], cwd);
  return version;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const action = process.argv[2] ?? '';
  const ref = process.argv[3];
  if (process.argv.length > 4 || (!['preview', 'candidate'].includes(action) && ref))
    throw new Error(
      'Usage: just release [patch|minor|major], just release candidate [patch|minor|major], or just release preview [ref]'
    );
  if (action === 'preview') {
    const result = preview(ref);
    console.error(
      `Previewing ${result.version}: ${result.previousTag ?? 'start of history'}..${ref ?? 'HEAD'} (${result.commit})`
    );
    console.log(result.notes);
  } else {
    console.log(`Pushed ${release(action, process.cwd(), ref)}; the tag starts the release workflow.`);
  }
}
