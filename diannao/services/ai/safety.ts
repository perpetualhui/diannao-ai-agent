/**
 * 安全字段阻断 —— 主责：张（D）· services/ai
 *
 * 铁律（01-共用开发规范.md 第 5 节）：
 *  - 安全/健康字段：任何自动推断不得覆盖人工已确认的禁忌
 *  - 冲突先阻断高风险推荐并转人工
 * 本模块不做任何「能不能喝」的医学判断，只做三件事：
 *  1. 有已核实过敏记录且目标商品成分命中 → 阻断 + 转人工
 *  2. 有已核实记录但目标成分未命中 → 提示记录存在，仍建议人工核对
 *  3. 无已核实记录 → 「暂无已知过敏记录」，仍转人工确认（记录可能过时）
 */

import type { MockAttribute, MockDataset, MockProduct } from './types.local.ts';

export type SafetyVerdict =
  | { kind: 'blocked'; allergens: string[]; verified_at: string }   // 命中禁忌：阻断
  | { kind: 'verified_none'; verified_at: string }                    // 已核实无过敏
  | { kind: 'unknown' };                                             // 无核实记录

/** 查询某服务对象已核实的过敏记录（safety 字段，status=verified） */
export function getVerifiedAllergies(
  dataset: MockDataset,
  subjectId: string,
): { allergens: string[]; verifiedAt: string } | null {
  const attr: MockAttribute | undefined = dataset.attributes.find(
    (a) =>
      a.subject_id === subjectId &&
      a.attr_key === 'allergy' &&
      a.data_class === 'safety' &&
      a.status === 'verified',
  );
  if (!attr) return null;
  const value = attr.value;
  const allergens: string[] = Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string')
    : [];
  return { allergens, verifiedAt: attr.observed_at };
}

/**
 * 判定「目标商品」对该服务对象是否被安全字段阻断。
 * onlyBlockedOnExactHit=true：只有已核实过敏列表里明确包含目标成分才阻断；
 * 记录不存在或为空一律不阻断，但回答层仍需转人工。
 */
export function assessSafety(
  dataset: MockDataset,
  subjectId: string,
  targetAllergen: string,
): SafetyVerdict {
  const rec = getVerifiedAllergies(dataset, subjectId);
  if (!rec) return { kind: 'unknown' };
  if (rec.allergens.length === 0) return { kind: 'verified_none', verified_at: rec.verifiedAt };
  if (rec.allergens.includes(targetAllergen)) {
    return { kind: 'blocked', allergens: rec.allergens, verified_at: rec.verifiedAt };
  }
  return { kind: 'verified_none', verified_at: rec.verifiedAt };
}

/** 判断商品名/属性是否包含某成分关键词（规则匹配，不做医学推理） */
export function productMentionsAllergen(product: MockProduct, allergen: string): boolean {
  const haystack = `${product.name} ${JSON.stringify(product.attributes)}`;
  return haystack.includes(allergen);
}

/** 排除被过敏成分阻断的商品；返回可通过安全筛选的商品子集 */
export function filterBySafety(
  dataset: MockDataset,
  subjectId: string,
  products: MockProduct[],
): { safe: MockProduct[]; blocked: { product: MockProduct; allergen: string }[] } {
  const rec = getVerifiedAllergies(dataset, subjectId);
  const safe: MockProduct[] = [];
  const blocked: { product: MockProduct; allergen: string }[] = [];
  for (const p of products) {
    if (rec && rec.allergens.some((a) => productMentionsAllergen(p, a))) {
      const hit = rec.allergens.find((a) => productMentionsAllergen(p, a));
      if (hit) blocked.push({ product: p, allergen: hit });
      continue;
    }
    safe.push(p);
  }
  return { safe, blocked };
}
