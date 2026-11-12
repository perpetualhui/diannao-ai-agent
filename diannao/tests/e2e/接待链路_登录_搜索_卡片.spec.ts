import { expect, test } from "@playwright/test";
import { assertMasked, createApiClient } from "./fixtures/api";

test.describe("接待链路契约", () => {
  test("登录 → 唯一匹配 → 卡片回答带证据", async () => {
    const api = createApiClient();
    expect((await api.login("staff-a")).tenantId).toBeTruthy();
    const resolved = await api.resolveIdentity({ tailDigits: "8888" });
    expect(resolved.status).toBe("matched");
    expect(resolved.needs_confirmation).toBe(false);
    expect(resolved.candidates).toHaveLength(1);
    const candidate = resolved.candidates[0];
    expect(candidate).toBeDefined();
    if (!candidate) throw new Error("唯一匹配缺少候选");
    assertMasked(candidate);
    const answer = await api.askAssistant("上次买了什么", candidate.subject_ref);
    expect(answer.status).toBe("ok");
    expect(answer.answer.split("｜")).toHaveLength(3);
    expect(answer.evidence.length).toBeGreaterThan(0);
    expect(answer.evidence[0]?.record_id).toBeTruthy();
    expect(answer.evidence[0]?.observed_at).toBeTruthy();
  });

  test("撞号只返回脱敏候选，未消歧不返回客户事实", async () => {
    const api = createApiClient();
    await api.login("staff-a");
    const resolved = await api.resolveIdentity({ tailDigits: "1234" });
    expect(resolved.status).toBe("ambiguous");
    expect(resolved.needs_confirmation).toBe(true);
    expect(resolved.candidates).toHaveLength(2);
    resolved.candidates.forEach(assertMasked);
    const earlyAnswer = await api.askAssistant("上次买了什么");
    expect(earlyAnswer.status).toBe("needs_confirmation");
    expect(earlyAnswer.evidence).toEqual([]);
  });

  test("无匹配返回空候选", async () => {
    const api = createApiClient();
    await api.login("staff-a");
    const resolved = await api.resolveIdentity({ tailDigits: "0000" });
    expect(resolved.status).toBe("not_found");
    expect(resolved.candidates).toEqual([]);
    expect(resolved.needs_confirmation).toBe(false);
  });

  test("不同租户相同尾号互不可见", async () => {
    const storeA = createApiClient();
    await storeA.login("staff-a");
    expect((await storeA.resolveIdentity({ tailDigits: "1234" })).candidates.map((item) => item.subject_ref)).toEqual(["masked-01", "masked-02"]);
    const storeB = createApiClient();
    await storeB.login("staff-b");
    expect((await storeB.resolveIdentity({ tailDigits: "1234" })).candidates.map((item) => item.subject_ref)).toEqual(["masked-b01"]);
    const forbidden = await storeB.askAssistant("查询 A 店客户", "masked-01");
    expect(forbidden.status).toBe("forbidden");
    expect(forbidden.evidence).toEqual([]);
  });

  test("未登录调用被拒绝", async () => {
    await expect(createApiClient().resolveIdentity({ tailDigits: "1234" })).rejects.toThrow("请先登录");
  });
});
