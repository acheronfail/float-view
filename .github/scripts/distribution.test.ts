import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { afterEach, test } from 'node:test';
import { assetNames, git, resolveVersion } from './version.ts';
import type { Release } from './github.ts';

const directories: string[] = [];
afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});
interface State {
  releases: Release[];
  actions: string[];
  fail?: string;
  refs?: Record<string, string>;
}
const fakeGh = `#!/usr/bin/env node
const fs = require('node:fs');
const path = process.env.FAKE_GH_STATE;
const state = JSON.parse(fs.readFileSync(path, 'utf8'));
const args = process.argv.slice(2);
let result = null;
function save() { fs.writeFileSync(path, JSON.stringify(state)); }
function fail(message) { save(); console.error(message); process.exit(1); }
if (args[0] === 'api') {
  const endpoint = args[1].replace('repos/test/repo/', '');
  const method = args[args.indexOf('--method') + 1];
  const body = args.includes('--input') ? JSON.parse(fs.readFileSync(0, 'utf8')) : null;
  state.actions.push(method + ' ' + endpoint);
  if (state.fail === 'api') fail('gh: Bad credentials (HTTP 401)');
  if (endpoint.startsWith('releases/tags/')) {
    result = state.releases.find(r => r.tag_name === endpoint.slice(14) && !r.draft);
    if (!result) fail('gh: Not Found (HTTP 404)');
  } else if (endpoint.startsWith('releases?')) result = state.releases;
  else if (endpoint.startsWith('tags?')) {
    const page = Number(new URLSearchParams(endpoint.slice(5)).get('page'));
    result = Object.keys(state.refs ?? {}).slice((page - 1) * 100, page * 100).map(name => ({ name }));
  } else if (endpoint.startsWith('git/refs/tags/') && method === 'DELETE') {
    delete state.refs[decodeURIComponent(endpoint.slice('git/refs/tags/'.length))];
  } else if (endpoint === 'releases' && method === 'POST') {
    // GitHub checks workflow permissions on explicit historical targets even
    // when the tag exists. Publication must use an existing tag without a target.
    if (body.target_commitish) fail('gh: Resource not accessible by integration (HTTP 403)');
    const tagged = state.refs?.[body.tag_name] || require('node:child_process').spawnSync('git', ['rev-parse', '--verify', body.tag_name], { encoding: 'utf8' }).status === 0;
    if (!tagged) fail('Release tag must already exist');
    result = { ...body, id: 100 + state.releases.length, assets: [] }; state.releases.push(result);
  } else if (/^releases\\/assets\\/\\d+$/.test(endpoint)) {
    const id = Number(endpoint.split('/').pop());
    for (const r of state.releases) r.assets = r.assets.filter(a => a.id !== id);
  } else if (/^releases\\/\\d+$/.test(endpoint)) {
    result = state.releases.find(r => r.id === Number(endpoint.split('/').pop()));
    if ((body.target_commitish ?? result.target_commitish ?? 'master') !== 'master') fail('gh: Resource not accessible by integration (HTTP 403)');
    if (state.fail === 'publish' && body.draft === false) fail('gh: Service Unavailable (HTTP 503)');
    Object.assign(result, body);
  } else if (endpoint.startsWith('git/ref/tags/')) {
    const sha = state.refs?.[endpoint.slice('git/ref/tags/'.length)];
    if (!sha) fail('gh: Not Found (HTTP 404)');
    result = { object: { sha } };
  } else if (endpoint === 'git/refs') {
    state.refs ??= {}; state.refs[body.ref.slice('refs/tags/'.length)] = body.sha;
  }
  else fail('Unhandled API endpoint: ' + method + ' ' + endpoint);
} else if (args[0] === 'release' && args[1] === 'upload') {
  state.actions.push('upload ' + args[2]);
  const r = state.releases.find(r => r.tag_name === args[2]);
  const files = args.slice(3).filter(a => !a.startsWith('--'));
  for (const file of files) {
    r.assets = r.assets.filter(a => a.name !== file);
    r.assets.push({ id: 1000 + state.actions.length * 10 + r.assets.length, name: file });
    if (state.fail === 'upload') fail('Upload interrupted');
  }
} else fail('Unhandled gh command');
save();
if (result !== null) console.log(JSON.stringify(result));
`;

