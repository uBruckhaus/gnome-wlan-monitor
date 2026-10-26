#!/bin/sh
# Builds dist/wlan-monitor@ubruckhaus.github.io.shell-extension.zip.
set -eu
cd "$(dirname "$0")/.."
UUID=wlan-monitor@ubruckhaus.github.io
mkdir -p dist
find "$UUID" -name __pycache__ -prune -exec rm -rf {} +
gnome-extensions pack "$UUID" --force --out-dir dist \
    --extra-source=panel.js --extra-source=strings.js --extra-source=scripts --extra-source=icons --extra-source=../LICENSE
echo "dist/$UUID.shell-extension.zip"
