#!/usr/bin/env bash
# ============================================================
# 店脑 · 服务器部署（在 server-setup.sh 之后运行）
# 前提：代码已上传到 /opt/diannao，且 Node 24 + pm2 已安装
# 用法：cd /opt/diannao && bash deploy/server-install.sh
# ============================================================
set -euo pipefail

APP_DIR="/opt/diannao"
cd "$APP_DIR"

echo "=========================================="
echo "  店脑 · 安装与启动"
echo "=========================================="

# ---------- 1. 项目依赖 ----------
echo "[1/6] 安装项目依赖 ..."
npm install --no-audit --no-fund

# ---------- 2. 构建 API ----------
echo "[2/6] 构建 API ..."
npm run build:api

# ---------- 3. OpenClaw 运行时 ----------
echo "[3/6] 安装 OpenClaw 运行时 ..."
cd "$APP_DIR/runtime/openclaw"
if [ ! -f package.json ]; then npm init -y >/dev/null; fi
npm install openclaw@2026.6.34 --no-audit --no-fund

# ---------- 4. 微信插件 ----------
echo "[4/6] 安装并启用腾讯微信插件 ..."
node node_modules/openclaw/openclaw.mjs plugins install @tencent-weixin/openclaw-weixin
node node_modules/openclaw/openclaw.mjs plugins enable openclaw-weixin
node node_modules/openclaw/openclaw.mjs config set gateway.mode local

# ---------- 5. 启动服务 ----------
echo "[5/6] 启动 pm2 服务 ..."
cd "$APP_DIR"
pm2 delete diannao-api >/dev/null 2>&1 || true
pm2 delete diannao-wechat-gw >/dev/null 2>&1 || true
pm2 delete diannao-clawbot >/dev/null 2>&1 || true

pm2 start dist/services/api/src/server.js --name diannao-api
pm2 start adapters/wechat/gateway.mjs --name diannao-wechat-gw

if [ -f "$APP_DIR/runtime/openclaw/.env" ]; then
  cd "$APP_DIR/runtime/openclaw"
  pm2 start "node --env-file=.env node_modules/openclaw/openclaw.mjs gateway run" --name diannao-clawbot
else
  echo "  [WARN] 未找到 runtime/openclaw/.env，ClawBot 暂不启动"
fi

pm2 save

# ---------- 6. 开机自启 ----------
echo "[6/6] 配置开机自启 ..."
pm2 startup systemd -u root --hp /root 2>/dev/null | tail -n 1 || true

echo ""
echo "=========================================="
echo "  安装完成"
echo ""
echo "  还需要手动做两步："
echo "    1. 微信扫码："
echo "       cd /opt/diannao/runtime/openclaw"
echo "       node node_modules/openclaw/openclaw.mjs channels login --channel openclaw-weixin"
echo "    2. 检查状态：pm2 status && curl -s localhost:7401/v1/health"
echo "=========================================="
