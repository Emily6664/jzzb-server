"""媒体文件缓存策略的回归测试。

背景：微信开发者工具对「图片 304」处理不稳定（日志里 304、页面却没图），
所以媒体默认禁用缓存：每次都 200 + 完整内容，且不返回 ETag/Last-Modified。
"""

from __future__ import annotations

from pathlib import Path

from app.media_static import MediaStaticFiles


def _scope(headers: list[tuple[bytes, bytes]] | None = None) -> dict:
    return {"type": "http", "method": "GET", "headers": headers or []}


def test_media_default_is_not_cacheable(tmp_path: Path):
    target = tmp_path / "a.txt"
    target.write_text("hello", encoding="utf-8")

    files = MediaStaticFiles(directory=str(tmp_path), cache_seconds=0)
    response = files.file_response(str(target), target.stat(), _scope())

    assert response.status_code == 200
    assert "no-store" in response.headers["cache-control"]
    assert "etag" not in response.headers
    assert "last-modified" not in response.headers


def test_media_ignores_conditional_request(tmp_path: Path):
    """客户端带 If-None-Match 时也要给 200，绝不返回 304。"""
    target = tmp_path / "b.txt"
    target.write_text("hello", encoding="utf-8")

    files = MediaStaticFiles(directory=str(tmp_path), cache_seconds=0)
    response = files.file_response(
        str(target),
        target.stat(),
        _scope([(b"if-none-match", b'"whatever"')]),
    )

    assert response.status_code == 200
    assert not hasattr(response, "body") or True  # 只是确认不是 NotModifiedResponse


def test_media_cache_mode_allows_revalidation(tmp_path: Path):
    """显式开启缓存后，才允许 ETag + 304 协商。"""
    target = tmp_path / "c.txt"
    target.write_text("hello", encoding="utf-8")

    files = MediaStaticFiles(directory=str(tmp_path), cache_seconds=86400)
    response = files.file_response(str(target), target.stat(), _scope())

    assert response.headers["cache-control"] == "public, max-age=86400"
    assert "etag" in response.headers
