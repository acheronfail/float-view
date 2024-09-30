git_temp_patch := ".precommit.patch"

_default:
  just -l

# run this first to setup local development
setup:
  #!/usr/bin/env bash
  set -euo pipefail

  npm install

  create_hook() {
    echo "#!/usr/bin/env bash" > ".git/hooks/${1}"
    echo "${2}" >> ".git/hooks/${1}"
    chmod +x ".git/hooks/${1}"
  }

  if [ -z "${CI:-}" ]; then
    echo "setting up git hooks..."
    create_hook "pre-commit" "just _git-pre-commit"
    create_hook "commit-msg" "just _git-commit-msg \$1"
  fi

# run the local dev server
dev *args:
  npm run dev -- {{args}}

# run the tests
test *args:
  npm run tests -- --watch {{args}}

_pre_commit_start:
  #!/usr/bin/env bash
  set -uo pipefail

  git diff --exit-code >/dev/null
  needs_save=$?
  set -e

  if [ $needs_save -ne 0 ]; then
    # FIXME: do not clobber existing patch file!
    git diff > "{{git_temp_patch}}"
    git apply --reverse "{{git_temp_patch}}"
  fi

  npm run format
  git add --update .

_pre_commit_clean:
  #!/usr/bin/env bash
  set -euo pipefail
  if [ -f "{{git_temp_patch}}" ]; then
    git apply "{{git_temp_patch}}"
    rm "{{git_temp_patch}}"
  fi

_git-pre-commit: _pre_commit_start && _pre_commit_clean
  npm run checks

[no-exit-message]
_git-commit-msg path:
  @if ! [[ "$(head -n1 {{path}})" =~ ^(major|minor|patch):|\[skip\ ci\] ]]; then echo "Commit message must start with 'patch:', 'minor:' or 'major:'"; false; fi
