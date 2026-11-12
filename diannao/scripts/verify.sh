#!/usr/bin/env bash
# 契约运行时校验：在临时目录复制 contracts 并补 .ts 扩展名，交给 Node --experimental-strip-types 执行。
# 不修改 packages/contracts 源码（源码保持标准无后缀 import）。
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/contracts"
cp "$ROOT/packages/contracts/types.ts" "$TMP/contracts/types.ts"
# 补全相对 import 扩展名，仅作用于临时副本
sed "s|from './types'|from './types.ts'|g" "$ROOT/packages/contracts/mock.ts" > "$TMP/contracts/mock.ts"
sed "s|from './types'|from './types.ts'|g; s|from './mock'|from './mock.ts'|g" "$ROOT/packages/contracts/index.ts" > "$TMP/contracts/index.ts"
cp "$ROOT/scripts/verify-runtime.ts" "$TMP/verify-runtime.ts"

cd "$TMP"
node --experimental-strip-types --no-warnings verify-runtime.ts
