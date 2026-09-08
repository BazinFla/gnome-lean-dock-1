#!/usr/bin/env bash
set -e

# Navigate to repository root
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ ! -f "metadata.json" ]; then
    echo "❌ Error: metadata.json not found in $ROOT_DIR"
    exit 1
fi

UUID=$(jq -r '.uuid' metadata.json)
if [ -z "$UUID" ] || [ "$UUID" = "null" ]; then
    echo "❌ Error: 'uuid' field missing in metadata.json"
    exit 1
fi

# 1. Package extension archive using pack.sh
echo "📦 Packaging extension..."
"$ROOT_DIR/scripts/pack.sh"

ZIP_FILE="$ROOT_DIR/dist/${UUID}.shell-extension.zip"

if [ ! -f "$ZIP_FILE" ]; then
    echo "❌ Error: Package $ZIP_FILE not found."
    exit 1
fi

# 2. Install extension using official gnome-extensions tool
echo "🛸 Installing extension ${UUID}..."
gnome-extensions install --force "$ZIP_FILE"

# 3. Enable extension
echo "🔄 Reloading and enabling..."
gnome-extensions enable "$UUID" 2>/dev/null || true

echo "✅ Extension installed and enabled successfully!"
echo "👉 If you are on Wayland, log out and log back in for GNOME Shell to reload code."
echo "👉 If you are on X11, press Alt+F2, type 'r', and press Enter."
echo "👉 To test preferences: gnome-extensions prefs $UUID"
