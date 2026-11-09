#!/bin/sh
# Gera a versão de demonstração (GitHub Pages) na pasta docs/.
cd "$(dirname "$0")"
rm -rf docs && mkdir -p docs && cp -R web/img docs/img
sed -e 's#/img/#img/#g' \
    -e 's#<body>#<body><div style="background:\#d4b24c;color:\#14110a;text-align:center;padding:6px;font-size:13px;font-weight:700">DEMONSTRAÇÃO · os pedidos ficam salvos só neste aparelho · senha de primeiro acesso: 123 · Fiscalização: FISCAL2026 / 2026</div>#' \
    -e 's#<script>#<script src="demo-api.js"></script><script>#' \
    web/index.html > docs/index.html
cp demo-api.js docs/
touch docs/.nojekyll
echo "docs/ gerado"
