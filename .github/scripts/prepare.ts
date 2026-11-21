import { appendFileSync, writeFileSync } from 'node:fs';
import { ciBuildIdentity } from './build-record.ts';
import { getNightlyRelease, getRelease, sourceMarker } from './github.ts';
import { assetNames, git, isAncestor, resolveVersion, selectedPlatforms } from './version.ts';

const commit = git(['rev-parse', 'HEAD']);
if (commit !== process.env.GITHUB_SHA) throw new Error('Checkout differs from workflow source');
const ref = process.env.GITHUB_REF ?? '';
const isTag = ref.startsWith('refs/tags/');
if (!isTag && ref !== 'refs/heads/master') throw new Error('Nightly builds require master');
const metadata = resolveVersion(commit, isTag ? ref.slice('refs/tags/'.length) : null, process.cwd(), 'v1.0.0');
const selected = selectedPlatforms(commit);
const iosEnabled = selected.includes('ios');
const androidEnabled = selected.includes('android');
const macosEnabled = selected.includes('macos');
const event = process.env.GITHUB_EVENT_NAME;
const delivery = process.env.FLOAT_VIEW_IOS_DELIVERY || 'none';
if (!['none', 'check', 'upload'].includes(delivery)) throw new Error('Invalid iOS delivery action');
const explicitlyRequested = process.env.FLOAT_VIEW_BUILD_IOS_STORE === 'true' || delivery !== 'none';
if (explicitlyRequested && (!isTag || event !== 'workflow_dispatch'))
  throw new Error('Manual store preparation requires a stable release tag or numbered candidate; never master or nightly');
const storeRequested = iosEnabled && isTag && (event === 'push' || (event === 'workflow_dispatch' && explicitlyRequested));
const storeDelivery = storeRequested ? (event === 'push' ? 'upload' : delivery) : 'none';
const macDelivery = process.env.FLOAT_VIEW_MAC_DELIVERY || 'none';
if (!['none', 'check', 'upload'].includes(macDelivery)) throw new Error('Invalid Mac delivery action');
const macExplicitlyRequested = process.env.FLOAT_VIEW_BUILD_MAC_STORE === 'true' || macDelivery !== 'none';
if (macExplicitlyRequested && (!isTag || event !== 'workflow_dispatch'))
  throw new Error('Manual Mac store preparation requires a stable release tag or numbered candidate; never master or nightly');
const macStoreRequested = macosEnabled && isTag && (event === 'push' || (event === 'workflow_dispatch' && macExplicitlyRequested));
const macStoreDelivery = macStoreRequested ? (event === 'push' ? 'upload' : macDelivery) : 'none';
const androidDelivery = process.env.FLOAT_VIEW_ANDROID_DELIVERY || 'none';
if (!['none', 'check', 'upload'].includes(androidDelivery)) throw new Error('Invalid Android delivery action');
const androidExplicitlyRequested = process.env.FLOAT_VIEW_BUILD_ANDROID_STORE === 'true' || androidDelivery !== 'none';
if (androidExplicitlyRequested && (!isTag || event !== 'workflow_dispatch'))
  throw new Error('Manual Android store preparation requires a stable release tag or numbered candidate; never master or nightly');
const androidStoreRequested = androidEnabled && isTag && (event === 'push' || (event === 'workflow_dispatch' && androidExplicitlyRequested));
const androidStoreDelivery = androidStoreRequested ? (event === 'push' ? 'upload' : androidDelivery) : 'none';
const identity = ciBuildIdentity();
const existing = metadata.channel === 'nightly' ? getNightlyRelease() : getRelease(metadata.tag);
const publishedSource = existing?.body?.match(/<!-- float-view-source:([0-9a-f]{40}) -->/)?.[1];
const newerNightly = publishedSource && publishedSource !== commit && isAncestor(commit, publishedSource);
const publishedBuild = existing?.body?.match(/<!-- float-view-build-number:([1-9][0-9]*) -->/)?.[1];
const newerBuild = publishedBuild && Number(publishedBuild) > Number(identity.buildNumber);
// A stable tag added after publication may change the next nightly base for the same commit.
// Check the published version's asset set so an unchanged complete nightly still skips.
const publishedVersion = existing?.body?.match(/<!-- float-view-version:(v[^\s]+) -->/)?.[1];
const expectedAssets = assetNames(publishedVersion ?? metadata.version, selected);
const completeAssets =
  existing?.assets.length === expectedAssets.length &&
  existing.assets.every((asset) => expectedAssets.includes(asset.name));
const skip =
  metadata.channel !== 'nightly'
    ? Boolean(existing && !existing.draft)
    : Boolean(
        existing &&
          !existing.draft &&
          (newerNightly || newerBuild || (completeAssets && existing.body?.includes(sourceMarker(commit))))
      );
const output = {
  ...metadata, iosEnabled, androidEnabled, macosEnabled,
  storeBuild: String(storeRequested), storeDelivery, macStoreBuild: String(macStoreRequested), macStoreDelivery,
  androidStoreBuild: String(androidStoreRequested), androidStoreDelivery,
  buildNumber: identity.buildNumber, runURL: identity.runURL,
  buildRecordArtifact: `build-record-${identity.attempt}`, commit, skip: String(selected.length === 0 || skip),
};
writeFileSync(process.env.FLOAT_VIEW_BUILD_RECORD!, JSON.stringify({ schema: 1, ...identity, ...metadata, commit }, null, 2) + '\n');
appendFileSync(
  process.env.GITHUB_OUTPUT!,
  Object.entries(output)
    .map(([key, value]) => `${key}=${value}\n`)
    .join('')
);
console.log(JSON.stringify(output));
