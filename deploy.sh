#!/usr/bin/env bash
# Compila la app y la copia a la raíz del repo para que GitHub Pages la sirva.
set -e
cd "$(dirname "$0")"
( cd app && npm run build )
rm -rf assets index.html
cp -r app/dist/index.html app/dist/assets .
touch .nojekyll
echo "✓ App compilada y copiada a la raíz. Haz commit + push para publicar."
