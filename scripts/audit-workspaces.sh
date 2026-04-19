#!/usr/bin/env bash
set -u

workspaces=()
while IFS= read -r workspace; do
  workspaces+=("$workspace")
done < <(node -e 'const fs = require("fs"); const path = require("path"); for (const dir of fs.readdirSync("packages")) { const pkgPath = path.join("packages", dir, "package.json"); if (!fs.existsSync(pkgPath)) continue; const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")); if (pkg.name) console.log(pkg.name); }')

failed=0

for ws in "${workspaces[@]}"; do
  echo "===== $ws ====="
  if ! npm audit --workspace "$ws"; then
    failed=1
  fi
  echo
done

exit $failed
