/**
 * 店脑 AI 简版引擎 —— 主责：张（D）· services/ai
 *
 * 冲刺阶段：规则 + Mock 检索，不接真实模型。
 * 铁律：
 *  1. 每条具体事实输出必带 evidence（source_type + record_id + observed_at）
 *  2. 查无记录 → 明确「暂无记录」（no_data），绝不编造、绝不推测
 *  3. 安全字段（过敏/健康）冲突 → 阻断推荐 + 转人工（needs_human）
 *  4. 身份歧义 → 只回脱敏候选（ambiguous），未确认不展示档案
 *  5. context 由服务端注入；引擎内再做一次撤销校验（纵深防御）
 */

import type {
  AssistantResponse,
  Evidence,
  MaskedCandidate,
  MockDataset,
  MockProduct,
  MockSubject,
  MockTransaction,
  RequestContext,
} from './types.local.ts';
import { findSubject, allSubjects } from './types.local.ts';
import { assessSafety, getVerifiedAllergies } from './safety.ts';

// ── 内部工具 ─────────────────────────────────────────────────────────

function baseResponse(ctx: RequestContext): AssistantResponse {
  return {
    status: 'error',
    answer: '',
    evidence: [],
    candidates: [],
    needs_confirmation: false,
    handoff: false,
    actions: [],
    trace_id: ctx.trace_id,
  };
}

/** 纵深防御：即使服务端漏检，引擎也拒绝已禁用/已撤销身份 */
function assertActorAllowed(dataset: MockDataset, ctx: RequestContext): string | null {
  const user = dataset.app_users.find((u) => u.id === ctx.user_id);
  if (!user) return '调用者不存在';
  if (user.disabled_at) return `账号已停用（${user.disabled_at}）`;
  const membership = dataset.memberships.find(
    (m) => m.user_id === ctx.user_id && m.tenant_id === ctx.tenant_id,
  );
  if (!membership) return '当前用户不属于该门店';
  if (membership.revoked_at) return `访问权限已撤销（${membership.revoked_at}）`;
  return null;
}

function txnEvidence(txn: MockTransaction, excerpt: string): Evidence {
  return {
    source_type: 'transaction',
    record_id: txn.id,
    observed_at: txn.occurred_at,
    excerpt,
  };
}

/** 月龄：有明确出生日期才计算；无日期返回 null（不编造） */
function ageMonths(birthdate: string | undefined, asOf: string): number | null {
  if (!birthdate) return null;
  const b = new Date(birthdate);
  const now = new Date(asOf);
  if (Number.isNaN(b.getTime())) return null;
  let months = (now.getFullYear() - b.getFullYear()) * 12 + (now.getMonth() - b.getMonth());
  if (now.getDate() < b.getDate()) months -= 1;
  return months >= 0 ? months : null;
}

// ── 认人：identity.resolve ────────────────────────────────────────────

export type ResolveResult =
  | { status: 'matched'; subject: MockSubject }
  | { status: 'ambiguous'; candidates: MaskedCandidate[] }
  | { status: 'not_found' }
  | { status: 'forbidden'; reason: string };

export function resolveSubject(
  dataset: MockDataset,
  ctx: RequestContext,
  query: string,
): ResolveResult {
  const denied = assertActorAllowed(dataset, ctx);
  if (denied) return { status: 'forbidden', reason: denied };

  const q = query.trim();
  const hits = dataset.identity_keys.filter(
    (k) =>
      k.tenant_id === ctx.tenant_id &&
      ((k.key_type === 'phone_last4' && q.length === 4 && k.key_hash === `hash_${q}`) ||
        (k.key_type === 'member_no' && k.key_hash === `hash_${q.toUpperCase()}`)),
  );
  const uniqueSubjects = [...new Map(hits.map((h) => [h.subject_id, h])).values()];

  if (uniqueSubjects.length === 0) return { status: 'not_found' };
  if (uniqueSubjects.length > 1) {
    return {
      status: 'ambiguous',
      candidates: uniqueSubjects.map((h) => ({
        subject_ref: h.subject_id,
        masked_label: h.masked_label,
      })),
    };
  }
  const subject = findSubject(dataset, uniqueSubjects[0].subject_id, ctx.tenant_id);
  if (!subject) return { status: 'not_found' };
  return { status: 'matched', subject };
}

// ── 三行卡片：客户摘要 ────────────────────────────────────────────────

const AS_OF_DEMO = '2026-11-07'; // 演示基准日；正式版取服务器当前日期

