/**
 * 构建后处理：把产品页设为首页，后台移到 /console.html
 * 用法：node scripts/finalize-web.mjs（在 apps/web 目录下执行）
 */
import { copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const dist = resolve(process.cwd(), 'dist');
const index = resolve(dist, 'index.html');
const consoleHtml = resolve(dist, 'console.html');
const landing = resolve(dist, 'landing.html');

if (!existsSync(index) || !existsSync(landing)) {
  console.error('[finalize] 缺少 dist/index.html 或 dist/landing.html');
  process.exit(1);
}

// 1) 后台入口 -> console.html
copyFileSync(index, consoleHtml);
// 2) 产品页 -> index.html（首页）
copyFileSync(landing, index);

console.log('[finalize] 首页 = 产品展示页；后台 = /console.html');
