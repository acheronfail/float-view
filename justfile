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

pre-commit:
  npm run format
  npm run types
