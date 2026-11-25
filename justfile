_default:
    @just --list

# Validate canonical specs and archives, or one ready change; see docs/development.md.
spec-check change="":
    #!/usr/bin/env bash
    set -euo pipefail
    export OPENSPEC_TELEMETRY=0
    change={{ quote(change) }}
    if [[ -n "$change" ]]; then
      openspec validate "$change" --type change --no-interactive --json
    else
      openspec validate --specs --no-interactive
      openspec validate --archived --strict --no-interactive
    fi

core-lint:
    cd backends/core && cargo fmt --check
    cd backends/core && cargo clippy --locked --offline --workspace --all-targets -- -D warnings

core-test:
    cd backends/core && cargo test --locked --offline

apple-rust-runtime configuration="Debug":
    #!/usr/bin/env bash
    set -euo pipefail
    backends/core/build-apple-runtime.sh \
      macosx "$(uname -m)" "{{ configuration }}" \
      "$PWD/backends/core/target/apple/macos"

apple-packaging:
    just apple-rust-runtime Release
    cd backends/apple && swift build -c release \
      --scratch-path /tmp/float-view-swift-release --product FloatViewMac
    xcodebuild -quiet -project backends/apple/ios/float-view.xcodeproj \
      -scheme float-view -configuration Release -sdk iphonesimulator \
      -destination 'generic/platform=iOS Simulator' \
      -derivedDataPath /tmp/float-view-ios-release CODE_SIGNING_ALLOWED=NO clean build
    xcodebuild -quiet -project backends/apple/ios/float-view.xcodeproj \
      -scheme float-view -configuration Debug -sdk iphoneos \
      -destination 'generic/platform=iOS' \
      -derivedDataPath /tmp/float-view-ios-device CODE_SIGNING_ALLOWED=NO clean build
    just apple-rust-runtime Debug

android-rust-host:
    backends/core/build-android-runtime.sh host debug \
      "$PWD/backends/core/target/android/application-runtime-host/debug"

android-rust-codec-test:
    cd backends/android && ./gradlew testDebugUnitTest \
      --tests fail.acheron.floatview.application.RustApplicationRuntimeTest

android-rust-packaging:
    #!/usr/bin/env bash
    set -euo pipefail
    (cd backends/android && ./gradlew clean assembleDebug assembleRelease)
    expected="$(printf '%s\n' \
      lib/arm64-v8a/libfloat_view_application_runtime_android_jni.so \
      lib/armeabi-v7a/libfloat_view_application_runtime_android_jni.so \
      lib/x86/libfloat_view_application_runtime_android_jni.so \
      lib/x86_64/libfloat_view_application_runtime_android_jni.so | sort)"
    for apk in \
      backends/android/app/build/outputs/apk/debug/app-debug.apk \
      backends/android/app/build/outputs/apk/release/app-release-unsigned.apk; do
      [[ -f "$apk" ]] || { echo "Missing Android package: $apk" >&2; exit 1; }
      unzip -tq "$apk" >/dev/null
      actual="$(unzip -Z1 "$apk" | rg '(^|/)libfloat_view_.*\.so$' | sort)"
      [[ "$actual" == "$expected" ]] || {
        echo "Unexpected Rust JNI library set in $apk:" >&2
        printf '%s\n' "$actual" >&2
        exit 1
      }
    done

setup:
    cd frontend && npm ci
    cd conformance && npm ci
    cd conformance && npx playwright install chromium webkit
    pio pkg install -d tools/vesc-test-device
    mkdir -p vendor
    [ -e "vendor/bldc" ] || git clone https://github.com/vedderb/bldc "vendor/bldc"
    [ -e "vendor/refloat" ] || git clone https://github.com/lukash/refloat "vendor/refloat"
    [ -e "vendor/vesc_tool" ] || git clone https://github.com/vedderb/vesc_tool "vendor/vesc_tool"
    [ -e "vendor/vesc_bms_fw" ] || git clone https://github.com/vedderb/vesc_bms_fw "vendor/vesc_bms_fw"
    [ -e "vendor/vesc_express" ] || git clone https://github.com/vedderb/vesc_express "vendor/vesc_express"
    [ -e "vendor/float-view" ] || git clone https://github.com/acheronfail/float-web "vendor/float-view"

