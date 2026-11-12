export interface TrustedChannelContext {
  nativeChannel?: string;
  sender?: string;
  allowedSenders: readonly string[];
}

export function isAuthorizedContext(context: TrustedChannelContext): boolean {
  return context.nativeChannel === "openclaw-weixin"
    && typeof context.sender === "string"
    && context.sender.length > 0
    && context.allowedSenders.includes(context.sender);
}

const SAFE_RESPONSE_KEYS = [
  "status", "answer", "evidence", "candidates", "needs_confirmation", "handoff", "trace_id",
] as const;

export function buildSafeOutput(body: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const key of SAFE_RESPONSE_KEYS) {
    if (Object.hasOwn(body, key)) output[key] = body[key];
  }
  return output;
}
