/**
 * DianNao read-only OpenClaw tool prototype.
 * Does NOT implement a WeChat channel; Tencent's openclaw-weixin owns that part.
 * Production multi-user access needs per-sender server-issued authorization.
 *
 * 迁入自 起始包 plugin/index.ts（2026-11-07）。安全模型未改：
 * 仅当 nativeChannelId === openclaw-weixin 且 requesterSenderId 在白名单时才调 API；
 * 缺失可信通道元数据时 fail-closed。默认无人有权限。
 */
import { Type } from "typebox";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { buildSafeOutput, isAuthorizedContext } from "./security";

const deny = (message: string) => ({ content: [{ type: "text" as const, text: message }] });

export default definePluginEntry({
  id: "dian-nao-tool",
  name: "DianNao AI Readonly Tool",
  description: "Single-staff internal demo tool that calls a restricted DianNao API",
  register(api) {
    api.registerTool(
      (toolContext) => ({
        name: "dian_nao_ask",
        description: "Read-only lookup of authorized store records with evidence. Never used for unbound customers or public anti-fraud requests.",
        parameters: Type.Object({ question: Type.String({ minLength: 1, maxLength: 1000 }) }, { additionalProperties: false }),
        async execute(_id, params) {
          const sender = toolContext.requesterSenderId;
          const nativeChannel = toolContext.nativeChannelId;
          const allowedSenders = (process.env.DIANNAO_ALLOWED_SENDER_IDS || "")
            .split(",").map((s) => s.trim()).filter(Boolean);
          // Fail closed when the trusted channel metadata is missing.
          if (!isAuthorizedContext({ nativeChannel, sender, allowedSenders })) {
            return deny("无权限：需要已绑定、经过确认的微信内部员工身份。");
          }
          const base = (process.env.DIANNAO_API_BASE || "").replace(/\/$/, "");
          const token = process.env.DIANNAO_API_TOKEN || "";
          if (!base.startsWith("https://") || !token) {
            return deny("店脑业务 API 尚未配置，无法查询内部客户资料。");
          }
          try {
            const res = await fetch(`${base}/v1/assistant/ask`, {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json",
                "Accept": "application/json",
              },
              body: JSON.stringify({ question: params.question }),
              signal: AbortSignal.timeout(12000),
            });
            if (!res.ok) return deny(`店脑 API 返回 ${res.status}：没有权限或服务暂不可用。`);
            const body: Record<string, unknown> = await res.json() as Record<string, unknown>;
            // Never forward unknown backend fields, tokens or credentials to the model.
            const output = buildSafeOutput(body);
            return { content: [{ type: "text", text: JSON.stringify(output) }] };
          } catch {
            return deny("店脑 API 暂时不可用，请通过网页后台核实。 ");
          }
        },
      }),
      {
        name: "dian_nao_ask",
        optional: true,
        promptGuidance: "Only use dian_nao_ask for a verified internal staff sender. Never infer private customer facts; quote the evidence returned by the backend.",
      },
    );
  },
});
