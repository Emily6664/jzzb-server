"""pytest 公共夹具：临时数据库 + 已触发 lifespan 的 TestClient。

注意：环境变量必须在 import app 之前设好，get_settings() 有 lru_cache。
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest

_TMP_DIR = Path(tempfile.mkdtemp(prefix="xiangyu-api-test-"))

os.environ["DB_PATH"] = str(_TMP_DIR / "test.db")
os.environ["SEED_ON_STARTUP"] = "true"
os.environ["SEED_DEMO_DATA"] = "true"
os.environ["AUTH_REQUIRED"] = "false"
os.environ["MOCK_PAY_AUTO_CONFIRM"] = "true"
os.environ["NOT_FOUND_AS_NULL"] = "true"
os.environ["LOG_LEVEL"] = "WARNING"
# 测试必须走「本地合成」，否则开发机 .env 里配了 IMAGE_API_KEY 就会真的去调外部服务
os.environ["IMAGE_API_KEY"] = ""
os.environ["DOCS_ENABLED"] = "true"

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(scope="session")
def api() -> str:
    return "/api"


@pytest.fixture(scope="session")
def token(client: TestClient, api: str) -> str:
    response = client.post(
        f"{api}/user/login",
        json={"loginCode": "test-login-code", "phoneCode": "test-phone-code"},
    )
    payload = response.json()
    assert payload["code"] == 0, payload
    return payload["data"]["token"]