function fixture(message = 'app: Show live telemetry') {
  const cwd = mkdtempSync(join(tmpdir(), 'float-distribution-'));
  directories.push(cwd);
  git(['init', '-b', 'master', cwd]);
  git(['config', 'user.email', 'test@example.invalid'], cwd);
  git(['config', 'user.name', 'Test'], cwd);
  git(['-c', 'core.hooksPath=/dev/null', 'commit', '--allow-empty', '-m', 'base'], cwd);
  git(['tag', 'v0.1.49'], cwd);
  git(['-c', 'core.hooksPath=/dev/null', 'commit', '--allow-empty', '-m', message], cwd);
  const sha = git(['rev-parse', 'HEAD'], cwd);
  git(['update-ref', 'refs/remotes/origin/master', sha], cwd);
  const metadata = resolveVersion(sha, null, cwd, 'v1.0.0');
  const statePath = join(cwd, 'state.json');
  const executable = join(cwd, 'gh');
  writeFileSync(executable, fakeGh);
  chmodSync(executable, 0o755);
  function save(state: State) {
    writeFileSync(statePath, JSON.stringify(state));
  }
  function state(): State {
    return JSON.parse(readFileSync(statePath, 'utf8'));
  }
  save({ releases: [], actions: [] });
  for (const file of assetNames(metadata.version)) writeFileSync(join(cwd, file), 'package');
  const env = {
    ...process.env,
    PATH: `${cwd}${delimiter}${process.env.PATH}`,
    FAKE_GH_STATE: statePath,
    GH_REPO: 'test/repo',
    GITHUB_SHA: sha,
    GITHUB_REF: 'refs/heads/master',
    GITHUB_RUN_NUMBER: '60',
    GITHUB_RUN_ID: '38863449266',
    GITHUB_RUN_ATTEMPT: '1',
    GITHUB_REPOSITORY: 'test/repo',
    GITHUB_WORKFLOW_REF: 'test/repo/.github/workflows/build-apps.yml@refs/heads/master',
    GITHUB_SERVER_URL: 'https://github.com',
    FLOAT_VIEW_BUILD_RECORD: join(cwd, 'build-record.json'),
    FLOAT_VIEW_VERSION: metadata.version,
    GITHUB_OUTPUT: join(cwd, 'outputs'),
  };
  function run(script: string, overrides: Record<string, string> = {}) {
    return spawnSync(process.execPath, ['--strip-types', new URL(`./${script}.ts`, import.meta.url).pathname], {
      cwd,
      env: { ...env, ...overrides },
      encoding: 'utf8',
    });
  }
  return { cwd, sha, metadata, save, state, run, output: () => readFileSync(env.GITHUB_OUTPUT, 'utf8') };
}

test('nightly preparation, publish and unchanged skip preserve bounded assets', () => {
  const f = fixture();
  assert.equal(f.run('prepare').status, 0);
  assert.match(f.output(), /skip=false/);
  const publicationStarted = Date.now();
  assert.equal(f.run('publish').status, 0);
  let state = f.state();
  assert.equal(state.releases.length, 1);
  assert.equal(state.releases[0]!.draft, false);
  assert.equal(state.releases[0]!.tag_name, f.metadata.version);
  assert.equal(state.refs?.[f.metadata.version], f.sha);
  assert.deepEqual(
    state.releases[0]!.assets.map((a) => a.name),
    assetNames(f.metadata.version)
  );
  assert.match(state.releases[0]!.body!, new RegExp(f.sha));
  const updated = /^\*\*Last updated:\*\* (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC)\n\n/.exec(state.releases[0]!.body!);
  assert.ok(updated);
  const updatedAt = Date.parse(updated[1]!);
  assert.ok(updatedAt >= Math.floor(publicationStarted / 1000) * 1000 && updatedAt <= Date.now());
  assert.match(state.releases[0]!.body!, /## App\n\n- Show live telemetry/);
  assert.ok(state.releases[0]!.body!.includes(`v0.1.49...${f.metadata.version}`));
  assert.doesNotMatch(state.releases[0]!.body!, /AltStore|notarized|from commit/);
  assert.equal(f.run('prepare').status, 0);
  assert.match(f.output(), /skip=true/);
  // A stale asset from an interrupted cleanup must trigger a repair, not a skip.
  state.releases[0]!.assets.push({ id: 1, name: 'old.apk' });
  f.save(state);
  assert.equal(f.run('prepare').status, 0);
  assert.ok(f.output().endsWith('skip=false\n'));
  assert.equal(f.run('publish').status, 0);
  state = f.state();
  assert.equal(state.releases[0]!.assets.length, 3);
});

test('failed replacement upload retains previous nightly and retries successfully', () => {
  const f = fixture();
  const previous: Release = {
    id: 1,
    tag_name: 'nightly',
    name: 'Nightly',
    prerelease: true,
    draft: false,
    body: 'previous successful nightly',
    target_commitish: 'historical-workflow-commit',
    assets: [{ id: 1, name: 'previous.ipa' }],
  };
  f.save({ releases: [previous], actions: [], fail: 'upload', refs: { nightly: 'previous-sha' } });
  assert.notEqual(f.run('publish').status, 0);
  let state = f.state();
  assert.equal(state.releases[0]!.body, previous.body);
  assert.ok(state.releases[0]!.assets.some((a) => a.name === 'previous.ipa'));
  assert.equal(state.refs?.nightly, 'previous-sha');
  delete state.fail;
  f.save(state);
  assert.equal(f.run('publish').status, 0);
  state = f.state();
  assert.equal(state.releases[0]!.assets.length, 3);
  const uploaded = state.actions.lastIndexOf('upload nightly');
  const deleted = state.actions.findIndex((a) => a.startsWith('DELETE'));
  assert.ok(deleted > uploaded);
});

test('API failure aborts preparation instead of creating a release', () => {
  const f = fixture();
  f.save({ releases: [], actions: [], fail: 'api' });
  const result = f.run('prepare');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /401/);
  assert.equal(f.state().releases.length, 0);
});