lint:
    just core-lint
    cd frontend && npm run format:check
    cd conformance && npm run format:check
    swiftformat --config .swiftformat --lint backends/apple

fmt:
    cd frontend && npm run format:write
    cd conformance && npm run format:write
    swiftformat --config .swiftformat backends/apple
    cd backends/core && cargo fmt

dev platform="mock" target="":
    cd conformance && node --strip-types src/dev.ts "{{ platform }}" "{{ target }}"

# Regenerate store upload JPEGs; see conformance/README.md#store-screenshots.
store-screenshots output="" ride=".local/store-screenshots-input/ride-sanitized.json":
    #!/usr/bin/env bash
    set -euo pipefail
    npm --prefix frontend run build
    args=(--ride {{ quote(ride) }})
    if [[ -n {{ quote(output) }} ]]; then
      args+=(--output {{ quote(output) }})
    fi
    node --strip-types conformance/src/store-screenshots.mjs "${args[@]}"

list platform:
    #!/usr/bin/env bash
    set -euo pipefail
    case "{{ platform }}" in
      android) adb devices -l ;;
      ios) xcrun xctrace list devices ;;
      *) echo 'Usage: just list android|ios' >&2; exit 2 ;;
    esac

emulate platform:
    #!/usr/bin/env bash
    set -euo pipefail
    case "{{ platform }}" in
      android) emulator -avd Float_View_Conformance -no-window -no-audio ;;
      ios)
        simulator="${FLOAT_VIEW_IOS_SIMULATOR:-iPhone 17 Pro}"
        xcrun simctl boot "$simulator" >/dev/null 2>&1 || true
        xcrun simctl bootstatus "$simulator" -b
        ;;
      *) echo 'Usage: just emulate android|ios' >&2; exit 2 ;;
    esac

# Tag a stable release, candidate [patch|minor|major], or preview notes with preview [ref].
release bump="" ref="":
    node --strip-types .github/scripts/release.ts {{ quote(bump) }} {{ if ref == "" { "" } else { quote(ref) } }}

build:
    cd frontend && npm run build
    cp frontend/build/index.html backends/apple/macos/Resources/index.html

# Unsigned Release archive structure check; no Apple account required.
ios-archive-check output:
    python3 backends/apple/ios-store.py archive-check {{ quote(output) }}

# Local signed store preparation; never uploads or creates a stable tag.
ios-store-archive output:
    python3 backends/apple/ios-store.py archive {{ quote(output) }}

ios-store-export archive output:
    python3 backends/apple/ios-store.py export {{ quote(archive) }} {{ quote(output) }}

# Isolated, ad-hoc sandboxed Mac Release proof; never uploads.
mac-store-sandbox-check output:
    python3 backends/apple/mac-store.py sandbox-check {{ quote(output) }}

# Universal Mac store structure/notices check with ad-hoc signing; never uploads.
mac-store-package-check output:
    python3 backends/apple/mac-store.py package-check {{ quote(output) }}

