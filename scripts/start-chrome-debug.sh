#!/bin/bash
# 兼容旧入口：Chrome 现由 Playwright 直接管理，不再需要 CDP 调试端口。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec "${NODE_BIN:-node}" "$SCRIPT_DIR/login-agency.mjs" "$@"
