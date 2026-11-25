# iOS package notices and corresponding source

Reference package: Release IPA 1.0.0 (77), source
`fae17d3206174adfd1c432bb64d7df370e9a005f`, and the subsequent notice fixes.
This is an inventory and packaging audit, not Apple processing acceptance.

## Packaged material

The signed IPA contains the shared `index.html`, native executable, Live Activity
extension, app icons/assets, privacy manifests, profiles and signatures. It has no
third-party Swift package, embedded binary SDK, vendor checkout or fixture data.
Test-only Rust fixture includes are under test configuration. Native Apple
frameworks are platform dependencies. Bundled SQLite comes from the locked
`libsqlite3-sys` source, not a separate downloaded binary.

Decoded JavaScript literals in the actual IPA match the complete source LICENSE,
NOTICE and THIRD_PARTY_NOTICES.txt byte-for-byte. These are offline content, not
links to remotely fetched notices. Settings now links to a dedicated
`#/settings/licences` page with the app's sticky Settings back link. The page
keeps all three full documents readable and scrollable; native Back returns to
Settings. The ordinary Settings page stays compact.

The next candidate adds the Rust runtime material described below. Archive and
export checks now reject missing or stale full legal texts in packaged HTML.
The frontend build also checks actual rendered client modules against reviewed
package/version entries, including dependencies installed as build tools that
contribute shipped JavaScript. A dependency change requires notice regeneration
and review rather than relying only on package.json classification.

## Dependency and artwork coverage

- The locked iOS Cargo traversal from `float-view-application-runtime-apple-ffi`,
  excluding dev edges and retaining build/procedural-macro dependencies, has
  95 external package/version pairs. All have entries in the generated notices.
  Their declared licences are permissive alternatives/combinations, including
  Unicode terms; no third-party GPL/LGPL/AGPL requirement was identified in that
  app dependency graph. The full cross-platform inventory remains conservative.
- Frontend runtime entries cover Svelte, SvelteKit, clsx, devalue, esm-env and
  Leaflet. Generated Lucide artwork retains both its ISC terms and MIT notices
  for Feather-derived icons. No downloaded font is shipped by this frontend.
- **Found and fixed:** Cargo metadata does not enumerate the linked Rust
  standard library/compiler-builtins. Added the pinned Rust 1.93.0 standard
  library copyright inventory, compiler-builtins licence/LLVM exception and
  libm's embedded notices. These are included in the generated offline notices.
  Build 77 predates this correction and must not be the TestFlight submission.
- The rider artwork remains separately credited to Luis Prado, “onewheel”, Noun
  Project image 4260841, with the source, CC BY 3.0 terms and modification credit
  in NOTICE and the offline page. The asset-specific page offers an attribution
  route; its royalty-free subscription wording is not evidence of a purchased
  attribution waiver. No purchase is recorded or assumed. See the
  [asset page](https://thenounproject.com/icon/onewheel-4260841/) and
  [CC BY 3.0 terms](https://creativecommons.org/licenses/by/3.0/legalcode.en).
  Keep third-party grants separate from the owner's Apple permission; inspect
  actual store-delivered asset accessibility/terms if Apple applies restrictions
  beyond the audited distribution package.

Rust notice provenance: `LICENSES/Rust-stdlib-1.93.0.txt` is a text conversion of
the installed official toolchain's `share/doc/rust/COPYRIGHT-library.html`, with
its input SHA-256 recorded in the file. Its conservative upstream inventory
includes other targets/optional components and does not imply that every listed
component is linked on iOS. The other two files are unmodified copies from
[compiler-builtins/LICENSE.txt](https://github.com/rust-lang/rust/blob/1.93.0/library/compiler-builtins/LICENSE.txt)
and [libm/LICENSE.txt](https://github.com/rust-lang/rust/blob/1.93.0/library/compiler-builtins/libm/LICENSE.txt).
The toolchain pin selects the notice filenames, so a Rust upgrade requires
reviewed replacement notices. Full toolchain/compiler tools are not shipped.

## Exact source access

For each release candidate, compare the anonymous exact-commit source archive
against all tracked Git blob identities, including licence files, build inputs,
lockfiles, assets and toolchain pins. Build 77 passed this check; its brief
result is in the [verification summary](../openspec/changes/prepare-public-distribution/verification.md).
Keep download/digest comparison logs local.

[Exact source tree](https://github.com/acheronfail/float-view/tree/fae17d3206174adfd1c432bb64d7df370e9a005f)
and [source archive](https://github.com/acheronfail/float-view/archive/fae17d3206174adfd1c432bb64d7df370e9a005f.tar.gz)
are publicly accessible without an account. The archive omits research vendor
gitlinks; those submodules are not Release build inputs. Locked external Cargo
and npm packages are obtained separately by the documented dependency install
steps; this project archive is not an offline dependency cache. Cargo.lock keeps
registry checksums and package-lock.json keeps resolved tarball integrity. Notice
entries identify exact dependency versions and upstream source destinations.

Clean builds now embed the full 40-character Git commit in their source link;
dirty/source-without-Git builds do not claim an exact clean source revision.
Build records retain the full source, run identity and IPA digest. Keep source
commits reachable when deleting old release tags; never rewrite them away.
The source archive and next IPA must be checked again at the actual release
revision after these changes are committed and published.

## Remaining scope

iOS inventory/source-access checks are complete for the inspected revision and
the identified runtime-notice gap is fixed in source. Software checks verify the
updated offline page and packaging gate. Unsigned Release packaging checks also
passed with corrected full texts. These local checks do not certify a clean signed
candidate; retain detailed logs locally.
A clean local signed preflight at [source fae1814](https://github.com/acheronfail/float-view/tree/fae1814f9696b56071755d33784f0e233cc34bac) passed the corrected package checks and anonymous exact-source comparison.
Its local test number is not an upload allocation. The actual numbered-candidate
CI export must still pass the same gates before upload; build 77 is not grandfathered in.
Android's additional upstream copyright/NOTICE collection and final AAB review,
Mac store packaging, Apple processing and delivered-device checks remain separate
open work. The owner's official Apple permission is recorded in licensing.md;
the public project licence remains AGPL-3.0-or-later.
