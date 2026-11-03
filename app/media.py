"""静态资源域名替换。

种子数据里的图片 / 音频沿用了 mock/ 里的占位域名 https://cdn.example.com/xiangyu-xinxu。
配了 MEDIA_BASE_URL 之后，所有响应里的这类地址会在出口处自动换成真实地址，
既不用改数据库，也不用重新导入数据。
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any

from .config import get_settings


@lru_cache(maxsize=8)
def media_targets(source: str, target: str) -> tuple[str, str]:
    source = (source or "").rstrip("/")
    target = (target or "").rstrip("/")
    if not source or not target or source == target:
        return "", ""
    return source, target


def _targets() -> tuple[str, str]:
    settings = get_settings()
    return media_targets(settings.media_source_base, settings.media_base_url)


def rewrite_string(value: str) -> str:
    source, target = _targets()
    if not source or not value.startswith(source):
        return value
    # 边界判断，避免 /xiangyu-xinxu2/... 被误伤
    rest = value[len(source) :]
    if rest and rest[0] != "/":
        return value
    return target + rest


def rewrite_media(value: Any, _depth: int = 0) -> Any:
    """递归替换 dict / list 里所有字符串中的资源域名前缀。"""
    if _depth > 10:
        return value
    if isinstance(value, str):
        return rewrite_string(value)
    if isinstance(value, dict):
        return {key: rewrite_media(item, _depth + 1) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [rewrite_media(item, _depth + 1) for item in value]
    return value
