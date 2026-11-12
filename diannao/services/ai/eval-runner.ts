/**
 * 评测执行器 —— 主责：张（D）· services/ai
 *
 * 用法：node --experimental-strip-types eval-runner.ts
 * 读取 eval/evalset.json 逐题执行引擎，核对 status / evidence / 关键词 / 红线，
 * 全部通过退出码 0；否则非 0 并列出失败项。
 */

import { readFileSync } from 'node:fs';
import { resolve as pathResolve } from 'node:path';
import {
  ask,
  askSafety,
  buildCustomerCard,
  resolveSubject,
} from './engine.ts';
import { loadDataset, type AssistantResponse, type MockDataset, type RequestContext } from './types.local.ts';

interface EvalCase {
  id: string;
  name: string;
  context: RequestContext;
  input: {
    op: 'resolve' | 'ask' | 'ask_safety' | 'card';
    query?: string;
    subject_ref?: string;
    question?: string;
    target_allergen?: string;
  };
  expected: {
    status: string;
    candidate_count?: number;
    handoff?: boolean;
    evidence_record_ids_include?: string[];
    answer_must_contain?: string[];
    answer_must_not_contain?: string[];
  };
  redlines: string[];
}

interface EvalSet {
  as_of: string;
  dataset_ref: string;
  cases: EvalCase[];
}

// 把 resolveSubject 的联合结果归一为可校验对象
function normalize(result: ReturnType<typeof resolveSubject>): AssistantResponse {
  switch (result.status) {
    case 'matched':
      return {
        status: 'ok',
        answer: `已确认客户：${result.subject.display_name}`,
        evidence: [],
        candidates: [],
        needs_confirmation: false,
        handoff: false,
        actions: [],
        trace_id: 'resolved',
      };
    case 'ambiguous':
      return {
        status: 'needs_confirmation',
        answer: `找到 ${result.candidates.length} 位客户：${result.candidates.map((c) => c.masked_label).join(' / ')}，请补充会员号或姓名确认。`,
        evidence: [],
        candidates: result.candidates,
        needs_confirmation: true,
        handoff: false,
        actions: [],
        trace_id: 'resolved',
      };
    case 'not_found':
      return {
        status: 'no_data',
        answer: '未找到匹配客户，请核对输入。',
        evidence: [],
        candidates: [],
        needs_confirmation: false,
        handoff: false,
        actions: [],
        trace_id: 'resolved',
      };
    case 'forbidden':
      return {
        status: 'forbidden',
        answer: `没有权限：${result.reason}`,
        evidence: [],
        candidates: [],
        needs_confirmation: false,
        handoff: false,
        actions: [],
        trace_id: 'resolved',
      };
  }
}

function runCase(dataset: MockDataset, c: EvalCase): AssistantResponse {
  switch (c.input.op) {
    case 'resolve':
      return normalize(resolveSubject(dataset, c.context, c.input.query ?? ''));
    case 'ask':
      return ask(dataset, c.context, c.input.question ?? '', c.input.subject_ref ?? null);
    case 'ask_safety':
      return askSafety(dataset, c.context, c.input.subject_ref ?? '', c.input.target_allergen ?? '');
    case 'card':
      return buildCustomerCard(dataset, c.context, c.input.subject_ref ?? '');
  }
}

function checkCase(dataset: MockDataset, c: EvalCase): { pass: boolean; failures: string[] } {
  const failures: string[] = [];
  const out = runCase(dataset, c);

  // 语义状态归一：evalset 用产品口径 status，引擎按 OpenAPI status 返回。
  // ambiguous 预期 = resolve 歧义（引擎 ambiguous → 归一 needs_confirmation + candidates.length>1）
  let actualStatus = out.status;
  if (actualStatus === 'needs_confirmation' && out.candidates.length > 1) actualStatus = 'ambiguous';

  if (actualStatus !== c.expected.status) {
    failures.push(`status 期望 ${c.expected.status}，实际 ${actualStatus}`);
  }
  if (c.expected.candidate_count !== undefined && out.candidates.length !== c.expected.candidate_count) {
    failures.push(`候选数期望 ${c.expected.candidate_count}，实际 ${out.candidates.length}`);
  }
  if (c.expected.handoff !== undefined && out.handoff !== c.expected.handoff) {
    failures.push(`handoff 期望 ${c.expected.handoff}，实际 ${out.handoff}`);
  }
  for (const rid of c.expected.evidence_record_ids_include ?? []) {
    if (!out.evidence.some((e) => e.record_id === rid)) {
      failures.push(`缺少证据 record_id=${rid}`);
    }
  }
  for (const kw of c.expected.answer_must_contain ?? []) {
    if (!out.answer.includes(kw)) {
      failures.push(`answer 缺少关键词「${kw}」`);
    }
  }
  for (const kw of c.expected.answer_must_not_contain ?? []) {
    if (out.answer.includes(kw)) {
      failures.push(`answer 出现禁用词「${kw}」（红线）`);
    }
  }
  return { pass: failures.length === 0, failures };
}

// ── main ─────────────────────────────────────────────────────────────

const here = import.meta.dirname ?? '.';
const datasetRaw = JSON.parse(
  readFileSync(pathResolve(here, 'data', 'mock_data.json'), 'utf-8'),
);
const dataset = loadDataset(datasetRaw);
const evalset = JSON.parse(
  readFileSync(pathResolve(here, '..', '..', 'eval', 'evalset.json'), 'utf-8'),
) as EvalSet;

console.log(`评测基准日：${evalset.as_of}`);
console.log(`数据集：${evalset.dataset_ref}`);
console.log(`用例数：${evalset.cases.length}`);
console.log('─'.repeat(60));

let passed = 0;
const failed: { id: string; name: string; failures: string[] }[] = [];

for (const c of evalset.cases) {
  const { pass, failures } = checkCase(dataset, c);
  if (pass) {
    passed += 1;
    console.log(`PASS  ${c.id}  ${c.name}`);
  } else {
    failed.push({ id: c.id, name: c.name, failures });
    console.log(`FAIL  ${c.id}  ${c.name}`);
    for (const f of failures) console.log(`      └ ${f}`);
  }
}

console.log('─'.repeat(60));
console.log(`结果：${passed}/${evalset.cases.length} 通过`);
if (failed.length > 0) {
  console.log('失败用例：', failed.map((f) => f.id).join(', '));
  process.exit(1);
}
console.log('全部通过。');