export function buildCustomerCard(
  dataset: MockDataset,
  ctx: RequestContext,
  subjectRef: string,
): AssistantResponse {
  const res = baseResponse(ctx);
  const denied = assertActorAllowed(dataset, ctx);
  if (denied) {
    res.status = 'forbidden';
    res.answer = `没有权限查看该客户资料：${denied}`;
    return res;
  }

  const person = allSubjects(dataset).find(
    (s) => s.id === subjectRef && s.tenant_id === ctx.tenant_id && s.subject_type === 'person',
  );
  if (!person) {
    res.status = 'no_data';
    res.answer = '未找到该客户，请先确认身份。';
    return res;
  }

  // 第一行：是谁
  const memberNo = String(person.profile.member_no ?? '（无会员号记录）');
  const relations = dataset.subject_relations.filter((r) => r.from_subject === person.id);
  const children = relations
    .map((r) => allSubjects(dataset).find((s) => s.id === r.to_subject && s.subject_type === 'child'))
    .filter((c): c is MockSubject => Boolean(c));

  const childParts = children.map((c) => {
    const months = ageMonths(
      typeof c.profile.birthdate === 'string' ? c.profile.birthdate : undefined,
      AS_OF_DEMO,
    );
    return months === null ? `${c.display_name}（月龄未知）` : `${c.display_name}（${months} 月龄）`;
  });
  const line1 = `${person.display_name}，会员 ${memberNo}${childParts.length ? '，孩子：' + childParts.join('、') : ''}`;

  // 第二行：最近买过什么（必须带证据）
  const txns = dataset.transactions
    .filter((t) => t.subject_id === person.id && t.status === 'confirmed')
    .sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1));

  const recentTxns = txns.slice(0, 3);
  const line2 = recentTxns.length
    ? '最近购买：' +
      recentTxns
        .map((t) => {
          const items = t.lines
            .map((l) => {
              const p = dataset.products.find((x) => x.id === l.product_id);
              return p ? `${p.name}×${l.quantity}` : `未知商品(${l.product_id})`;
            })
            .join('、');
          return `${items}（${t.occurred_at.slice(0, 10)}）`;
        })
        .join('；')
    : '暂无购买记录';
  for (const t of recentTxns) {
    res.evidence.push(
      txnEvidence(t, `订单 ${t.id}，${t.occurred_at.slice(0, 10)}`),
    );
  }

  // 第三行：建议做什么（安全优先，不做医疗判断）
  let line3 = '暂无特别提示，按客户需求服务。';
  res.status = 'ok';
  for (const child of children) {
    const allergy = getVerifiedAllergies(dataset, child.id);
    if (allergy && allergy.allergens.length > 0) {
      res.evidence.push({
        source_type: 'verified_attribute',
        record_id: `attr:${child.id}:allergy`,
        observed_at: allergy.verifiedAt,
        excerpt: `${child.display_name} 已核实过敏：${allergy.allergens.join('、')}`,
      });
      line3 = `${child.display_name} 有过敏记录（${allergy.allergens.join('、')}，核实于 ${allergy.verifiedAt}），涉及配方选择先转店长人工确认。`;
      res.handoff = true;
      res.actions.push('人工核对过敏相关商品选择');
      break;
    }
  }

  res.answer = `${line1}\n${line2}\n${line3}`;
  return res;
}

// ── 购买查询：买过 X 吗 ───────────────────────────────────────────────

