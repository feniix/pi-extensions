#!/usr/bin/env bash
set -euo pipefail

# Unfiltered audit covers the shared lockfile, including root dev dependencies.
# Preserve pnpm's vulnerability and registry/tool error exit codes.
exec pnpm audit