test('stable publication resumes a failed draft and never clobbers a published release', () => {
  const f = fixture();
  git(['tag', '-a', 'v0.2.0', '-m', 'release'], f.cwd);
  git(['-c', 'core.hooksPath=/dev/null', 'commit', '--allow-empty', '-m', 'advance master'], f.cwd);
  git(['update-ref', 'refs/remotes/origin/master', git(['rev-parse', 'HEAD'], f.cwd)], f.cwd);
  git(['checkout', '--detach', f.sha], f.cwd);
  const overrides = { GITHUB_REF: 'refs/tags/v0.2.0', FLOAT_VIEW_VERSION: 'v0.2.0', GITHUB_RUN_NUMBER: '3' };
  for (const file of assetNames('v0.2.0')) writeFileSync(join(f.cwd, file), 'stable');
  f.save({ releases: [], actions: [], fail: 'publish', refs: { 'v0.1.50-nightly.0.gabcdef012345': f.sha } });
  assert.notEqual(f.run('publish', overrides).status, 0);
  let state = f.state();
  assert.equal(state.releases.length, 1);
  assert.equal(state.releases[0]!.draft, true);
  delete state.fail;
  f.save(state);
  assert.equal(f.run('publish', overrides).status, 0);
  state = f.state();
  assert.equal(state.releases.length, 1);
  assert.equal(state.releases[0]!.draft, false);
  assert.equal(state.refs?.['v0.1.50-nightly.0.gabcdef012345'], f.sha);
  assert.ok(!state.actions.some(action => action.startsWith('DELETE git/refs/tags/')));
  assert.match(state.releases[0]!.body!, /v0\.1\.49\.\.\.v0\.2\.0/);
  assert.doesNotMatch(state.releases[0]!.body!, /Last updated:/);
  const uploads = state.actions.filter((a) => a.startsWith('upload')).length;
  assert.equal(f.run('publish', overrides).status, 0);
  assert.equal(f.state().actions.filter((a) => a.startsWith('upload')).length, uploads);
  assert.equal(f.run('prepare', overrides).status, 0);
  assert.match(f.output(), /configuration=Release/);
  assert.match(f.output(), /buildNumber=63/);
  assert.match(f.output(), /skip=true/);
});

test('nightly preparation skips older reruns and rejects manual builds from other branches', () => {
  const f = fixture();
  git(['-c', 'core.hooksPath=/dev/null', 'commit', '--allow-empty', '-m', 'newer development'], f.cwd);
  const newer = git(['rev-parse', 'HEAD'], f.cwd);
  git(['update-ref', 'refs/remotes/origin/master', newer], f.cwd);
  f.save({
    releases: [
      {
        id: 1,
        tag_name: 'nightly',
        name: 'Nightly',
        prerelease: true,
        draft: false,
        body: `<!-- float-view-source:${newer} -->`,
        assets: [],
      },
    ],
    actions: [],
  });
  git(['checkout', '--detach', f.sha], f.cwd);
  assert.equal(f.run('prepare').status, 0);
  assert.match(f.output(), /skip=true/);
  const invalid = f.run('prepare', { GITHUB_REF: 'refs/heads/feature' });
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /require master/);
});

test('a new stable tag during a nightly build does not change its prepared package version', () => {
  const f = fixture();
  assert.equal(f.run('prepare').status, 0);
  git(['tag', 'v0.2.0'], f.cwd);
  assert.equal(f.run('publish').status, 0);
  assert.match(f.state().releases[0]!.body!, new RegExp(f.metadata.version));
  assert.equal(f.run('prepare').status, 0);
  assert.ok(f.output().endsWith('skip=true\n'));
});

