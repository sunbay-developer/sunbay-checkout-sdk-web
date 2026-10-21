#!/usr/bin/env bash
#
# scripts/dev-playground.sh — 本地真机联调 SDK（定制 playground / demo）
#
# SDK iframe 托管在 checkout hosted（:3000），商户页由本仓 demo server 托管（:8080），
# 二者**不同源**，正好覆盖 SDK 的跨源 postMessage / origin 校验 / 跨 iframe 频道。
#
# 本脚本只做「构建 SDK 产物」这一步（供 demo 的 <script src="../dist/index.global.js">）。
# 另外两个长驻进程（checkout dev、demo server）请在各自终端手动起（Agent 不起长驻进程）。
#
# 完整联调三步：
#   1) 起 checkout hosted（另一终端）：
#        cd ../checkout && npm run dev            # http://localhost:3000
#   2) 构建 SDK 产物（本脚本）：
#        bash scripts/dev-playground.sh
#   3) 起 demo server（另一终端，需 js/examples/.env.local 填商户凭据）：
#        cd js/examples && node server.mjs        # http://localhost:8080
#   打开 http://localhost:8080/examples/customization-playground.html
#
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> 构建 SDK 产物（含 IIFE dist/index.global.js，供 demo <script> 引入）"
pnpm --filter @sunbay/checkout-sdk-protocol run build
pnpm --filter @sunbay/checkout-sdk-js run build

GLOBAL="js/dist/index.global.js"
if [[ -f "$GLOBAL" ]]; then
    echo "    ✓ $GLOBAL 就位（window.SunbayCheckout）"
else
    echo "    ✗ 未生成 $GLOBAL，请检查 js tsup 配置" >&2
    exit 1
fi

cat <<'EOF'

==> SDK 产物已就位。联调另外两步（各自终端手动起长驻进程）：
    1) checkout hosted:  cd ../checkout && npm run dev        # :3000
    2) demo server:      cd js/examples && node server.mjs    # :8080
       （首次需 cp .env.example .env.local 并填 API_KEY/APP_ID/MERCHANT_ID）
    打开 http://localhost:8080/examples/customization-playground.html
EOF
