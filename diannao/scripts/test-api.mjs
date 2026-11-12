// 一键端到端测试：起一个干净 API 进程 → 跑冒烟 → 关进程。
// 解决「内存状态不可逆」导致的不可重复问题（撤权、商品、导入都会改状态）。
// 用法：node scripts/test-api.mjs（需先 build:api）
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const serverEntry = resolve(root, 'dist', 'services', 'api', 'src', 'server.js');

if (!existsSync(serverEntry)) {
  console.error('[test-api] 找不到构建产物，请先运行: npm run build:api');
  process.exit(1);
}

// 随机端口，避免与已有进程冲突
const PORT = 7410 + Math.floor(Math.random() * 80);
const BASE = `http://localhost:${PORT}`;

const server = spawn(process.execPath, [serverEntry], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', () => {});
server.stderr.on('data', (d) => process.stderr.write(d));

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitHealthy(timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/v1/health`);
      if (res.status === 200) return true;
    } catch {
      // 服务未就绪，继续等
    }
    await sleep(120);
  }
  return false;
}

function shutdown(code) {
  try { server.kill(); } catch { /* noop */ }
  process.exit(code);
}

const ok = await waitHealthy();
if (!ok) {
  console.error('[test-api] API 启动超时');
  shutdown(1);
}

const smoke = spawn(process.execPath, [resolve(root, 'scripts', 'smoke-api.mjs')], {
  env: { ...process.env, BASE },
  stdio: 'inherit',
});
smoke.on('exit', (code) => shutdown(code ?? 1));
smoke.on('error', () => shutdown(1));
