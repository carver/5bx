#!/bin/sh
# Sets up a development checkout: dev dependencies and the git hooks in
# .githooks/. Safe to re-run. The app itself needs none of this to run.
set -e
cd "$(dirname "$0")"

case "$1" in
  -h|--help)
    echo "usage: ./install_dev.sh   install dev dependencies and point git at .githooks/"
    exit 0 ;;
esac

npm install
git config core.hooksPath .githooks
echo "Hooks: pre-commit (stamp, config) and agent-pre-commit (full suite) from .githooks/"
