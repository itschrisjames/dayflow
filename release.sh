#!/usr/bin/env bash
# Bump DayFlow to a new version in every place that has to agree.
#
# The asset query strings matter: index.html must request a URL the browser has
# never seen, otherwise a forced update re-downloads the HTML but still serves
# js/app.js from the HTTP cache — which is exactly how a "successful" update
# left the app running the previous build.
set -euo pipefail

NEW="${1:?usage: ./release.sh v15}"
NUM="${NEW#v}"
cd "$(dirname "$0")"

CUR=$(grep -oP "APP_VERSION = '\K[^']+" js/app.js)
echo "  $CUR -> $NEW"

sed -i "s/const APP_VERSION = '[^']*'/const APP_VERSION = '$NEW'/" js/app.js
sed -i "s/const APP_BUILT = '[^']*'/const APP_BUILT = '$(date +%Y-%m-%d)'/" js/app.js
sed -i "s/dayflow-cache-v[0-9]*/dayflow-cache-$NEW/" sw.js
sed -i "s|css/style\.css?v=[0-9]*|css/style.css?v=$NUM|g" index.html sw.js
sed -i "s|js/app\.js?v=[0-9]*|js/app.js?v=$NUM|g" index.html sw.js

node --check js/app.js
node --check sw.js
python3 -c "import json;json.load(open('manifest.json'))"

echo "  app.js    $(grep -oP "APP_VERSION = '\K[^']+" js/app.js)"
echo "  sw.js     $(grep -oP 'dayflow-cache-\K[^'\''"]+' sw.js)"
echo "  index.html$(grep -oP 'js/app\.js\?v=\K[0-9]+' index.html | sed 's/^/ v/')"
echo "  sw assets $(grep -oP 'js/app\.js\?v=\K[0-9]+' sw.js | sed 's/^/v/')"
