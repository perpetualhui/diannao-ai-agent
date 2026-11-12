/**
 * 店脑 · 轻量持久化层（SQLite，Node 内置 node:sqlite）
 * 主责：B 邱
 *
 * 定位：不改变现有内存查询逻辑，只做「写操作后落盘 + 启动时恢复」。
 * 这样服务重启不再丢客户画像、成员关系、商品、知识、服务记录。
 *
 * 正式生产建议切 PostgreSQL（迁移脚本 db/migrations 已备）；
 * 当前 SQLite 用于单机部署与试点，零额外运维。
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const DB_DIR = process.env.DIANNAO_DATA_DIR ?? resolve(process.cwd(), 'data');
mkdirSync(DB_DIR, { recursive: true });

const DB_PATH = resolve(DB_DIR, 'diannao.db');
const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS snapshot (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`);

export const DB_FILE = DB_PATH;

/** 整库快照写入（单行 JSON）。数据量在试点规模下很小（<1MB）。 */
export function saveSnapshot(data: unknown): void {
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO snapshot (id, data, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at',
  ).run(JSON.stringify(data), now);
}

/** 读取上次快照；没有则返回 undefined。 */
export function loadSnapshot<T>(): T | undefined {
  const row = db.prepare('SELECT data FROM snapshot WHERE id = 1').get() as { data?: string } | undefined;
  if (row?.data === undefined) return undefined;
  try {
    return JSON.parse(row.data) as T;
  } catch {
    return undefined;
  }
}

/** 快照元信息（供后台状态页展示）。 */
export function snapshotInfo(): { exists: boolean; updated_at?: string; bytes?: number } {
  const row = db.prepare('SELECT data, updated_at FROM snapshot WHERE id = 1').get() as
    | { data?: string; updated_at?: string }
    | undefined;
  if (row?.data === undefined) return { exists: false };
  return { exists: true, updated_at: row.updated_at, bytes: row.data.length };
}

// ============================================================
// 账号表（后台可增删员工）
// ============================================================

export interface StoredAccount {
  login_name: string;
  password: string;
  user_id: string;
  prompt_type?: string;
}

db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    login_name TEXT PRIMARY KEY,
    password TEXT NOT NULL,
    user_id TEXT NOT NULL,
    prompt_type TEXT NOT NULL DEFAULT 'baby'
  )
`);

try { db.exec("ALTER TABLE accounts ADD COLUMN prompt_type TEXT NOT NULL DEFAULT 'baby'"); } catch { /* 已存在 */ }

export function loadAccounts(): StoredAccount[] {
  const rows = db.prepare('SELECT login_name, password, user_id, prompt_type FROM accounts').all() as unknown as StoredAccount[];
  return rows;
}

export function upsertAccount(a: StoredAccount): void {
  db.prepare(
    'INSERT INTO accounts (login_name, password, user_id, prompt_type) VALUES (?, ?, ?, ?) ON CONFLICT(login_name) DO UPDATE SET password = excluded.password, user_id = excluded.user_id, prompt_type = excluded.prompt_type',
  ).run(a.login_name, a.password, a.user_id, a.prompt_type ?? 'baby');
}

export function deleteAccount(loginName: string): void {
  db.prepare('DELETE FROM accounts WHERE login_name = ?').run(loginName);
}


// ============================================================
// 会话持久化（服务重启不掉线）
// ============================================================

export interface StoredSession {
  token: string;
  user_id: string;
  membership_id: string;
  issued_version: number;
  expires_at: string;
}

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    membership_id TEXT NOT NULL,
    issued_version INTEGER NOT NULL,
    expires_at TEXT NOT NULL
  )
`);

export function loadSessions(): StoredSession[] {
  return db.prepare('SELECT token, user_id, membership_id, issued_version, expires_at FROM sessions').all() as unknown as StoredSession[];
}

export function upsertSession(s: StoredSession): void {
  db.prepare(
    'INSERT INTO sessions (token, user_id, membership_id, issued_version, expires_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(token) DO UPDATE SET user_id = excluded.user_id, membership_id = excluded.membership_id, issued_version = excluded.issued_version, expires_at = excluded.expires_at',
  ).run(s.token, s.user_id, s.membership_id, s.issued_version, s.expires_at);
}

export function deleteSession(token: string): void {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function deleteSessionsForUser(userId: string): void {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

/** 删除「最后活动时间」早于 cutoff 的会话（cutoff = 现在 - 最长休眠期）。 */
export function purgeSessionsBefore(cutoffIso: string): void {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(cutoffIso);
}
