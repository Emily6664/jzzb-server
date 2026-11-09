"""默认采用 OpenAI 兼容 chat/completions；不自动重试付费生成。"""
from __future__ import annotations

import base64
import binascii
import re
from urllib.parse import urlsplit

import httpx

from ..config import get_settings
from ..errors import BizError, CODE_SERVER_ERROR, bad_request

DATA_IMAGE = re.compile(r"^data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=\s]+)$")


def decode_image(value: str) -> tuple[bytes, str]:
    match = DATA_IMAGE.fullmatch(value)
    if not match:
        raise bad_request("请上传 PNG、JPEG 或 WebP 格式的图片")
    try:
        data = base64.b64decode(re.sub(r"\s", "", match[2]), validate=True)
    except (ValueError, binascii.Error):
        raise bad_request("图片编码无效")
    if not data or len(data) > 8 * 1024 * 1024:
        raise bad_request("图片不能为空且不能超过 8MB")
    kind = match[1]
    valid = ((kind == "png" and data.startswith(b"\x89PNG\r\n\x1a\n")) or
             (kind == "jpeg" and data.startswith(b"\xff\xd8\xff")) or
             (kind == "webp" and data[:4] == b"RIFF" and data[8:12] == b"WEBP"))
    if not valid:
        raise bad_request("图片内容与格式不匹配")
    return data, "jpg" if kind == "jpeg" else kind


def extract_image(body: dict) -> str:
    choices = body.get("choices") or []
    message = choices[0].get("message", {}) if choices else {}
    parts = message.get("content") or []
    images = message.get("images") or []
    for part in images + (parts if isinstance(parts, list) else []):
        if not isinstance(part, dict):
            continue
        value = part.get("image_url", {})
        url = value.get("url") if isinstance(value, dict) else value
        if url:
            return url
        if part.get("inline_data") or part.get("inlineData"):
            inline = part.get("inline_data") or part.get("inlineData")
            return "data:" + (inline.get("mime_type") or inline.get("mimeType") or "image/png") + ";base64," + inline["data"]
    text = parts if isinstance(parts, str) else "\n".join(p.get("text", "") for p in parts if isinstance(p, dict))
    match = re.search(r"data:image/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+", text)
    if match:
        return match[0]
    match = re.search(r"!\[[^]]*\]\((https://[^\s)]+)\)", text)
    if match:
        return match[1]
    raise BizError(CODE_SERVER_ERROR, "模型未返回图片，请核对服务商是否支持图像输出及其接口协议")


def generate(image: str, theme: str, work_id: str) -> str:
    settings = get_settings()
    input_data, input_extension = decode_image(image)
    if not settings.image_api_key:
        raise BizError(CODE_SERVER_ERROR, "尚未配置图生图服务密钥")
    style = "童趣手绘，柔和明亮配色，蜡笔和剪纸质感" if theme == "childlike" else "复古乡土插画，暖色旧纸和木刻版画质感"
    prompt = "请根据输入的家庭拼贴图片生成一张完整插画。保留主要风物、人物、主体位置和家庭共同创作的布局。风格：" + style + "。画面温暖友好，不添加水印或无关文字。请直接输出生成的图片。"
    try:
        with httpx.Client(timeout=settings.image_timeout_seconds) as client:
            if settings.image_model.startswith("gpt-image-"):
                response = client.post(settings.image_api_base.rstrip("/") + "/images/edits",
                    headers={"Authorization": "Bearer " + settings.image_api_key},
                    data={"model": settings.image_model, "prompt": prompt, "n": "1"},
                    files={"image": ("collage." + input_extension, input_data,
                        "image/jpeg" if input_extension == "jpg" else "image/" + input_extension)})
                response.raise_for_status()
                item = response.json()["data"][0]
                result = ("data:image/png;base64," + item["b64_json"]) if item.get("b64_json") else item["url"]
            else:
                response = client.post(settings.image_api_base.rstrip("/") + "/chat/completions",
                    headers={"Authorization": "Bearer " + settings.image_api_key},
                    json={"model": settings.image_model, "stream": False,
                          "messages": [{"role": "user", "content": [
                              {"type": "text", "text": prompt},
                              {"type": "image_url", "image_url": {"url": image}}]}]})
                response.raise_for_status()
                result = extract_image(response.json())
    except (httpx.HTTPError, ValueError, KeyError, TypeError, IndexError):
        raise BizError(CODE_SERVER_ERROR, "图生图服务请求失败，请检查配置或稍后重试") from None
    if result.startswith("data:"):
        data, extension = decode_image(result)
        directory = settings.media_dir / "work"
        directory.mkdir(parents=True, exist_ok=True)
        name = work_id + "." + extension
        (directory / name).write_bytes(data)
        return "/media/work/" + name
    parsed = urlsplit(result)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise BizError(CODE_SERVER_ERROR, "模型返回的图片地址无效")
    return result