export function askPurchase(
  dataset: MockDataset,
  ctx: RequestContext,
  subjectRef: string,
  productKeyword: string,
): AssistantResponse {
  const res = baseResponse(ctx);
  const denied = assertActorAllowed(dataset, ctx);
  if (denied) {
    res.status = 'forbidden';
    res.answer = `没有权限：${denied}`;
    return res;
  }

  const keyword = productKeyword.trim();
  const matchedProducts = dataset.products.filter(
    (p) => p.tenant_id === ctx.tenant_id && (p.name.includes(keyword) || p.sku.includes(keyword.toUpperCase()) || p.category.includes(keyword)),
  );
  if (matchedProducts.length === 0) {
    res.status = 'no_data';
    res.answer = `店内暂无与「${keyword}」相关的商品资料记录。`;
    return res;
  }

  const person = allSubjects(dataset).find(
    (s) => s.id === subjectRef && s.tenant_id === ctx.tenant_id && s.subject_type === 'person',
  );
  if (!person) {
    res.status = 'no_data';
    res.answer = '未找到该客户，请先确认身份。';
    return res;
  }

  const hits: MockTransaction[] = [];
  for (const txn of dataset.transactions) {
    if (txn.subject_id !== person.id || txn.status !== 'confirmed') continue;
    for (const line of txn.lines) {
      if (matchedProducts.some((p) => p.id === line.product_id)) {
        hits.push(txn);
        break;
      }
    }
  }

  if (hits.length === 0) {
    res.status = 'no_data';
    res.answer = `暂无「${matchedProducts[0].name}」的购买记录。`;
    return res;
  }

  hits.sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1));
  const latest = hits[0];
  const items = latest.lines
    .filter((l) => matchedProducts.some((p) => p.id === l.product_id))
    .map((l) => {
      const p = matchedProducts.find((x) => x.id === l.product_id) as MockProduct;
      return `${p.name}×${l.quantity}`;
    })
    .join('、');
  res.status = 'ok';
  res.answer = `买过。最近一次：${items}，购于 ${latest.occurred_at.slice(0, 10)}。`;
  res.evidence.push(txnEvidence(latest, `订单 ${latest.id} 含「${keyword}」`));
  return res;
}

// ── 安全咨询：能喝/能用 X 吗 ──────────────────────────────────────────

export function askSafety(
  dataset: MockDataset,
  ctx: RequestContext,
  subjectRef: string,
  targetAllergen: string,
): AssistantResponse {
  const res = baseResponse(ctx);
  const denied = assertActorAllowed(dataset, ctx);
  if (denied) {
    res.status = 'forbidden';
    res.answer = `没有权限：${denied}`;
    return res;
  }

  const child = findSubject(dataset, subjectRef, ctx.tenant_id);
  if (!child) {
    res.status = 'no_data';
    res.answer = '未找到该服务对象，请先确认。';
    return res;
  }

  const verdict = assessSafety(dataset, child.id, targetAllergen);
  res.handoff = true; // 健康相关一律转人工，AI 不做可用性结论
  res.actions.push('转店长/人工确认');

  if (verdict.kind === 'blocked') {
    res.evidence.push({
      source_type: 'verified_attribute',
      record_id: `attr:${child.id}:allergy`,
      observed_at: verdict.verified_at,
      excerpt: `${child.display_name} 已核实过敏：${verdict.allergens.join('、')}`,
    });
    res.status = 'needs_human';
    res.answer = `${child.display_name} 有过敏记录：${verdict.allergens.join('、')}（核实于 ${verdict.verified_at}）。含「${targetAllergen}」的商品不适用，本系统不做适用性判断，请转店长人工确认替代方案。`;
    return res;
  }
  if (verdict.kind === 'verified_none') {
    res.status = 'needs_human';
    res.answer = `${child.display_name} 暂无已知过敏记录（上次核实 ${verdict.verified_at}）。过敏情况可能变化，请向家长再次确认后再推荐。`;
    return res;
  }
  res.status = 'needs_human';
  res.answer = `${child.display_name} 暂无已核实的过敏记录。请向家长确认过敏史后再做推荐。`;
  return res;
}

// ── 意图分派（规则，非模型）──────────────────────────────────────────

export function ask(
  dataset: MockDataset,
  ctx: RequestContext,
  question: string,
  subjectRef: string | null,
): AssistantResponse {
  const res = baseResponse(ctx);
  const denied = assertActorAllowed(dataset, ctx);
  if (denied) {
    res.status = 'forbidden';
    res.answer = `没有权限：${denied}`;
    return res;
  }

  // 规则意图：买过X吗 / 能喝X吗 / 和上次一样 / 默认返回卡片
  const purchaseMatch = question.match(/买过(.+?)吗/);
  const safetyMatch = question.match(/能(?:喝|用|吃)(.+?)(?:的)?(?:奶粉|食品|商品)?吗/);
  const sameAsLast = /和上次一样/.test(question);

  if (safetyMatch && subjectRef) {
    return askSafety(dataset, ctx, subjectRef, safetyMatch[1].trim());
  }
  if (sameAsLast && subjectRef) {
    return buildCustomerCard(dataset, ctx, subjectRef);
  }
  if (purchaseMatch && subjectRef) {
    return askPurchase(dataset, ctx, subjectRef, purchaseMatch[1].trim());
  }
  if (subjectRef) {
    return buildCustomerCard(dataset, ctx, subjectRef);
  }
  res.status = 'needs_confirmation';
  res.answer = '请先确认客户身份，再回答具体问题。';
  res.needs_confirmation = true;
  return res;
}
