# App releases

Stable and candidate commands list all numbered RC tags on the current history
newer than the latest stable ancestor, across all version targets. They then show
the proposed tag and source commit and ask for confirmation before creating or
pushing the tag. Enter `y` or `yes` to continue. Empty input, any other answer,
or end of input cancels the release.
Fetching and validation happen before the prompt. Preview commands do not prompt.

`just release preview` prints the next patch release's Markdown notes from the latest
local stable ancestor tag through `HEAD`, including changes already published in RCs. Pass a ref, such as `just release preview master`,
to inspect another commit. It uses the same note generator as publication, works offline
and on dirty or unpushed branches, and does not create tags or publish anything.
Only committed changes appear; fetch tags first if the local release history is stale.

`just release` defaults to the last candidate in the version-sorted list, with
the `-rc.N` suffix removed. If the list is empty, it defaults to the next patch.
`just release patch` fetches tags and creates/pushes the next annotated stable
version on a clean `master` matching `origin/master`. Use `minor` or `major` to
reset lower version components. The greatest numeric stable ancestor is the
base, so `v0.1.49` advances to `v0.1.50`, `v0.2.0` or `v1.0.0` respectively.
You can also push an explicit `vX.Y.Z` tag on master history. Published stable
releases and their assets are retained on reruns; a failed draft can be resumed.
If a helper push fails, its local tag remains for inspection and an explicit
`git push origin <tag>` retry. Tagging does not modify app source or package manifests.

`just release candidate` fetches version tags and pushes the next annotated,
immutable candidate tag from clean `master` matching `origin/master`.
Before the first stable v1.0.0 it targets `v1.0.0-rc.N`; afterward it targets the next patch.
Pass `patch`, `minor` or `major` explicitly to choose the bump from the latest
stable ancestor: `just release candidate minor` after v1.0.0 creates
`v1.1.0-rc.1`, then `v1.1.0-rc.2` on the next invocation.
Candidate tags select Release packages and protected iOS signing/delivery. They
publish separate GitHub prereleases with the selected sideload downloads, without
replacing Latest or the rolling Nightly. Apple marketing versions omit `-rc.N`;
the shared native build number and source record identify the exact CI run/tag.
Use another candidate for source fixes; never move an existing candidate tag.
No candidate command invites testers or submits App Review. Stable v1.0.0 waits
for candidate acceptance, including TestFlight-delivered checks.

## Skip individual platforms

Put `[skip ios]`, `[skip android]` or `[skip macos]` in the subject or body of the
commit you build or tag. Use the exact lowercase spelling. Markers apply to that
commit on master, on stable and candidate tags, and on manual runs. A marker skips
that platform's sideload package, store signing and store upload.

For an Android-only release, put `[skip ios] [skip macos]` in the release commit
message and cut the tag as usual. CI publishes the APK on the new GitHub Release
and retains the signed AAB when Play signing is enabled. A partial stable release
keeps the previous complete stable release marked Latest. If all three platforms
are skipped, CI publishes no release. To restore a platform in a later release,
tag a new commit whose message omits its marker.

## Build and publication behavior

Master pushes and manual master builds produce Nightly
prereleases targeting `v1.0.0-nightly.<count>.g<hash>` before the first stable
v1.0.0 ancestor. The count includes all reachable repository commits, so deleting
v0.x tags cannot renumber it. After v1.0.0, use the next patch and commit count
since the greatest stable ancestor, plus the source hash. Nightlies update one rolling
Nightly prerelease, attaching it to the full SemVer version tag so GitHub sorts it
above older stable versions. After successful nightly publication, superseded nightly
version tags are deleted; the current Nightly tag, release and asset set are retained.
Stable and unrelated tags are preserved. Nightly never replaces the stable Latest release. Unchanged successful
nightlies and reruns of older commits are skipped. Failed builds remain retryable.

The retained Build apps workflow counter plus its fixed offset of 60 supplies an independent numeric native
build identifier across both channels. The offset preserves the sequence from the former `ipa.yml` workflow.
The same preparation output feeds the IPA, APK, Mac ZIP and optional iOS store
job. Build records retain source, run ID, attempt and CI URL; GitHub release notes
link the number to that run. Build `N` maps to workflow run number `N - 60`.
The allocator rejects other workflow paths; keep `.github/workflows/build-apps.yml`
and its counter/offset through version and tag cleanup. Changing its display name
is safe; moving its path requires an explicit continuity migration. Reruns keep
the original number, while corrected submissions require a fresh workflow run.
Canceled, skipped or failed runs may leave gaps; numbers are never recycled.
The protected iOS delivery path queries Apple before considering an upload retry.
Release notes list non-merge commit titles, grouped by `app:`, `apple:`, `android:`,
`windows:` and `linux:` under App, Apple, Android, Windows and Linux.
`repo:` commits are excluded because they do not describe changes to the released apps.
Windows and Linux areas are reserved for the planned hosts; sections appear only when they have entries.
Unprefixed or unrecognized
titles appear under Other changes. Entries link to their commits and include a full
changelog link. Stable releases compare against the greatest earlier stable ancestor,
so their notes include changes from every intervening RC. Candidate and nightly
notes stay incremental from the newest stable or numbered candidate ancestor.
The target release and later versions are excluded for stable/candidate publication;
nightly tags never serve as a comparison base. A first stable release includes all
reachable non-merge commits except `repo:` entries. Ranges with no included changes are stated explicitly.
Nightly descriptions begin with a UTC date and time refreshed on each successful publication.
Hidden source/version comments support nightly skip and asset verification.
Stable and candidate tags select Release configuration, while nightlies use Debug for mobile.
Current downloads remain AltStore IPAs, signed APKs and notarized Developer ID
Mac ZIPs. Local iOS Release archive/export preparation is documented in the
[Apple host guide](../backends/apple/README.md#ios-app-store-preparation); it neither
uploads to a store nor changes the GitHub packages. Android App Bundles have an independent protected signing job and
[Google Play internal delivery path](../docs/android-distribution.md#protected-google-play-delivery).
Apple and Android store signing and enabled delivery proceed automatically for
stable and RC tags. Signing/upload environments retain tag-only restrictions and
readiness gates, with no required reviewers. Closed/production promotion remains
manual. Tagged manual runs accept
`android-store=true` for build-only or `android-delivery=check|upload`;
master/nightly store requests are rejected. Only stable `vX.Y.Z` or numbered `vX.Y.Z-rc.N` release tags select protected App Store jobs.
`just release ...` pushes that tag and selects iOS signing/delivery; master
commits and rolling nightlies never select them.

Apple signing/delivery credentials, readiness gates and retry commands are
maintained in the [Apple host guide](../backends/apple/README.md#protected-apple-delivery).
Store retries do not replace published GitHub packages, invite testers or submit review.

Run the focused release-tooling checks with
`node --strip-types --test .github/scripts/*.test.ts` and
`python3 -B .github/scripts/ios-store.test.py` and
`python3 -B .github/scripts/ios-upload.test.py`. Android delivery checks are
`python3 -B .github/scripts/android-store.test.py` and
`python3 -B .github/scripts/android-upload.test.py` (JDK 17+ and OpenSSL required).