test('publication failure preserves the previous nightly body and assets for retry', () => {
  const f = fixture();
  f.save({
    releases: [
      {
        id: 1,
        tag_name: 'nightly',
        name: 'Nightly',
        prerelease: true,
        draft: false,
        body: 'previous notes',
        assets: [{ id: 1, name: 'previous.ipa' }],
      },
    ],
    actions: [],
    fail: 'publish',
  });
  assert.notEqual(f.run('publish').status, 0);
  const state = f.state();
  assert.equal(state.releases[0]!.body, 'previous notes');
  assert.ok(state.releases[0]!.assets.some((asset) => asset.name === 'previous.ipa'));
  delete state.fail;
  f.save(state);
  assert.equal(f.run('publish').status, 0);
  assert.match(f.state().releases[0]!.body!, /## App\n\n- Show live telemetry/);
  assert.equal(f.state().releases[0]!.assets.length, 3);
});

test('a newer nightly retains release identity while advancing its version tag and replacing assets', () => {
  const f = fixture();
  assert.equal(f.run('publish').status, 0);
  const initial = f.state().releases[0]!;
  const previous = f.state();
  previous.releases[0]!.body = '**Last updated:** 2000-01-01 00:00:00 UTC\n\nPrevious notes';
  f.save(previous);
  git(['-c', 'core.hooksPath=/dev/null', 'commit', '--allow-empty', '-m', 'next nightly'], f.cwd);
  const commit = git(['rev-parse', 'HEAD'], f.cwd);
  git(['update-ref', 'refs/remotes/origin/master', commit], f.cwd);
  const next = resolveVersion(commit, null, f.cwd, 'v1.0.0');
  for (const file of assetNames(next.version)) writeFileSync(join(f.cwd, file), 'next package');
  const overrides = { GITHUB_SHA: commit, FLOAT_VIEW_VERSION: next.version };
  assert.equal(f.run('prepare', overrides).status, 0);
  assert.ok(f.output().endsWith('skip=false\n'));
  assert.equal(f.run('publish', overrides).status, 0);
  const state = f.state();
  assert.equal(state.releases.length, 1);
  assert.equal(state.releases[0]!.id, initial.id);
  assert.equal(state.releases[0]!.tag_name, next.version);
  assert.match(state.releases[0]!.body!, /^\*\*Last updated:\*\* /);
  assert.doesNotMatch(state.releases[0]!.body!, /2000-01-01|Previous notes/);
  assert.deepEqual(
    state.releases[0]!.assets.map((asset) => asset.name),
    assetNames(next.version)
  );
  assert.equal(state.refs?.[initial.tag_name], undefined);
  assert.equal(state.refs?.[next.version], commit);
  assert.equal(f.run('prepare', overrides).status, 0);
  assert.ok(f.output().endsWith('skip=true\n'));
});

test('a conflicting nightly version tag is not overwritten', () => {
  const f = fixture();
  f.save({ releases: [], actions: [], refs: { [f.metadata.version]: 'another-commit' } });
  const result = f.run('publish');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /already points to another commit/);
  assert.equal(f.state().refs?.[f.metadata.version], 'another-commit');
  assert.equal(f.state().releases.length, 0);
});

test('nightly cleanup paginates before deleting and preserves current, stable and unrelated tags', () => {
  const f = fixture();
  const obsolete = Array.from({ length: 105 }, (_, i) => `v0.1.50-nightly.${i}.gabcdef012345`);
  const retained = ['v0.1.49', 'v1.0.0-rc.1', 'nightly', 'backup-nightly.1.gabcdef012345', 'v0.1.50-nightly.invalid'];
  f.save({ releases: [], actions: [], refs: Object.fromEntries([...obsolete, ...retained].map(tag => [tag, f.sha])) });
  assert.equal(f.run('publish').status, 0);
  const state = f.state();
  assert.deepEqual(Object.keys(state.refs!).sort(), [...retained, f.metadata.version].sort());
  const deleted = state.actions.findIndex(action => action.startsWith('DELETE git/refs/tags/'));
  assert.ok(deleted > state.actions.indexOf('GET tags?per_page=100&page=2'));
  assert.ok(deleted > state.actions.indexOf('PATCH releases/100'));
});

test('failed nightly publication leaves previous version tags intact', () => {
  const f = fixture();
  const oldTag = 'v0.1.50-nightly.0.gabcdef012345';
  f.save({ releases: [], actions: [], refs: { [oldTag]: f.sha }, fail: 'publish' });
  assert.notEqual(f.run('publish').status, 0);
  assert.equal(f.state().refs?.[oldTag], f.sha);
  assert.ok(!f.state().actions.some(action => action.startsWith('DELETE git/refs/tags/')));
  const state = f.state();
  delete state.fail;
  f.save(state);
  assert.equal(f.run('publish').status, 0);
  assert.equal(f.state().refs?.[oldTag], undefined);
});

test('CI build record and release link use the shared number; older retries cannot downgrade Nightly', () => {
  const f = fixture();
  assert.equal(f.run('prepare').status, 0);
  const record = JSON.parse(readFileSync(join(f.cwd, 'build-record.json'), 'utf8'));
  assert.equal(record.buildNumber, '120');
  assert.equal(record.commit, f.sha);
  assert.equal(record.runId, '38863449266');
  assert.equal(f.run('publish').status, 0);
  const state = f.state();
  assert.match(state.releases[0]!.body!, /Build 120.*actions\/runs\/38863449266/);
  state.releases[0]!.body = state.releases[0]!.body!.replace('float-view-build-number:120', 'float-view-build-number:121');
  f.save(state);
  const uploads = state.actions.filter(x => x.startsWith('upload')).length;
  assert.equal(f.run('prepare').status, 0);
  assert.ok(f.output().endsWith('skip=true\n'));
  assert.equal(f.run('publish').status, 0);
  assert.equal(f.state().actions.filter(x => x.startsWith('upload')).length, uploads);
});

