#!/bin/sh
# Gera a versão de demonstração (GitHub Pages) na pasta docs/.
cd "$(dirname "$0")"
rm -rf docs && mkdir -p docs && cp -R web/img docs/img
sed -e 's#/img/#img/#g' \
    -e 's#<body>#<body><div class="faixa">Demonstração · os dados ficam salvos só neste aparelho</div>#' \
    -e 's#<script>#<script src="demo-api.js"></script><script>#' \
    web/index.html > docs/index.html
cp demo-api.js docs/
touch docs/.nojekyll
echo "docs/ gerado"
