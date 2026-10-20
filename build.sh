#!/usr/bin/env bash
# One-command build & run for Linux (tested on Arch).
#
#   ./build.sh            install deps (if needed) and run the launcher from source
#   ./build.sh --build    build an unpacked Linux app into dist/ and run it
#   ./build.sh --package  build all Linux packages (AppImage, pacman, deb, tar.gz) into dist/
#
# Anything after "--" is passed to the launcher, e.g. ./build.sh -- --ozone-platform=wayland
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"

MODE=dev
APP_ARGS=()
while [[ $# -gt 0 ]]; do
    case "$1" in
        --build)   MODE=build ;;
        --package) MODE=package ;;
        --)        shift; APP_ARGS=("$@"); break ;;
        -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
        *)         echo "Unknown option: $1" >&2; exit 1 ;;
    esac
    shift
done

# Use the Node version pinned in mise.toml when mise is available.
if command -v mise >/dev/null 2>&1; then
    mise install --quiet
    eval "$(mise env -s bash)"
fi

if ! command -v node >/dev/null 2>&1; then
    echo "Node.js not found. Install it with: sudo pacman -S mise && mise install  (or: sudo pacman -S nodejs npm)" >&2
    exit 1
fi

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [[ "$NODE_MAJOR" != "22" ]]; then
    echo "Warning: Node $NODE_MAJOR detected, this project expects Node 22." >&2
fi

# Reinstall dependencies when node_modules is missing or older than the lockfile.
if [[ ! -d node_modules || package-lock.json -nt node_modules ]]; then
    npm ci
    touch node_modules
fi

case "$MODE" in
    dev)
        exec npx electron . "${APP_ARGS[@]}"
        ;;
    build)
        npx electron-builder build --linux dir --publish never
        exec ./dist/linux-unpacked/customlauncher "${APP_ARGS[@]}"
        ;;
    package)
        npx electron-builder build --linux --publish never
        echo
        echo "Packages written to dist/:"
        ls -1 dist/*.{AppImage,pacman,deb,tar.gz} 2>/dev/null
        echo
        echo "Install the Arch package with: sudo pacman -U dist/*.pacman"
        ;;
esac