test('store jobs follow stable release tags and reject master/nightly preparation', () => {
  const f = fixture();
  for (const event of ['push', 'workflow_dispatch']) {
    assert.equal(f.run('prepare', { GITHUB_EVENT_NAME: event }).status, 0);
    assert.match(f.output(), /storeBuild=false/);
    for (const request of [{ FLOAT_VIEW_BUILD_IOS_STORE: 'true' }, { FLOAT_VIEW_IOS_DELIVERY: 'check' }] as Record<string, string>[]) {
      const result = f.run('prepare', { ...request, GITHUB_EVENT_NAME: event });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /stable release tag/);
    }
  }
  git(['tag', 'v1.0.0'], f.cwd);
  const release = { GITHUB_REF: 'refs/tags/v1.0.0', GITHUB_EVENT_NAME: 'push', GITHUB_RUN_NUMBER: '61' };
  assert.equal(f.run('prepare', release).status, 0);
  assert.match(f.output(), /storeBuild=true\nstoreDelivery=upload/);
  assert.match(f.output(), /buildNumber=121/);
  assert.match(f.output(), /configuration=Release/);
  assert.ok(f.output().endsWith('skip=false\n'));
  // A fresh store retry uses the existing immutable release tag even if GitHub is published.
  f.save({ releases: [{ id: 200, tag_name: 'v1.0.0', name: 'v1.0.0', prerelease: false, draft: false, body: '', assets: [] }], actions: [] });
  assert.equal(f.run('prepare', { ...release, GITHUB_EVENT_NAME: 'workflow_dispatch',
    FLOAT_VIEW_IOS_DELIVERY: 'check', GITHUB_RUN_NUMBER: '62' }).status, 0);
  assert.match(f.output(), /storeBuild=true\nstoreDelivery=check/);
  assert.match(f.output(), /buildNumber=122/);
  assert.ok(f.output().endsWith('skip=true\n'));
  assert.equal(f.run('prepare', { ...release, GITHUB_EVENT_NAME: 'workflow_dispatch' }).status, 0);
  assert.match(f.output(), /storeBuild=false/);
  for (const tag of ['v1.0.0-nightly.1.gabcdef0', 'v01.0.0', 'v1.0.0-rc.0', 'v1.0.0-rc.01', 'v1.0.0-beta.1']) {
    git(['tag', tag], f.cwd);
    assert.notEqual(f.run('prepare', { ...release, GITHUB_REF: 'refs/tags/' + tag }).status, 0);
  }
});

test('candidate preparation and publication isolate prereleases from Nightly and Latest', () => {
  const f = fixture();
  git(['tag', '-a', 'v1.0.0-rc.1', '-m', 'candidate'], f.cwd);
  const nightly: Release = { id: 1, tag_name: 'nightly', name: 'Nightly', prerelease: true,
    draft: false, body: 'retained nightly', assets: [{ id: 1, name: 'nightly.ipa' }] };
  const stable: Release = { id: 2, tag_name: 'v0.1.49', name: 'v0.1.49', prerelease: false,
    draft: false, body: 'retained stable', assets: [] };
  f.save({ releases: [nightly, stable], actions: [], refs: { nightly: f.sha } });
  const overrides = { GITHUB_REF: 'refs/tags/v1.0.0-rc.1', FLOAT_VIEW_VERSION: 'v1.0.0-rc.1',
    GITHUB_EVENT_NAME: 'push' };
  for (const file of assetNames(overrides.FLOAT_VIEW_VERSION)) writeFileSync(join(f.cwd, file), 'candidate');
  assert.equal(f.run('prepare', overrides).status, 0);
  assert.match(f.output(), /channel=candidate/);
  assert.match(f.output(), /appVersion=1\.0\.0/);
  assert.match(f.output(), /configuration=Release/);
  assert.match(f.output(), /storeBuild=true\nstoreDelivery=upload/);
  assert.equal(f.run('publish', overrides).status, 0);
  let state = f.state();
  assert.deepEqual(state.releases.slice(0, 2), [nightly, stable]);
  const candidate = state.releases[2] as Release & { make_latest: string };
  assert.equal(candidate.name, overrides.FLOAT_VIEW_VERSION);
  assert.equal(candidate.prerelease, true);
  assert.equal(candidate.make_latest, 'false');
  assert.deepEqual(candidate.assets.map(asset => asset.name), assetNames(overrides.FLOAT_VIEW_VERSION));
  assert.ok(!state.actions.some(action => action.startsWith('DELETE git/refs/')));
  const uploads = state.actions.filter(action => action.startsWith('upload')).length;
  assert.equal(f.run('publish', overrides).status, 0);
  assert.equal(f.state().actions.filter(action => action.startsWith('upload')).length, uploads);
  assert.equal(f.run('prepare', { ...overrides, GITHUB_EVENT_NAME: 'workflow_dispatch',
    FLOAT_VIEW_IOS_DELIVERY: 'check', GITHUB_RUN_NUMBER: '61' }).status, 0);
  assert.match(f.output(), /buildNumber=121/);
  assert.match(f.output(), /storeBuild=true\nstoreDelivery=check/);
  assert.ok(f.output().endsWith('skip=true\n'));
  assert.equal(git(['tag', '--list', 'v1.0.0'], f.cwd), '');
  state = f.state();
  assert.deepEqual(state.releases.slice(0, 2), [nightly, stable]);
});

