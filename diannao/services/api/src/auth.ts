/**
 * 店脑 · 鉴权层
 * 主责：B 邱
 *
 * 会话制 token：登录签发 session token，绑定签发时的 membership_version。
 * 撤权（revokeMembership）后 membership_version 前进，旧 session 立即失效。
 * 铁律：tenant_id 只由服务端从 token 解析，绝不接受请求体/聊天文本里的租户声明。
 */

import { randomUUID, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { AuthPrincipal, LoginResponse, Uuid } from '../../../packages/contracts/index';
import { getMembershipByUser, addMembership, revokeMembershipForUser } from './store';
import { loadAccounts, upsertAccount, deleteAccount, loadSessions, upsertSession, deleteSession, deleteSessionsForUser, purgeSessionsBefore } from './db';

interface Account {
  login_name: string;
  password: string;
  user_id: Uuid;
  prompt_type?: string;
}

/** 密码哈希：scrypt$salt$hash（Node 内置 scrypt，不引入第三方依赖）。 */
export function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(pw, salt, 64).toString('hex');
  return 'scrypt$' + salt + '$' + hash;
}

/** 校验密码；兼容旧明文（校验通过后由调用方升级为哈希）。 */
function verifyPassword(pw: string, stored: string): boolean {
  if (stored.startsWith('scrypt$')) {
    const parts = stored.split('$');
    if (parts.length !== 3 || parts[1] === undefined || parts[2] === undefined) return false;
    const calc = scryptSync(pw, parts[1], 64);
    const expected = Buffer.from(parts[2], 'hex');
    return calc.length === expected.length && timingSafeEqual(calc, expected);
  }
  return stored === pw;
}

/** 演示环境统一密码（正式环境应改为一次性绑定码 + 短期 token）。
 *  公开仓库中不再硬编码，改为环境变量注入，未设置时使用占位口令。 */
export const DEMO_PASSWORD = process.env.DIANNAO_DEMO_PASSWORD || 'demo-password';

const SEED_ACCOUNTS: Account[] = [
  { login_name: 'diannaoxy', password: hashPassword(DEMO_PASSWORD), user_id: '00000000-0000-4000-8000-000000000001' },
  { login_name: 'staff-b', password: hashPassword(DEMO_PASSWORD), user_id: '00000000-0000-4000-8000-000000000002' },
  { login_name: 'staff-a', password: hashPassword(DEMO_PASSWORD), user_id: '00000000-0000-4000-8000-000000000003' },
  // 场景二：服装店（租户 C）
  { login_name: 'cloth-demo', password: hashPassword(DEMO_PASSWORD), user_id: '00000000-0000-4000-8000-000000000004' },
];

/** 账号从 SQLite 加载；首次运行写入种子。 */
const ACCOUNTS: Account[] = (() => {
  const stored = loadAccounts();
  if (stored.length > 0) {
    // 启动时把历史明文密码统一升级为哈希（一次性迁移）
    for (const a of stored) {
      if (!a.password.startsWith('scrypt$')) {
        a.password = hashPassword(a.password);
        upsertAccount(a);
      }
    }
    return stored;
  }
  for (const a of SEED_ACCOUNTS) upsertAccount(a);
  return [...SEED_ACCOUNTS];
})();

/** 后台：列出账号（不返回密码）。 */
export function listAccounts(): { login_name: string; user_id: Uuid; prompt_type: string }[] {
  return ACCOUNTS.map((a) => ({ login_name: a.login_name, user_id: a.user_id, prompt_type: a.prompt_type ?? 'baby' }));
}

/** 当前用户的人设（baby / apparel / fraud）。 */
export function promptTypeOf(userId: Uuid): string {
  return ACCOUNTS.find((a) => a.user_id === userId)?.prompt_type ?? 'baby';
}

/** 后台：新增员工账号并绑定到门店。 */
export function addAccount(
  loginName: string,
  password: string,
  tenantId: Uuid,
  storeId: Uuid,
  role: 'owner' | 'manager' | 'staff',
  promptType: string = 'baby',
): { ok: true; user_id: Uuid } | { ok: false; reason: 'exists' | 'invalid' } {
  const name = loginName.trim();
  if (name.length < 2 || password.length < 6) return { ok: false, reason: 'invalid' };
  if (ACCOUNTS.some((a) => a.login_name === name)) return { ok: false, reason: 'exists' };
  const userId = randomUUID();
  const acc: Account = { login_name: name, password: hashPassword(password), user_id: userId, prompt_type: promptType };
  ACCOUNTS.push(acc);
  upsertAccount(acc);
  addMembership(tenantId, storeId, userId, role);
  return { ok: true, user_id: userId };
}

/** 后台：删除员工账号。种子账号不可删。删除时撤权并清空会话。 */
export function removeAccount(loginName: string): boolean {
  if (SEED_ACCOUNTS.some((a) => a.login_name === loginName)) return false;
  const idx = ACCOUNTS.findIndex((a) => a.login_name === loginName);
  if (idx < 0) return false;
  const userId = ACCOUNTS[idx]!.user_id;
  revokeMembershipForUser(userId);
  for (const [token, session] of SESSIONS) {
    if (session.user_id === userId) SESSIONS.delete(token);
  }
  deleteSessionsForUser(userId);
  ACCOUNTS.splice(idx, 1);
  deleteAccount(loginName);
  return true;
}