# Build a device IPA for AltStore to sign and install; no connected device required.
ipa: build
    #!/usr/bin/env bash
    set -euo pipefail
    derived_data=/tmp/float-view-ios-ipa
    output_dir={{ quote(invocation_directory()) }}
    output="$output_dir/FloatView-$(date '+%Y%m%d-%H%M%S').ipa"
    configuration="${FLOAT_VIEW_BUILD_CONFIGURATION:-Debug}"
    [[ "$configuration" == Debug || "$configuration" == Release ]] || { echo 'Invalid build configuration' >&2; exit 2; }
    build_settings=(CODE_SIGNING_ALLOWED=NO)
    if [[ -n "${FLOAT_VIEW_VERSION:-}" ]]; then
      metadata="$(node --strip-types .github/scripts/version.ts native)"
      read -r app_version build_number <<< "$metadata"
      version="$FLOAT_VIEW_VERSION"
      output="$output_dir/FloatView-$version.ipa"
      build_settings+=("MARKETING_VERSION=$app_version" "CURRENT_PROJECT_VERSION=$build_number")
    fi
    xcodebuild -project backends/apple/ios/float-view.xcodeproj \
      -scheme float-view -configuration "$configuration" -sdk iphoneos \
      -destination 'generic/platform=iOS' -derivedDataPath "$derived_data" \
      "${build_settings[@]}" build
    staging="$(mktemp -d)"
    trap 'rm -rf "$staging"' EXIT
    mkdir -p "$staging/Payload" "$(dirname "$output")"
    ditto --norsrc --noqtn "$derived_data/Build/Products/$configuration-iphoneos/float-view.app" \
      "$staging/Payload/float-view.app"
    (cd "$staging" && ditto -c -k --norsrc --noqtn --keepParent Payload FloatView.ipa)
    unzip -tq "$staging/FloatView.ipa"
    mv -f "$staging/FloatView.ipa" "$output"
    printf 'AltStore IPA: %s\n' "$output"

# Build and launch with logs, or return after launch with --detach.
[positional-arguments]
run platform *args:
    #!/usr/bin/env bash
    set -euo pipefail
    platform="$1"
    shift
    target=""
    detach=false
    usage() { echo 'Usage: just run android|ios|macos [target] [--detach]' >&2; exit 2; }
    for arg in "$@"; do
      case "$arg" in
        --detach) detach=true ;;
        -*) usage ;;
        *) [[ -z "$target" ]] || usage; target="$arg" ;;
      esac
    done
    case "$platform" in
      android|ios) ;;
      macos) [[ -z "$target" ]] || usage ;;
      *) usage ;;
    esac
    console_arg=""
    if [[ "$detach" == false ]]; then
      console_arg=--console
    fi
    just build
    case "$platform" in
      android)
        (cd backends/android && ./gradlew assembleDebug)
        adb_command=(adb)
        [[ -z "$target" ]] || adb_command+=(-s "$target")
        "${adb_command[@]}" install -r backends/android/app/build/outputs/apk/debug/app-debug.apk
        "${adb_command[@]}" shell am start -W \
          -n fail.acheron.floatview/fail.acheron.floatview.ui.MainActivity
        if [[ "$detach" == false ]]; then
          process_id="$("${adb_command[@]}" shell pidof -s fail.acheron.floatview | tr -d '\r')"
          [[ "$process_id" =~ ^[0-9]+$ ]] || { echo 'Float View did not start on Android.' >&2; exit 1; }
          "${adb_command[@]}" logcat --pid "$process_id" -v color
        fi
        ;;
      ios)
        project="$PWD/backends/apple/ios/float-view.xcodeproj"
        if [[ -z "$target" ]]; then
          xcodebuild -project "$project" -scheme float-view \
            -destination 'generic/platform=iOS Simulator' -derivedDataPath /tmp/float-view-ios \
            CODE_SIGNING_ALLOWED=NO build
        elif xcrun simctl list devices available | grep -F "$target" >/dev/null; then
          xcrun simctl boot "$target" >/dev/null 2>&1 || true
          xcrun simctl bootstatus "$target" -b
          xcodebuild -project "$project" -scheme float-view -sdk iphonesimulator \
            -destination "id=$target" -derivedDataPath /tmp/float-view-ios CODE_SIGNING_ALLOWED=NO build
          xcrun simctl install "$target" /tmp/float-view-ios/Build/Products/Debug-iphonesimulator/float-view.app
          xcrun simctl launch --terminate-running-process ${console_arg:+"$console_arg"} "$target" fail.acheron.floatview
        else
          : "${APPLE_TEAM_ID:?Set APPLE_TEAM_ID to your Apple development team ID (see backends/apple/README.md)}"
          xcodebuild -project "$project" -scheme float-view -configuration Debug \
            -destination "platform=iOS,id=$target" -destination-timeout 30 \
            -derivedDataPath /tmp/float-view-ios-physical -allowProvisioningUpdates \
            "DEVELOPMENT_TEAM=$APPLE_TEAM_ID" build
          xcrun devicectl device install app --device "$target" \
            /tmp/float-view-ios-physical/Build/Products/Debug-iphoneos/float-view.app
          xcrun devicectl device process launch --device "$target" \
            --terminate-existing ${console_arg:+"$console_arg"} fail.acheron.floatview
        fi
        ;;
      macos)
        frontend_html="$PWD/frontend/build/index.html"
        just apple-rust-runtime
        (cd backends/apple
          binary_root="$(swift build --scratch-path /tmp/float-view-swift-build --show-bin-path)"
          # SwiftPM does not track the externally linked Rust archive as a build input.
          rm -f "$binary_root/FloatViewMac"
          swift build --scratch-path /tmp/float-view-swift-build --product FloatViewMac
          app_bundle="/tmp/float-view-swift-build/Float View Desktop.app"
          bash package-macos.sh "$binary_root/FloatViewMac" "$app_bundle"
          if [[ "$detach" == true ]]; then
            open -n --env "FLOAT_VIEW_FRONTEND_HTML=$frontend_html" "$app_bundle"
          else
            FLOAT_VIEW_FRONTEND_HTML="$frontend_html" \
              "$app_bundle/Contents/MacOS/FloatViewMac"
          fi)
        ;;
    esac

