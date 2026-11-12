import { expect, test } from "@playwright/test";
import { buildSafeOutput, isAuthorizedContext } from "../../adapters/wechat/security";

test.describe("微信适配器安全边界", () => {
  test("缺少可信通道元数据或发送者不在白名单时 fail-closed", () => {
    const allowedSenders = ["staff-open-id-1"];
    expect(isAuthorizedContext({ allowedSenders })).toBe(false);
    expect(isAuthorizedContext({ nativeChannel: "other", sender: "staff-open-id-1", allowedSenders })).toBe(false);
    expect(isAuthorizedContext({ nativeChannel: "openclaw-weixin", sender: "unknown", allowedSenders })).toBe(false);
    expect(isAuthorizedContext({ nativeChannel: "openclaw-weixin", sender: "staff-open-id-1", allowedSenders })).toBe(true);
  });

  test("只把允许的业务字段送入模型上下文", () => {
    const output = buildSafeOutput({
      status: "ok", answer: "有记录", evidence: [], trace_id: "trace-1",
      access_token: "must-not-leak", internal_debug: { sql: "private" },
    });
    expect(output).toEqual({ status: "ok", answer: "有记录", evidence: [], trace_id: "trace-1" });
    expect(output).not.toHaveProperty("access_token");
    expect(output).not.toHaveProperty("internal_debug");
  });
});
