/**
 * 店脑 · OpenClaw 桥接插件（编译后的 JS 版本）
 * 把微信消息转发给店脑网关（7402），返回门店业务结果。
 * 安全：只转发文本；sender 来自 OpenClaw 可信通道元数据；网关侧 fail-closed。
 */
import { Type } from 'typebox';
import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';

const GATEWAY = (process.env.DIANNAO_GATEWAY_BASE ?? 'http://127.0.0.1:7402').replace(/\/$/, '');
const DEFAULT_SENDER = process.env.DIANNAO_DEFAULT_SENDER ?? 'wxid-cli-test';

export default definePluginEntry({
  id: 'diannao-bridge',
  name: 'DianNao Bridge',
  description: '把微信消息转发到店脑网关，返回门店客户、服务记录与绑定结果',
  register(api) {
    api.registerTool(
      (toolContext) => ({
        name: 'dian_nao',
        description:
          '门店业务工具。任何涉及客户查询、购买历史、服务记录、绑定码、反诈咨询的微信消息，都必须先调用它。把用户原话作为 text 传入，直接使用返回内容作为回复。',
        parameters: Type.Object(
          { text: Type.String({ minLength: 1, maxLength: 1000 }) },
          { additionalProperties: false },
        ),
        async execute(_id, params) {
          const sender = toolContext?.requesterSenderId ?? DEFAULT_SENDER;
          try {
            const res = await fetch(`${GATEWAY}/wechat/simulate`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                channel: 'openclaw-weixin',
                message_id: `oc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                sender_id: sender,
                text: params.text,
              }),
              signal: AbortSignal.timeout(15000),
            });
            if (!res.ok) {
              return { content: [{ type: 'text', text: '店脑服务暂不可用，请稍后重试。' }] };
            }
            const body = await res.json();
            return { content: [{ type: 'text', text: String(body.reply ?? '暂无回复') }] };
          } catch {
            return { content: [{ type: 'text', text: '店脑服务暂不可用，请通过网页后台核实。' }] };
          }
        },
      }),
      {
        name: 'dian_nao',
        optional: true,
        promptGuidance:
          'Always call dian_nao for any store/customer/binding question, passing the user text verbatim. Reply with the tool output without rewriting it.',
      },
    );
  },
});