test('failed candidate publication resumes its draft without touching Nightly', () => {
  const f = fixture();
  const tag = 'v1.0.0-rc.1';
  git(['tag', tag], f.cwd);
  for (const file of assetNames(tag)) writeFileSync(join(f.cwd, file), 'candidate');
  const overrides = { GITHUB_REF: 'refs/tags/' + tag, FLOAT_VIEW_VERSION: tag };
  f.save({ releases: [], actions: [], fail: 'publish', refs: { nightly: f.sha } });
  assert.notEqual(f.run('publish', overrides).status, 0);
  const state = f.state();
  assert.equal(state.releases[0]!.draft, true);
  delete state.fail;
  f.save(state);
  assert.equal(f.run('publish', overrides).status, 0);
  assert.equal(f.state().releases[0]!.draft, false);
  assert.equal(f.state().refs?.nightly, f.sha);
});


test('stable notes aggregate while candidate and nightly notes stay incremental', () => {
  const f = fixture();
  git(['tag', 'v1.0.0-rc.1'], f.cwd);
  git(['-c', 'core.hooksPath=/dev/null', 'commit', '--allow-empty', '-m', 'app: Fix candidate regression'], f.cwd);
  const sha = git(['rev-parse', 'HEAD'], f.cwd);
  git(['update-ref', 'refs/remotes/origin/master', sha], f.cwd);
  for (const tag of ['v1.0.0-rc.2', 'v1.0.0', 'v1.0.1-rc.1']) {
    git(['tag', tag], f.cwd);
    for (const file of assetNames(tag)) writeFileSync(join(f.cwd, file), 'package');
    const result = f.run('publish', { GITHUB_SHA: sha, GITHUB_REF: `refs/tags/${tag}`, FLOAT_VIEW_VERSION: tag });
    assert.equal(result.status, 0, result.stderr);
  }
  const releases = f.state().releases;
  assert.match(releases[0]!.body!, /Fix candidate regression/);
  assert.doesNotMatch(releases[0]!.body!, /Show live telemetry/);
  assert.match(releases[0]!.body!, /compare\/v1.0.0-rc.1\.\.\.v1.0.0-rc.2/);
  assert.match(releases[1]!.body!, /Show live telemetry/);
  assert.match(releases[1]!.body!, /Fix candidate regression/);
  assert.match(releases[1]!.body!, /compare\/v0.1.49\.\.\.v1.0.0/);
  assert.match(releases[2]!.body!, /compare\/v1.0.0\.\.\.v1.0.1-rc.1/);
  const nightly = resolveVersion(sha, null, f.cwd).version;
  for (const file of assetNames(nightly)) writeFileSync(join(f.cwd, file), 'package');
  const result = f.run('publish', { GITHUB_SHA: sha, FLOAT_VIEW_VERSION: nightly });
  assert.equal(result.status, 0, result.stderr);
  assert.match(f.state().releases[3]!.body!, /compare\/v1.0.1-rc.1\.\.\./);
});

test('Mac store builds use explicit release tags and independent manual retries', () => {
  const f = fixture();
  assert.equal(f.run('prepare').status, 0);
  assert.match(f.output(), /macStoreBuild=false/);
  const rejected = f.run('prepare', { GITHUB_EVENT_NAME: 'workflow_dispatch', FLOAT_VIEW_BUILD_MAC_STORE: 'true' });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /never master or nightly/);
  git(['tag', 'v1.0.0-rc.1'], f.cwd);
  const ref = { GITHUB_REF: 'refs/tags/v1.0.0-rc.1', GITHUB_EVENT_NAME: 'push' };
  assert.equal(f.run('prepare', ref).status, 0);
  assert.match(f.output(), /macStoreBuild=true/);
  const manual = { ...ref, GITHUB_EVENT_NAME: 'workflow_dispatch', FLOAT_VIEW_BUILD_MAC_STORE: 'true' };
  assert.equal(f.run('prepare', manual).status, 0);
  assert.match(f.output(), /macStoreBuild=true/);
  assert.match(f.output(), /storeBuild=false/);
  assert.equal(f.run('prepare', { ...manual, FLOAT_VIEW_BUILD_MAC_STORE: 'false', FLOAT_VIEW_BUILD_IOS_STORE: 'true' }).status, 0);
  assert.match(f.output(), /macStoreBuild=false/);
  assert.match(f.output(), /storeBuild=true/);
});

