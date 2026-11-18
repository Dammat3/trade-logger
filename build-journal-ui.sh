#!/bin/bash
# Copia l'interfaccia del journal (stessa del sito online) nella cartella del programma locale.
set -e
SRC=${1:-/home/claude/journal/web}
DST=$(dirname "$0")/journal-ui
rm -rf "$DST"; mkdir -p "$DST"
cp "$SRC/app.js" "$SRC/share.js" "$SRC/localdb.js" "$SRC/style.css" "$SRC/themes.css" "$DST/"
cp -r "$SRC/fonts" "$DST/fonts"
cp "$(dirname "$0")/journal-ui-index.html" "$DST/index.html"
echo "journal-ui pronto: $(ls "$DST" | tr '\n' ' ')"
