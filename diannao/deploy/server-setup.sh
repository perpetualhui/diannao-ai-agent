#!/usr/bin/env bash
# ============================================================
# 店脑 · 服务器初始化（Ubuntu 22.04 / 24.04 LTS，4G 内存）
# 用法：sudo bash server-setup.sh
# 做四件事：加 swap、装 Node 24、装 pm2、准备目录与防火墙
# ============================================================
set -euo pipefail

echo "=========================================="
echo "  店脑 · 服务器初始化"
echo "=========================================="

if [ "$(id -u)" -ne 0 ]; then
  echo "请用 sudo 运行：sudo bash server-setup.sh"
  exit 1
fi

# ---------- 1. 基础工具 ----------
echo "[1/6] 安装基础工具 ..."
apt-get update -y
apt-get install -y curl ca-certificates git nginx ufw

# ---------- 2. swap 2G（4G 内存机器建议） ----------
echo "[2/6] 配置 swap ..."
if swapon --show | grep -q swapfile; then
  echo "  swap 已存在，跳过"
else
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "  已创建 2G swap"
fi

# ---------- 3. Node 24 ----------
echo "[3/6] 安装 Node.js 24 ..."
if command -v node >/dev/null 2>&1 && node -v | grep -qE '^v24\.'; then
  echo "  Node 已是 $(node -v)，跳过"
else
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
echo "  node=$(node -v) npm=$(npm -v)"

# ---------- 4. pm2 ----------
echo "[4/6] 安装 pm2 ..."
npm install -g pm2
pm2 -v

# ---------- 5. 目录 ----------
echo "[5/6] 准备部署目录 ..."
mkdir -p /opt/diannao
chown -R "${SUDO_USER:-root}":"${SUDO_USER:-root}" /opt/diannao 2>/dev/null || true
echo "  代码目录：/opt/diannao"

# ---------- 6. 防火墙 ----------
echo "[6/6] 配置防火墙 ..."
ufw allow OpenSSH || true
ufw allow 80/tcp || true
ufw allow 443/tcp || true
echo "  已放行 SSH / 80 / 443"
echo "  ⚠ 7401 / 7402 / 18789 不对外开放，只走 Nginx 反代或本机访问"

echo ""
echo "=========================================="
echo "  初始化完成"
echo "  下一步："
echo "    1. 上传代码到 /opt/diannao"
echo "    2. cd /opt/diannao && bash deploy/server-install.sh"
echo "=========================================="
