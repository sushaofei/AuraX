"""SSH-only development uplink. Run in the pinned AuraClaw runtime image.

The SSH connection authenticates access. This is not a public login service.
Only the public AuraClaw API is proxied; browser identity headers are never trusted.
"""
from __future__ import annotations

import json
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4

import httpx
import uvicorn
from fastapi import FastAPI, Request
from starlette.background import BackgroundTask
from starlette.responses import JSONResponse, StreamingResponse
from starlette.staticfiles import StaticFiles

from auraclaw.infrastructure.identity import AgentContextSigner
from evaluation_reports import Report

IDENTITY_HEADERS = {"X-Tenant-ID": "tenantId", "X-Dept-ID": "deptId", "X-Actor-ID": "userId"}
FORWARD_HEADERS = {
    "accept", "content-type", "idempotency-key", "x-expected-version", "x-expected-revision",
    "last-event-id", "if-none-match", "range", "x-correlation-id",
    "x-reason-code", "x-revocation-action", "x-skill-revocation-action",
    "x-upload-name", "x-content-sha256",
}
RESPONSE_HEADERS = {
    "content-type", "content-encoding", "content-disposition", "etag", "last-modified",
    "content-range", "accept-ranges", "retry-after",
}
MAX_BODY = 16 * 1024 * 1024


def create_app(*, static_dir: Path, upstream_url: str, identity: dict[str, str],
               workload_token: str, signer: AgentContextSigner,
               transport: httpx.AsyncBaseTransport | None = None,
               evaluation_file: Path | None = None) -> FastAPI:
    upstream = urlsplit(upstream_url)
    if (upstream.scheme not in {"http", "https"} or not upstream.hostname
            or upstream.username or upstream.password or upstream.query or upstream.fragment
            or upstream.path not in {"", "/"}):
        raise ValueError("Require a fixed upstream origin")
    if set(identity) != {"tenantId", "deptId", "userId"} or not all(identity.values()):
        raise ValueError("Require a fixed nonempty deployment identity")
    if not workload_token:
        raise ValueError("Require an upstream workload credential")

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        async with httpx.AsyncClient(
            transport=transport, trust_env=False, follow_redirects=False,
            timeout=httpx.Timeout(connect=5, read=None, write=30, pool=5),
        ) as client:
            app.state.upstream = client
            yield

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    @app.middleware("http")
    async def protect(request: Request, call_next):
        if request.url.hostname not in {"localhost", "127.0.0.1", "::1"}:
            return JSONResponse({"message": "Use the localhost SSH tunnel"}, status_code=403)
        origin = request.headers.get("origin")
        if (request.headers.get("sec-fetch-site") == "cross-site"
                or (origin is not None and origin != f"{request.url.scheme}://{request.url.netloc}")):
            return JSONResponse({"message": "Cross-origin access is forbidden"}, status_code=403)
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            "connect-src 'self'; img-src 'self' data: https:; object-src 'none'; "
            "base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
        )
        return response

    @app.get("/health/live")
    async def live():
        return {"status": "ok"}

    @app.get("/aurax/environment")
    async def environment():
        return {"identity": identity, "mode": "server-fixed"}

    @app.get("/aurax/evaluations")
    async def evaluations(request: Request):
        for header, field in IDENTITY_HEADERS.items():
            if request.headers.get(header, identity[field]) != identity[field]:
                return JSONResponse({"message": "此工作台使用固定测试身份"}, status_code=403)
        if evaluation_file is None or not evaluation_file.exists():
            return JSONResponse({"message": "尚未配置评测报告"}, status_code=404)
        try:
            if evaluation_file.stat().st_size > 8 * 1024 * 1024:
                raise ValueError("Report too large")
            report = Report.model_validate_json(evaluation_file.read_bytes())
        except (OSError, ValueError):
            return JSONResponse({"message": "评测报告暂时不可用，请联系管理员"}, status_code=503)
        return report.model_dump(mode="json")

    @app.api_route("/v1/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"])
    async def proxy(request: Request, path: str):
        if any(part in {".", "..", ""} for part in path.split("/")):
            return JSONResponse({"message": "Invalid public API path"}, status_code=400)
        for header, field in IDENTITY_HEADERS.items():
            if request.headers.get(header, identity[field]) != identity[field]:
                return JSONResponse({"code": "fixed_identity", "message": "此工作台使用固定测试身份"}, status_code=403)
        body = bytearray()
        async for chunk in request.stream():
            if len(body) + len(chunk) > MAX_BODY:
                return JSONResponse({"message": "Request exceeds 16 MiB"}, status_code=413)
            body.extend(chunk)
        now = int(time.time())
        claims = {
            "iss": "upstream", "aud": "auraclaw-task-api", "tenant_id": identity["tenantId"],
            "user_id": identity["userId"], "dept_id": identity["deptId"],
            "scopes": ["agent.task.invoke"], "iat": now, "exp": now + 120, "jti": uuid4().hex,
        }
        parts = path.split("/")
        if len(parts) >= 2 and parts[0] in {"tasks", "sessions", "streams"} and parts[1].startswith("ses_"):
            claims["session_id"] = parts[1]
        headers = {k: v for k, v in request.headers.items() if k.lower() in FORWARD_HEADERS}
        headers.update({header: identity[field] for header, field in IDENTITY_HEADERS.items()})
        headers["Authorization"] = "Bearer " + workload_token
        headers["X-Aura-Agent-Context"] = signer.sign(claims)
        url = httpx.URL(upstream_url.rstrip("/") + request.url.path).copy_with(query=request.url.query.encode())
        client = app.state.upstream
        try:
            response = await client.send(client.build_request(request.method, url, headers=headers, content=bytes(body)), stream=True)
        except httpx.HTTPError:
            return JSONResponse({"code": "uplink_unavailable", "message": "暂时无法连接 AuraClaw"}, status_code=502)
        return StreamingResponse(
            response.aiter_raw(), status_code=response.status_code,
            headers={k: v for k, v in response.headers.items() if k.lower() in RESPONSE_HEADERS},
            background=BackgroundTask(response.aclose),
        )

    # Do not turn unknown API/internal paths into a misleading HTTP-200 SPA shell.
    @app.api_route("/internal/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"])
    async def internal(path: str):
        return JSONResponse({"message": "Not found"}, status_code=404)

    app.mount("/", StaticFiles(directory=static_dir, html=True), name="web")
    return app


def main() -> None:
    if os.environ.get("AURAX_DEPLOYMENT_PROFILE") != "development":
        raise SystemExit("SSH-only uplink requires the development profile")
    keys = json.loads(Path(os.environ["AURAX_SIGNING_KEYS_FILE"]).read_text())
    kid = sorted(keys)[0]
    app = create_app(
        static_dir=Path(os.environ["AURAX_STATIC_DIR"]),
        upstream_url=os.environ["AURACLAW_UPSTREAM"],
        identity={"tenantId": os.environ.get("AURAX_TENANT_ID", "platform"),
                  "deptId": os.environ.get("AURAX_DEPT_ID", "local-org"),
                  "userId": os.environ.get("AURAX_USER_ID", "local-user")},
        workload_token=Path(os.environ["AURAX_WORKLOAD_TOKEN_FILE"]).read_text().strip(),
        signer=AgentContextSigner(key_id=kid, signing_key=keys[kid].encode()),
        evaluation_file=Path(os.environ["AURAX_EVALUATION_FILE"]) if os.environ.get("AURAX_EVALUATION_FILE") else None,
    )
    uvicorn.run(app, host="0.0.0.0", port=1420, access_log=False, proxy_headers=False)


if __name__ == "__main__":
    main()
