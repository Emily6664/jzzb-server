import base64

import httpx
import pytest

from app.config import get_settings
from app.errors import BizError
from app.services import image_generation as images

PNG = "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\nexample").decode()


def test_chat_image_generation(monkeypatch, tmp_path):
    settings = get_settings()
    monkeypatch.setattr(settings, "image_api_key", "test-secret")
    monkeypatch.setattr(settings, "media_dir", tmp_path)
    monkeypatch.setattr(settings, "image_model", "[ant]gemini-2.5-flash")
    original = httpx.Client
    def handler(request):
        assert request.url.path == "/v1/chat/completions"
        assert request.headers["authorization"] == "Bearer test-secret"
        assert b"image_url" in request.content
        return httpx.Response(200, json={"choices": [{"message": {"content": [{"type": "image_url", "image_url": {"url": PNG}}]}}]})
    monkeypatch.setattr(images.httpx, "Client", lambda **kw: original(transport=httpx.MockTransport(handler), **kw))
    assert images.generate(PNG, "childlike", "test-work") == "/media/work/test-work.png"
    assert (tmp_path / "work/test-work.png").read_bytes().startswith(b"\x89PNG")


def test_text_only_is_not_success():
    with pytest.raises(BizError, match="模型未返回图片"):
        images.extract_image({"choices": [{"message": {"content": "只有文字"}}]})


def test_invalid_input():
    with pytest.raises(BizError):
        images.decode_image("data:image/png;base64,aGVsbG8=")


def test_generate_endpoint_uses_remote_service_when_configured(client, monkeypatch):
    """配了 IMAGE_API_KEY 时走外部图生图；返回的相对路径要转成对外 URL。"""
    from PIL import Image as PILImage

    settings = get_settings()
    monkeypatch.setattr(settings, "image_api_key", "test-secret")

    created = []

    def fake_generate(image: str, theme: str, work_id: str) -> str:
        target = settings.media_dir / "work" / f"{work_id}.png"
        target.parent.mkdir(parents=True, exist_ok=True)
        PILImage.new("RGB", (640, 480), (198, 120, 90)).save(target)
        created.append(target)
        return "/media/work/" + target.name

    monkeypatch.setattr(images, "generate", fake_generate)

    templates = client.get("/api/collage/templates").json()["data"]
    body = client.post(
        "/api/collage/generate",
        json={"templateId": templates[0]["templateId"], "image": PNG},
    ).json()

    assert body["code"] == 0, body
    work = body["data"]
    assert "/media/work/" in work["imageUrl"]
    assert (work["width"], work["height"]) == (640, 480)

    saved = client.post(
        "/api/collage/works", json={"workId": work["workId"], "imageUrl": work["imageUrl"]}
    ).json()
    assert saved["code"] == 0

    for path in created:
        path.unlink(missing_ok=True)


def test_image_edit_protocol(monkeypatch, tmp_path):
    settings = get_settings()
    monkeypatch.setattr(settings, "image_api_key", "test-secret")
    monkeypatch.setattr(settings, "image_model", "gpt-image-2")
    monkeypatch.setattr(settings, "media_dir", tmp_path)
    original = httpx.Client
    def handler(request):
        assert request.url.path == "/v1/images/edits"
        assert request.headers["content-type"].startswith("multipart/form-data")
        assert b'filename="collage.png"' in request.content
        return httpx.Response(200, json={"data": [{"b64_json": PNG.split(",", 1)[1]}]})
    monkeypatch.setattr(images.httpx, "Client", lambda **kw: original(transport=httpx.MockTransport(handler), **kw))
    assert images.generate(PNG, "retro", "edit-work") == "/media/work/edit-work.png"