test('Mac upload checks and retries remain independent and forbidden on master', () => {
  const f = fixture();
  for (const delivery of ['check', 'upload']) {
    const result = f.run('prepare', { GITHUB_EVENT_NAME: 'workflow_dispatch', FLOAT_VIEW_MAC_DELIVERY: delivery });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /never master or nightly/);
  }
  git(['tag', 'v1.0.0-rc.1'], f.cwd);
  const ref = { GITHUB_REF: 'refs/tags/v1.0.0-rc.1', GITHUB_EVENT_NAME: 'workflow_dispatch' };
  for (const delivery of ['check', 'upload']) {
    assert.equal(f.run('prepare', { ...ref, FLOAT_VIEW_MAC_DELIVERY: delivery }).status, 0);
    assert.match(f.output(), /macStoreBuild=true/);
    assert.match(f.output(), new RegExp(`macStoreDelivery=${delivery}`));
    assert.match(f.output(), /storeBuild=false/);
    assert.match(f.output(), /storeDelivery=none/);
  }
  assert.notEqual(f.run('prepare', { ...ref, FLOAT_VIEW_MAC_DELIVERY: 'invalid' }).status, 0);
});


test('first stable publication includes app history despite earlier candidates', () => {
  const f = fixture();
  git(['tag', '-d', 'v0.1.49'], f.cwd);
  git(['tag', 'v1.0.0-rc.1'], f.cwd);
  git(['-c', 'core.hooksPath=/dev/null', 'commit', '--allow-empty', '-m', 'apple: Fix candidate startup'], f.cwd);
  const sha = git(['rev-parse', 'HEAD'], f.cwd);
  git(['update-ref', 'refs/remotes/origin/master', sha], f.cwd);
  for (const tag of ['v1.0.0-rc.2', 'v1.0.0']) git(['tag', tag], f.cwd);
  for (const file of assetNames('v1.0.0')) writeFileSync(join(f.cwd, file), 'package');
  const result = f.run('publish', { GITHUB_SHA: sha, GITHUB_REF: 'refs/tags/v1.0.0', FLOAT_VIEW_VERSION: 'v1.0.0' });
  assert.equal(result.status, 0, result.stderr);
  const body = f.state().releases[0]!.body!;
  assert.match(body, /Show live telemetry/);
  assert.match(body, /Fix candidate startup/);
  assert.match(body, /commits\/v1.0.0/);
  assert.doesNotMatch(body, /compare\/v1.0.0-rc/);
});

