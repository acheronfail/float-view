git_temp_patch := ".precommit.patch"

_default:
  just -l

# run this first to setup local development
setup:
  #!/usr/bin/env bash
  set -euo pipefail

  npm install

  if [ -z "${CI:-}" ]; then
    echo "setting up git hooks..."
    echo "#!/usr/bin/env bash" > .git/hooks/pre-commit
    echo "just pre-commit" >> .git/hooks/pre-commit
    chmod +x .git/hooks/pre-commit
  fi

# run the local dev server
dev *args:
  npm run dev -- {{args}}

_pre_commit_start:
  #!/usr/bin/env bash
  set -uo pipefail

  git diff --exit-code >/dev/null
  needs_save=$?
  set -e

  if [ $needs_save -ne 0 ]; then
    git diff > "{{git_temp_patch}}"
    git apply --reverse "{{git_temp_patch}}"
  fi

  npm run format
  git add .

_pre_commit_clean:
  #!/usr/bin/env bash
  set -euo pipefail
  if [ -f "{{git_temp_patch}}" ]; then
    git apply "{{git_temp_patch}}"
    rm "{{git_temp_patch}}"
  fi

# pre-commit hook
pre-commit: _pre_commit_start && _pre_commit_clean
  npm run types
  npm run tests
