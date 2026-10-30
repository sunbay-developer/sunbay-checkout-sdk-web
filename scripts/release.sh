#!/usr/bin/env bash
#
# scripts/release.sh — 一键发布 @sunbay/checkout-sdk-protocol + @sunbay/checkout-sdk-js
#
# 版本策略：lockstep（两包始终同版本号）。传入一个目标版本，两包一起升并发布。
#
# 为什么不是直接 `pnpm publish`：
#   1. 本机全局 ~/.npmrc 的 registry 指向淘宝镜像（只读），`pnpm publish` 会误发到镜像并
#      401/404。必须显式指向官方 registry。
#   2. js 包依赖 `@sunbay/checkout-sdk-protocol: workspace:*`，发布时必须替换成实际版本，
#      否则商户 `npm install` 解析不了 `workspace:*`。
#   正解：`pnpm pack`（自动把 workspace:* 换成已发布的实际版本）生成 tarball，
#        再 `npm publish <tarball>`（命令行显式 registry + token 认证）。
#
# 鉴权：环境变量 SUNBAY_NPM_TOKEN（granular token，Read+Write + Bypass 2FA）。
#      脚本绝不打印 token、不写盘持久化 .npmrc。
#
# 用法：
#   SUNBAY_NPM_TOKEN=... bash scripts/release.sh <version> [--dry-run] [--tag <name>]
#   （--dry-run 与 --tag <name> 可在 version 之后以任意顺序出现）
#   例：bash scripts/release.sh 0.0.3
#       bash scripts/release.sh 0.0.3 --dry-run   # 只 build+pack 校验，不实发
#       bash scripts/release.sh 0.0.3 --tag next  # 发布到 dist-tag next（默认 latest）
#   --tag：仅在显式传入时才给 npm publish 追加 --tag；不传则行为不变（latest）。
#         建议先 --tag next 发布，待托管运行时上线后再用 npm dist-tag add 提升为 latest。
#
set -euo pipefail

REGISTRY="https://registry.npmjs.org"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

USAGE="用法: bash scripts/release.sh <version> [--dry-run] [--tag <name>]"
VERSION="${1:-}"
DRY_RUN=false
TAG=""
if [[ $# -gt 0 ]]; then shift; fi
while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --tag)
            if [[ $# -lt 2 ]]; then
                echo "错误: --tag 需要一个参数" >&2
                echo "$USAGE" >&2
                exit 1
            fi
            TAG="$2"
            shift 2
            ;;
        *)
            echo "错误: 未知参数 '$1'" >&2
            echo "$USAGE" >&2
            exit 1
            ;;
    esac
done

if [[ -z "$VERSION" ]]; then
    echo "$USAGE" >&2
    exit 1
fi
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
    echo "错误: 版本号 '$VERSION' 不是合法 semver" >&2
    exit 1
fi
if [[ -n "$TAG" ]]; then
    if ! [[ "$TAG" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
        echo "错误: dist-tag '$TAG' 不合法（仅允许字母数字及 . _ -，且以字母数字开头）" >&2
        exit 1
    fi
    if [[ "$TAG" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+([-+].*)?$ ]]; then
        echo "错误: dist-tag '$TAG' 形似 semver 版本号，npm 不允许" >&2
        exit 1
    fi
fi
if [[ "$DRY_RUN" == false && -z "${SUNBAY_NPM_TOKEN:-}" ]]; then
    echo "错误: 未设置 SUNBAY_NPM_TOKEN（发布需要）。dry-run 可免。" >&2
    exit 1
fi

echo "==> 目标版本（lockstep）: $VERSION  ${DRY_RUN:+（dry-run）}${TAG:+  dist-tag: $TAG}"

# 1) 两包版本号升到目标版本（lockstep）
for pkg in protocol js; do
    node -e "const f='$pkg/package.json';const p=require('./'+f);p.version='$VERSION';require('fs').writeFileSync(f,JSON.stringify(p,null,4)+'\n')"
    echo "    $pkg/package.json → $VERSION"
done

# 2) 全量 build（protocol 先于 js；js 的 __SDK_VERSION__ 随 package.json 注入）
echo "==> build"
pnpm --filter @sunbay/checkout-sdk-protocol run build >/dev/null
pnpm --filter @sunbay/checkout-sdk-js run build >/dev/null
echo "    build ok"

# 3) 校验门禁（type-check + test），失败即止
echo "==> type-check + test"
pnpm -r run type-check >/dev/null
pnpm --filter @sunbay/checkout-sdk-js run test >/dev/null
echo "    gates ok"

# publish 单个 tarball 的函数：pnpm pack（替换 workspace:*）→ npm publish tarball（绕镜像+token）
publish_pkg() {
    local dir="$1" name="$2"
    pushd "$dir" >/dev/null
    local tgz
    tgz="$(pnpm pack 2>/dev/null | tail -1)"
    # 校验 tarball 内 version 与 workspace 替换
    local info
    info="$(tar -xzOf "$tgz" package/package.json 2>/dev/null | node -e "const p=JSON.parse(require('fs').readFileSync(0));const d=p.dependencies?.['@sunbay/checkout-sdk-protocol']||'(none)';console.log(p.version+' | protocol-dep='+d)")"
    echo "    $name tarball: $info"
    if [[ "$info" == *"workspace:"* ]]; then
        echo "错误: $name tarball 仍含未替换的 workspace: 依赖" >&2
        rm -f "$tgz"; popd >/dev/null; exit 1
    fi
    # 仅在显式传入 --tag 时追加（默认 latest，行为不变）
    local tag_args=()
    [[ -n "$TAG" ]] && tag_args=(--tag "$TAG")
    if [[ "$DRY_RUN" == true ]]; then
        echo "    [dry-run] 跳过 npm publish $name@$VERSION"
        echo "    [dry-run] 将执行: npm publish \"$tgz\" --registry \"$REGISTRY\" --//registry.npmjs.org/:_authToken=<redacted> --access public${TAG:+ --tag \"$TAG\"}"
    else
        npm publish "$tgz" \
            --registry "$REGISTRY" \
            --//registry.npmjs.org/:_authToken="$SUNBAY_NPM_TOKEN" \
            --access public ${tag_args[@]+"${tag_args[@]}"} >/dev/null
        echo "    + 已发布 $name@$VERSION${TAG:+（dist-tag: $TAG）}"
    fi
    rm -f "$tgz"
    popd >/dev/null
}

# 4) 发布（先 protocol 后 js；js 依赖 protocol 的已发布版本）
echo "==> publish protocol"
publish_pkg protocol "@sunbay/checkout-sdk-protocol"
echo "==> publish js"
publish_pkg js "@sunbay/checkout-sdk-js"

echo ""
if [[ "$DRY_RUN" == true ]]; then
    echo "✓ dry-run 完成（未实发）。两包 package.json 已升到 ${VERSION}，请按需 git 还原或提交。"
else
    echo "✓ 发布完成: protocol@$VERSION + js@$VERSION"
    echo "  后续: 1) git 提交两包 package.json 版本改动并 push"
    echo "        2) checkout 仓 bump 依赖到 ^$VERSION 并 npm install 锁 lockfile（见 checkout AGENTS.md）"
    echo "        3) npm 索引传播有几分钟延迟，稍后可 npm view @sunbay/checkout-sdk-js version 复查"
fi