test('Android store bundles require explicit release tags and independent manual selection', () => {
  const f = fixture();
  assert.equal(f.run('prepare').status, 0);
  assert.match(f.output(), /androidStoreBuild=false/);
  const requested = { GITHUB_EVENT_NAME: 'workflow_dispatch', FLOAT_VIEW_BUILD_ANDROID_STORE: 'true' };
  assert.notEqual(f.run('prepare', requested).status, 0);
  git(['tag', 'v1.0.0-rc.1'], f.cwd);
  assert.equal(f.run('prepare', { GITHUB_REF: 'refs/tags/v1.0.0-rc.1', GITHUB_EVENT_NAME: 'push' }).status, 0);
  assert.match(f.output(), /androidStoreBuild=true/);
  assert.equal(f.run('prepare', { ...requested, GITHUB_REF: 'refs/tags/v1.0.0-rc.1' }).status, 0);
  assert.match(f.output(), /androidStoreBuild=true/);
  assert.match(f.output(), /storeBuild=false/);
  assert.match(f.output(), /macStoreBuild=false/);
  assert.equal(f.run('prepare', { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/tags/v1.0.0-rc.1' }).status, 0);
  assert.match(f.output(), /androidStoreBuild=false/);
});


test('Android delivery stays behind tagged signing and leaves Apple selection independent', () => {
  const f = fixture();
  const manual = { GITHUB_EVENT_NAME: 'workflow_dispatch', FLOAT_VIEW_ANDROID_DELIVERY: 'upload' };
  assert.notEqual(f.run('prepare', manual).status, 0);
  git(['tag', 'v1.1.0-rc.5'], f.cwd);
  const ref = { GITHUB_REF: 'refs/tags/v1.1.0-rc.5' };
  assert.equal(f.run('prepare', { ...ref, ...manual }).status, 0);
  assert.match(f.output(), /androidStoreBuild=true/);
  assert.match(f.output(), /androidStoreDelivery=upload/);
  assert.match(f.output(), /storeBuild=false/);
  assert.match(f.output(), /macStoreBuild=false/);
  assert.equal(f.run('prepare', { ...ref, ...manual, FLOAT_VIEW_ANDROID_DELIVERY: 'check' }).status, 0);
  assert.match(f.output(), /androidStoreDelivery=check/);
  assert.equal(f.run('prepare', { ...ref, GITHUB_EVENT_NAME: 'push' }).status, 0);
  assert.match(f.output(), /androidStoreDelivery=upload/);
  assert.equal(f.run('prepare', { ...ref, GITHUB_EVENT_NAME: 'workflow_dispatch', FLOAT_VIEW_BUILD_ANDROID_STORE: 'true' }).status, 0);
  assert.match(f.output(), /androidStoreDelivery=none/);
  assert.notEqual(f.run('prepare', { ...ref, ...manual, FLOAT_VIEW_ANDROID_DELIVERY: 'invalid' }).status, 0);
});

test('a tagged Android-only build skips Apple jobs and publishes only the APK', () => {
  const f = fixture('android: Fix Play availability\n\n[skip ios] [skip macos]');
  const tag = 'v1.0.0';
  git(['tag', tag], f.cwd);
  const ref = { GITHUB_REF: `refs/tags/${tag}`, FLOAT_VIEW_VERSION: tag };
  const push = f.run('prepare', { ...ref, GITHUB_EVENT_NAME: 'push' });
  assert.equal(push.status, 0, push.stderr);
  assert.match(push.stdout, /"iosEnabled":false,"androidEnabled":true,"macosEnabled":false/);
  assert.match(push.stdout, /"storeBuild":"false","storeDelivery":"none"/);
  assert.match(push.stdout, /"macStoreBuild":"false","macStoreDelivery":"none"/);
  assert.match(push.stdout, /"androidStoreBuild":"true","androidStoreDelivery":"upload"/);
  assert.match(push.stdout, /"skip":"false"/);

  const manual = f.run('prepare', {
    ...ref, GITHUB_EVENT_NAME: 'workflow_dispatch', FLOAT_VIEW_IOS_DELIVERY: 'upload',
    FLOAT_VIEW_MAC_DELIVERY: 'upload', FLOAT_VIEW_BUILD_ANDROID_STORE: 'true',
  });
  assert.equal(manual.status, 0, manual.stderr);
  assert.match(manual.stdout, /"storeBuild":"false","storeDelivery":"none"/);
  assert.match(manual.stdout, /"macStoreBuild":"false","macStoreDelivery":"none"/);
  assert.match(manual.stdout, /"androidStoreBuild":"true","androidStoreDelivery":"none"/);

  const before = f.state();
  assert.match(f.run('publish', ref).stderr, /Missing release asset FloatView-v1\.0\.0\.apk/);
  assert.deepEqual(f.state(), before);
  const apk = `FloatView-${tag}.apk`;
  writeFileSync(join(f.cwd, apk), 'Android package');
  const publication = f.run('publish', ref);
  assert.equal(publication.status, 0, publication.stderr);
  const release = f.state().releases[0]!;
  assert.equal(release.make_latest, 'false');
  assert.equal(release.prerelease, false);
  assert.deepEqual(release.assets.map(asset => asset.name), [apk]);
});

test('a partial nightly is complete with only its selected assets', () => {
  const f = fixture('repo: Skip Android on this build\n\n[skip android]');
  const apk = `FloatView-${f.metadata.version}.apk`;
  rmSync(join(f.cwd, apk));
  const publication = f.run('publish');
  assert.equal(publication.status, 0, publication.stderr);
  assert.deepEqual(f.state().releases[0]!.assets.map(asset => asset.name),
    assetNames(f.metadata.version, ['ios', 'macos']));
  const rerun = f.run('prepare');
  assert.equal(rerun.status, 0, rerun.stderr);
  assert.match(rerun.stdout, /"iosEnabled":true,"androidEnabled":false,"macosEnabled":true/);
  assert.match(rerun.stdout, /"skip":"true"/);
});

test('all markers prevent publication and markers on ancestors do not carry forward', () => {
  const f = fixture('repo: Skip all platforms [skip ios] [skip android] [skip macos]');
  git(['tag', 'v1.0.0'], f.cwd);
  const tagged = f.run('prepare', { GITHUB_REF: 'refs/tags/v1.0.0', GITHUB_EVENT_NAME: 'push' });
  assert.equal(tagged.status, 0, tagged.stderr);
  assert.match(tagged.stdout, /"iosEnabled":false,"androidEnabled":false,"macosEnabled":false/);
  assert.match(tagged.stdout, /"androidStoreBuild":"false","androidStoreDelivery":"none"/);
  assert.match(tagged.stdout, /"skip":"true"/);
  assert.match(f.run('publish').stderr, /No platforms selected for publication/);
  assert.deepEqual(f.state().releases, []);

  git(['-c', 'core.hooksPath=/dev/null', 'commit', '--allow-empty', '-m', 'app: Resume platform builds'], f.cwd);
  const unmarked = f.run('prepare', { GITHUB_SHA: git(['rev-parse', 'HEAD'], f.cwd) });
  assert.equal(unmarked.status, 0, unmarked.stderr);
  assert.match(unmarked.stdout, /"iosEnabled":true,"androidEnabled":true,"macosEnabled":true/);
  assert.match(unmarked.stdout, /"skip":"false"/);
});
