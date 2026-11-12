#!/usr/bin/env python3
"""Read-only prototype client for DianNao business API.

This client is NOT a multi-user WeChat identity bridge: the bearer token must
be bound server-side to a single authorized employee/tenant. For public use,
implement a trusted channel identity adapter and short-lived scoped tokens.
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request


def main():
    if len(sys.argv) != 2 or not sys.argv[1].strip():
        print(json.dumps({"status": "invalid_request", "answer": "请提供查询问题"}, ensure_ascii=False))
        return 2
    question = sys.argv[1].strip()
    if len(question) > 1000:
        print(json.dumps({"status": "invalid_request", "answer": "问题过长，请精简"}, ensure_ascii=False))
        return 2
    base = os.getenv("DIANNAO_API_BASE", "").strip().rstrip("/")
    token = os.getenv("DIANNAO_API_TOKEN", "").strip()
    if not base.startswith("https://") or not token:
        print(json.dumps({"status": "not_configured", "answer": "店脑业务接口尚未安全配置"}, ensure_ascii=False))
        return 3
    url = base + "/v1/assistant/ask"
    req = urllib.request.Request(
        url,
        data=json.dumps({"question": question}, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json; charset=utf-8",
            "Accept": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=12) as res:
            response = json.loads(res.read(100000).decode("utf-8"))
    except urllib.error.HTTPError as exc:
        response = {"status": "forbidden" if exc.code in (401, 403) else "service_error",
                    "answer": "没有权限查询或业务服务暂不可用", "http_code": exc.code}
    except (urllib.error.URLError, TimeoutError, ValueError):
        response = {"status": "service_unavailable", "answer": "业务查询暂不可用，请通过网页后台核实"}
    # Only allow a minimal response schema to enter the agent's prompt.
    allowed = {k: response.get(k) for k in
               ("status", "answer", "evidence", "candidates", "needs_confirmation", "handoff", "trace_id")
               if k in response}
    print(json.dumps(allowed, ensure_ascii=False, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