test suite="all":
    #!/usr/bin/env bash
    set -euo pipefail
    case "{{ suite }}" in
      frontend) (cd frontend && npm run check && npm test) ;;
      conformance) (cd conformance && npm run check && npm test && npm run mock) ;;
      apple)
        just apple-rust-runtime
        (cd backends/apple && swift test --scratch-path /tmp/float-view-swift-build)
        ;;
      android) (cd backends/android && ./gradlew testDebugUnitTest) ;;
      core) just core-test ;;
      fixture) sh tools/vesc-test-device/test/run.sh ;;
      all)
        just test frontend
        just test conformance
        just test apple
        just test android
        just test core
        just test fixture
        ;;
      *) echo 'Usage: just test frontend|conformance|apple|android|core|fixture|all' >&2; exit 2 ;;
    esac

conformance target:
    cd conformance && npm run {{ target }}

conformance-physical platform fixture_port target="": build
    cd conformance && npm run physical -- "{{ platform }}" "{{ fixture_port }}" "{{ target }}"

fixture action port="":
    #!/usr/bin/env bash
    set -euo pipefail
    case "{{ action }}" in
      check) sh tools/vesc-test-device/test/run.sh ;;
      setup) pio pkg install -d tools/vesc-test-device ;;
      ports) pio device list ;;
      build) pio run -d tools/vesc-test-device ;;
      flash)
        [[ -n "{{ port }}" ]] || { echo 'Pass the fixture serial port.' >&2; exit 2; }
        pio run -d tools/vesc-test-device -t upload --upload-port "{{ port }}"
        ;;
      monitor)
        [[ -n "{{ port }}" ]] || { echo 'Pass the fixture serial port.' >&2; exit 2; }
        pio device monitor --port "{{ port }}" --baud 115200 --echo
        ;;
      dev) cd conformance && FLOAT_VIEW_FIXTURE_PORT="{{ port }}" npm run fixture:dev ;;
      *) echo 'Usage: just fixture setup|check|ports|build|flash|monitor|dev [port]' >&2; exit 2 ;;
    esac

audit:
    python3 -B backends/core/test-audit-ownership.py
    backends/core/audit-ownership.sh
    git diff --check

verify: build
    just core-lint
    just apple-packaging
    just test all
    cd conformance && npm run startup && npm run startup:android
    just android-rust-packaging
    cd backends/apple && swift build --scratch-path /tmp/float-view-swift-build --product FloatViewMac
    xcodebuild -project backends/apple/ios/float-view.xcodeproj -scheme float-view \
      -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
      -derivedDataPath /tmp/float-view-ios CODE_SIGNING_ALLOWED=NO clean build
    cd conformance && npm run direct && npm run macos && npm run ios && npm run android
    just audit
    cd conformance && node --strip-types src/audit-simulation.ts
