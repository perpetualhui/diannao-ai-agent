/**
 * 店脑 · OpenClaw 微信账号管理（多开）
 * 后台通过本模块调用 openclaw CLI：列出账号、新增扫码登录、读取二维码、登出。
 * 仅允许管理员调用（路由层校验角色）。
 */

import { execFile, spawn } from 'node:child_process';
import { existsSync, openSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const OPENCLAW_DIR = process.env.OPENCLAW_DIR ?? '/opt/diannao/runtime/openclaw';
const OPENCLAW_BIN = resolve(OPENCLAW_DIR, 'node_modules/openclaw/openclaw.mjs');

export interface WechatAccount {
  account: string;
  status: string;
}

function runOpenclaw(args: string[], timeout = 30000): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      process.execPath,
      [OPENCLAW_BIN, ...args],
      {
        cwd: OPENCLAW_DIR,
        timeout,
        env: { ...process.env, HOME: '/root' },
        maxBuffer: 2 * 1024 * 1024,
      },
      (err, stdout, stderr) => {
        if (err) reject(new Error(String(stderr || err.message)));
        else resolvePromise(String(stdout));
      },
    );
  });
}

/** 解析 `openclaw channels list` 输出中的 openclaw-weixin 账号。 */
export function parseWechatAccounts(raw: string): WechatAccount[] {
  const items: WechatAccount[] = [];
  for (const line of raw.split('\n')) {
    const m = /^- openclaw-weixin\s+(\S+):\s*(.+)$/.exec(line.trim());
    if (m !== null) items.push({ account: m[1] as string, status: (m[2] as string).trim() });
  }
  return items;
}

export async function listWechatAccounts(): Promise<WechatAccount[]> {
  const out = await runOpenclaw(['channels', 'list']);
  return parseWechatAccounts(out);
}

function loginLogFile(account: string): string {
  return `/tmp/diannao-wx-login-${account}.log`;
}

/** 每个账号二维码的首次生成时间（用于计算有效期）。 */
const qrFirstSeen = new Map<string, number>();
const QR_TTL_SECONDS = 180;

/** 新增账号并启动扫码登录（腾讯插件只支持扫码创建账号，不支持非交互 add）。 */
export async function addWechatAccount(account?: string): Promise<string> {
  const acc = account !== undefined && account.length > 0 ? account : `wx-${Date.now().toString(36)}`;
  const logFile = loginLogFile(acc);
  const out = openSync(logFile, 'a');
  qrFirstSeen.delete(acc);
  const child = spawn(
    process.execPath,
    [OPENCLAW_BIN, 'channels', 'login', '--channel', 'openclaw-weixin'],
    {
      cwd: OPENCLAW_DIR,
      detached: true,
      stdio: ['ignore', out, out],
      env: { ...process.env, HOME: '/root' },
    },
  );
  child.unref();
  return acc;
}

export interface LoginLog {
  qr_url: string | null;
  connected: boolean;
  expires_in: number;
}

/** 读取扫码日志：拿到二维码链接 / 是否已连接 / 剩余有效秒数。 */
export function readLoginLog(account: string): LoginLog {
  const logFile = loginLogFile(account);
  if (!existsSync(logFile)) return { qr_url: null, connected: false, expires_in: 0 };
  const text = readFileSync(logFile, 'utf8');
  const m = /https:\/\/liteapp\.weixin\.qq\.com[^\s]+/.exec(text);
  const connected = /已将此 OpenClaw 连接到微信/.test(text);
  if (m === null) return { qr_url: null, connected, expires_in: 0 };

  if (!qrFirstSeen.has(account)) qrFirstSeen.set(account, Date.now());
  const elapsed = Math.floor((Date.now() - (qrFirstSeen.get(account) as number)) / 1000);
  const expires_in = connected ? 0 : Math.max(0, QR_TTL_SECONDS - elapsed);
  return { qr_url: m[0], connected, expires_in };
}

export async function logoutWechatAccount(account: string): Promise<void> {
  await runOpenclaw(['channels', 'logout', '--account', account, '--channel', 'openclaw-weixin']);
}
