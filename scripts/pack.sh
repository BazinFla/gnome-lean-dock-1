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

ZIP_NAME="${UUID}.shell-extension.zip"
DIST_DIR="$ROOT_DIR/dist"

echo "🧹 Cleaning previous builds..."
mkdir -p "$DIST_DIR"
rm -f "$DIST_DIR/$ZIP_NAME" "$ZIP_NAME"

# 1. Compile GSettings schemas if directory exists
if [ -d "schemas" ]; then
    echo "⚙️ Compiling GSettings schemas..."
    glib-compile-schemas schemas/
fi

# 2. Build extra-source arguments dynamically
EXTRA_ARGS=()
for item in *; do
    [ -e "$item" ] || continue
    case "$item" in
        metadata.json|extension.js|prefs.js|stylesheet.css|schemas|po|locale|scripts|docs|dist|dev|tests|Makefile|install.sh|*.md|*.zip|*.png|*.webp)
            continue
            ;;
        *)
            EXTRA_ARGS+=( "--extra-source=$item" )
            ;;
    esac
done

# 3. Add translations if po/ directory exists
PODIR_ARGS=()
if [ -d "po" ]; then
    echo "🌍 Including translations from po/..."
    PODIR_ARGS+=( "--podir=po" )
    GETTEXT_DOMAIN=$(jq -r '.["gettext-domain"] // empty' metadata.json)
    if [ -n "$GETTEXT_DOMAIN" ]; then
        PODIR_ARGS+=( "--gettext-domain=$GETTEXT_DOMAIN" )
    fi
fi

echo "📦 Packaging GNOME Shell extension with gnome-extensions..."
gnome-extensions pack \
    --force \
    "${EXTRA_ARGS[@]}" \
    "${PODIR_ARGS[@]}" \
    --out-dir="$DIST_DIR" \
    .

echo "✅ Archive created successfully: dist/$ZIP_NAME"
echo "👉 To install the generated archive:"
echo "   gnome-extensions install --force dist/$ZIP_NAME"
