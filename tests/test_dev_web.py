"""Optional Python tests, using the pinned AuraClaw development environment."""
import base64
import hashlib
import hmac
import importlib.util
import json
import sys
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from auraclaw.infrastructure.identity import AgentContextSigner

sys.path.insert(0, str(Path(__file__).parents[1] / "deploy"))

spec = importlib.util.spec_from_file_location("dev_web", Path(__file__).parents[1] / "deploy/dev_web.py")
web = importlib.util.module_from_spec(spec)
spec.loader.exec_module(web)
IDENTITY = {"tenantId": "platform", "deptId": "local-org", "userId": "local-user"}


def client(tmp_path, handler, evaluation_file=None):
    (tmp_path / "index.html").write_text("<title>AuraX</title>")
    app = web.create_app(
        static_dir=tmp_path, upstream_url="http://ingress:8080", identity=IDENTITY,
        workload_token="server-only", signer=AgentContextSigner(key_id="test", signing_key=b"k" * 32),
        transport=httpx.MockTransport(handler), evaluation_file=evaluation_file,
    )
    return TestClient(app, base_url="http://127.0.0.1:1420")


def response(data=b'{"ok":true}', content_type="application/json"):
    return httpx.Response(200, stream=httpx.ByteStream(data), headers={"content-type": content_type})


def test_proxy_signs_fixed_identity_and_preserves_commands(tmp_path):
    requests = []
    def handler(request):
        requests.append(request)
        return response()
    with client(tmp_path, handler) as c:
        for _ in range(2):
            r = c.post("/v1/sessions/ses_demo/messages", headers={
                "Idempotency-Key": "same-command", "X-Expected-Version": "8",
                "Authorization": "Bearer forged", "X-Aura-Agent-Context": "forged",
                "X-Reason-Code": "test-reason", "X-Revocation-Action": "pause",
                "X-Skill-Revocation-Action": "cancel", "X-Upload-Name": "skill.zip",
                "X-Content-SHA256": "a" * 64,
            }, json={"text": "hello"})
            assert r.status_code == 200
        assert c.get("/aurax/environment").json() == {"identity": IDENTITY, "mode": "server-fixed"}
        assert "server-only" not in c.get("/").text
    identities = []
    for request in requests:
        payload, signature = request.headers["x-aura-agent-context"].split(".")
        raw = base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4))
        claims = json.loads(raw)
        assert claims["tenant_id"] == "platform" and claims["session_id"] == "ses_demo"
        assert claims["user_id"] == "local-user" and claims["dept_id"] == "local-org"
        assert claims["exp"] - claims["iat"] == 120
        assert base64.urlsafe_b64decode(signature + "=" * (-len(signature) % 4)) == hmac.new(b"k" * 32, raw, hashlib.sha256).digest()
        assert request.headers["authorization"] == "Bearer server-only"
        assert request.headers["idempotency-key"] == "same-command"
        assert request.headers["x-expected-version"] == "8"
        assert request.headers["x-reason-code"] == "test-reason"
        assert request.headers["x-revocation-action"] == "pause"
        assert request.headers["x-skill-revocation-action"] == "cancel"
        assert request.headers["x-upload-name"] == "skill.zip"
        assert request.headers["x-content-sha256"] == "a" * 64
        assert json.loads(request.content) == {"text": "hello"}
        identities.append(claims["jti"])
    assert len(set(identities)) == 2


@pytest.mark.parametrize("path,headers,status", [
    ("/v1/tasks", {"X-Tenant-ID": "other"}, 403),
    ("/v1/tasks", {"Origin": "http://evil.invalid"}, 403),
    ("/v1/tasks", {"Sec-Fetch-Site": "cross-site"}, 403),
    ("/v1/tasks", {"Host": "evil.invalid"}, 403),
    ("/internal/v1/session/feed", {}, 404),
])
def test_untrusted_browser_requests_never_reach_upstream(tmp_path, path, headers, status):
    def forbidden(request):
        raise AssertionError("Must not reach upstream")
    with client(tmp_path, forbidden) as c:
        assert c.get(path, headers=headers).status_code == status


def test_proxy_preserves_sse_and_closes_upstream(tmp_path):
    frames = b'id: one\nevent: progress\ndata: {}\n\nid: two\ndata: done\n\n'
    seen = []
    def handler(request):
        seen.append(request)
        return response(frames, "text/event-stream")
    with client(tmp_path, handler) as c:
        with c.stream("GET", "/v1/streams/ses_demo", headers={"Last-Event-ID": "one"}) as r:
            assert r.status_code == 200
            assert "text/event-stream" in r.headers["content-type"]
            assert b"".join(r.iter_bytes()) == frames
    assert seen[0].headers["last-event-id"] == "one"


def test_upstream_errors_are_redacted_and_large_bodies_not_forwarded(tmp_path, monkeypatch):
    def unavailable(request):
        raise httpx.ConnectError("private server credential", request=request)
    with client(tmp_path, unavailable) as c:
        result = c.get("/v1/tasks")
        assert result.status_code == 502 and "private server" not in result.text
        monkeypatch.setattr(web, "MAX_BODY", 4)
        assert c.post("/v1/tasks", content=b"too-large").status_code == 413


def test_public_upstream_errors_remain_errors(tmp_path):
    with client(tmp_path, lambda r: httpx.Response(404, stream=httpx.ByteStream(b'{}'))) as c:
        assert c.get("/v1/unknown").status_code == 404


def test_production_profile_refused(monkeypatch):
    monkeypatch.setenv("AURAX_DEPLOYMENT_PROFILE", "production")
    with pytest.raises(SystemExit, match="development"):
        web.main()


def test_evaluations_missing_invalid_and_fixed_identity(tmp_path):
    path = tmp_path / "report.json"
    with client(tmp_path, lambda request: response(), evaluation_file=path) as c:
        assert c.get("/aurax/evaluations").status_code == 404
        path.write_text('{"private_task":"DO-NOT-LEAK"}')
        result = c.get("/aurax/evaluations")
        assert result.status_code == 503
        assert "DO-NOT-LEAK" not in result.text
        path.write_text('{"schema_version":1,"exported_at":"2026-10-21T08:00:00Z","runs":[]}')
        assert c.get("/aurax/evaluations").json()["runs"] == []
        assert c.get("/aurax/evaluations", headers={"X-Tenant-ID": "other"}).status_code == 403
        assert c.get("/aurax/evaluations", headers={"Origin": "https://evil.test"}).status_code == 403
        value = json.loads(path.read_text()); value["raw_trace"] = "DO-NOT-LEAK"
        path.write_text(json.dumps(value))
        assert c.get("/aurax/evaluations").status_code == 503
