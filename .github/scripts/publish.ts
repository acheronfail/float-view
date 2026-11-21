import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  api,
  getNightlyRelease,
  getRelease,
  pruneNightlyTags,
  sourceMarker,
  versionMarker,
  type Release,
} from './github.ts';
import { releaseNotes, releaseNotesBase } from './notes.ts';
import { assetNames, git, parseVersion, resolveVersion, selectedPlatforms } from './version.ts';
import { ciBuildIdentity } from './build-record.ts';

const commit = process.env.GITHUB_SHA!;
const version = process.env.FLOAT_VIEW_VERSION!;
const identity = ciBuildIdentity();
parseVersion(version);
const releaseTag = process.env.GITHUB_REF?.startsWith('refs/tags/') ? process.env.GITHUB_REF.slice(10) : null;
const metadata = releaseTag ? resolveVersion(commit, releaseTag) : null;
const channel = metadata?.channel ?? 'nightly';
const tag = releaseTag ?? version;
if (metadata) {
  if (metadata.version !== version)
    throw new Error('Release publication version differs from its tag');
} else if (!version.endsWith(`.g${git(['rev-parse', '--short=12', commit])}`)) {
  throw new Error('Nightly version does not identify the build commit');
}
// Use the prepared nightly base: a newly pushed stable tag must not invalidate an in-flight build.
const stable = channel === 'stable';
const nightly = channel === 'nightly';
const files = assetNames(version, selectedPlatforms(commit));
if (files.length === 0) throw new Error('No platforms selected for publication');
for (const file of files) if (!existsSync(file)) throw new Error(`Missing release asset ${file}`);
let release = nightly ? getNightlyRelease() : getRelease(tag);
const publishedBuild = release?.body?.match(/<!-- float-view-build-number:([1-9][0-9]*) -->/)?.[1];
if (nightly && publishedBuild && Number(publishedBuild) > Number(identity.buildNumber)) {
  console.log('Preserving a Nightly built by a newer CI run.');
} else if (!nightly && release && !release.draft) {
  console.log(`${tag} is already published; preserving its assets.`);
} else {
  const previousTag = releaseNotesBase(tag, commit);
  const notes = releaseNotes(tag, commit, previousTag, process.env.GH_REPO!);
  if (nightly) {
    // Create the immutable source tag before the release so its API request never
    // needs target_commitish (which can require unavailable workflow permissions).
    const ref = api<{ object: { sha: string } }>(`git/ref/tags/${tag}`, 'GET', undefined, true);
    if (ref && ref.object.sha !== commit) throw new Error('Nightly version tag already points to another commit');
    if (!ref) api('git/refs', 'POST', { ref: `refs/tags/${tag}`, sha: commit });
  } else if (git(['rev-parse', `${tag}^{commit}`]) !== commit) {
    throw new Error('Release tag moved during publication');
  }
  if (!release) {
    release = api<Release>('releases', 'POST', {
      tag_name: tag,
      name: nightly ? 'Nightly' : version,
      draft: true,
      prerelease: !stable,
      make_latest: 'false',
    });
  }
  if (!release) throw new Error('GitHub did not return a release');
  // Upload the replacement set first. Previous nightly assets survive any failed upload.
  execFileSync('gh', ['release', 'upload', release.tag_name, ...files, '--clobber'], { stdio: 'inherit' });
  const updated = nightly ? `**Last updated:** ${new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')}\n\n` : '';
  const body = `${updated}${notes}\n\nBuild ${identity.buildNumber} · [GitHub Actions](${identity.runURL})\n\n${sourceMarker(commit)}\n${versionMarker(version)}\n<!-- float-view-build-number:${identity.buildNumber} -->`;
  api(`releases/${release.id}`, 'PATCH', {
    tag_name: tag,
    // The existing tag owns source identity. Reset API target metadata so rolling
    // releases also avoid permission checks against a previous historical SHA.
    target_commitish: 'master',
    name: nightly ? 'Nightly' : version,
    body,
    draft: false,
    prerelease: !stable,
    make_latest: stable && files.length === assetNames(version).length ? 'true' : 'false',
  });
  // Only after successful publication remove superseded nightly or interrupted draft assets.
  const current = getRelease(tag);
  if (!current) throw new Error('Published release is unavailable');
  for (const asset of current.assets) {
    if (!files.includes(asset.name)) api(`releases/assets/${asset.id}`, 'DELETE');
  }
  if (nightly) pruneNightlyTags(tag);
  console.log(`Published ${version} (${channel}).`);
}