interface Session {
  token: string;
  user_id: Uuid;
  membership_id: Uuid;
  /** 签发时的成员关系版本；撤权/复权后前进，旧 session 失效。 */
  issued_version: number;
  expires_at: string;
}

const SESSIONS: Map<string, Session> = new Map();
/** 空闲 2 小时进入休眠；休眠期内收到请求即唤醒并续期。 */
const SESSION_IDLE_MS = 2 * 60 * 60 * 1000;
/** 休眠最长 7 天，超过则必须重新登录（避免 token 永久有效）。 */
const SESSION_DORMANT_MAX_MS = 7 * 24 * 60 * 60 * 1000;
/** 续期落盘节流：5 分钟内不重复写库。 */
const SESSION_TOUCH_MS = 5 * 60 * 1000;

/** 约定：expires_at = 最后活动时间 + 空闲期。 */
function idleDeadline(nowMs: number): string {
  return new Date(nowMs + SESSION_IDLE_MS).toISOString();
}

/** 从 expires_at 反推最后活动时间。 */
function lastActiveMs(session: Session): number {
  return new Date(session.expires_at).getTime() - SESSION_IDLE_MS;
}

function persistSession(session: Session): void {
  upsertSession({
    token: session.token,
    user_id: session.user_id,
    membership_id: session.membership_id,
    issued_version: session.issued_version,
    expires_at: session.expires_at,
  });
}

// 启动时恢复会话（含休眠中的，等用户下次发消息唤醒）；休眠超过 7 天的直接清掉。
purgeSessionsBefore(new Date(Date.now() - SESSION_DORMANT_MAX_MS + SESSION_IDLE_MS).toISOString());
for (const row of loadSessions()) {
  SESSIONS.set(row.token, {
    token: row.token,
    user_id: row.user_id,
    membership_id: row.membership_id,
    issued_version: row.issued_version,
    expires_at: row.expires_at,
  });
}

/** 登录：校验账号 → 查成员关系（撤权者拒绝登录）→ 签发 session token。 */
export function login(loginName: string, password: string): LoginResponse | undefined {
  const acc = ACCOUNTS.find((a) => a.login_name === loginName);
  if (acc === undefined || !verifyPassword(password, acc.password)) return undefined;
  // 旧明文密码：登录成功后自动升级为哈希
  if (!acc.password.startsWith('scrypt$')) {
    acc.password = hashPassword(password);
    upsertAccount(acc);
  }

  const m = getMembershipByUser(acc.user_id);
  if (m === undefined || m.revoked_at !== undefined) return undefined; // 撤权用户不能登录

  const expiresAt = idleDeadline(Date.now());
  const token = 'sess-' + randomUUID();
  const session: Session = {
    token,
    user_id: acc.user_id,
    membership_id: m.id,
    issued_version: m.membership_version,
    expires_at: expiresAt,
  };
  SESSIONS.set(token, session);
  persistSession(session);

  const principal: AuthPrincipal = {
    user_id: acc.user_id,
    tenant_id: m.tenant_id,
    store_id: m.store_id,
    role: m.role,
    token,
  };
  return { principal, expires_at: expiresAt };
}

/**
 * 从 Authorization: Bearer <token> 解析出 principal。
 * 校验：session 存在 + membership 未撤权 + 版本一致 + 未过期。
 * 任一不符返回 undefined（旧会话撤权失效）。
 */
export function authenticate(authorization: string | undefined): AuthPrincipal | undefined {
  if (authorization === undefined) return undefined;
  const matched = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  if (matched === null) return undefined;
  const token = matched[1]!;
  const session = SESSIONS.get(token);
  if (session === undefined) return undefined;

  const membership = getMembershipByUser(session.user_id);
  if (membership === undefined || membership.revoked_at !== undefined) {
    return undefined;
  }
  if (membership.membership_version !== session.issued_version) {
    return undefined;
  }

  const now = Date.now();
  const idleMs = now - lastActiveMs(session);
  // 休眠超过 7 天：彻底失效，必须重新登录
  if (idleMs > SESSION_DORMANT_MAX_MS) {
    SESSIONS.delete(token);
    deleteSession(token);
    return undefined;
  }
  // 有活动就续期；休眠中的会话在这一步被唤醒（不要求重新登录）
  if (idleMs >= SESSION_TOUCH_MS) {
    session.expires_at = idleDeadline(now);
    persistSession(session);
  }

  return {
    user_id: session.user_id,
    tenant_id: membership.tenant_id,
    store_id: membership.store_id,
    role: membership.role,
    token,
  };
}

/** 重置密码（网关自愈 / 归属变更用）：账号保留，旧会话立即失效。 */
export function resetPassword(loginName: string, password: string): boolean {
  const acc = ACCOUNTS.find((x) => x.login_name === loginName);
  if (acc === undefined) return false;
  acc.password = hashPassword(password);
  upsertAccount(acc);
  for (const [token, s] of SESSIONS) {
    if (s.user_id === acc.user_id) {
      SESSIONS.delete(token);
      deleteSession(token);
    }
  }
  return true;
}

/** 当前活跃 session 数（用于撤权响应的 revoked_session_count 统计）。 */
export function activeSessionCountForUser(userId: Uuid): number {
  let count = 0;
  for (const s of SESSIONS.values()) {
    if (s.user_id === userId) count += 1;
  }
  return count;
}
