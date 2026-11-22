"""媒体文件的静态服务。

默认**不做协商缓存**：每次请求都返回 200 + 完整内容，不带 304。

为什么：304 本身是正确行为（客户端缓存 + ETag 校验），但微信开发者工具/部分真机
基础库对图片 304 的处理不一致——出现「服务端日志 304、页面却没图」这种现象，
排查成本很高。联调阶段直接关掉缓存，行为最确定。

生产环境想省流量可以把 MEDIA_CACHE_SECONDS 设成 86400（1 天）：
那时会带上 Cache-Control: public, max-age=... 并允许 304 协商。
"""

from __future__ import annotations

import os
from typing import Any

from starlette.datastructures import Headers
from starlette.responses import FileResponse, Response
# starlette >= 1.x 把 NotModifiedResponse 放在了 staticfiles 模块里（旧版在 responses）
from starlette.staticfiles import NotModifiedResponse, StaticFiles
from starlette.types import Scope


class MediaStaticFiles(StaticFiles):
    """带显式缓存策略的 StaticFiles。

    cache_seconds <= 0（默认）：
        Cache-Control: no-store, no-cache, must-revalidate, max-age=0
        去掉 ETag / Last-Modified，且**永远不返回 304**
    cache_seconds > 0：
        Cache-Control: public, max-age=N，保留 ETag / Last-Modified，允许 304
    """

    def __init__(self, directory: str, cache_seconds: int = 0, **kwargs: Any) -> None:
        super().__init__(directory=directory, **kwargs)
        self.cache_seconds = int(cache_seconds)

    def file_response(
        self,
        full_path: os.PathLike[str] | str,
        stat_result: os.stat_result,
        scope: Scope,
        status_code: int = 200,
    ) -> Response:
        if self.cache_seconds > 0:
            headers = {"cache-control": f"public, max-age={self.cache_seconds}"}
            response = FileResponse(
                full_path,
                status_code=status_code,
                stat_result=stat_result,
                headers=headers,
            )
            if self.is_not_modified(response.headers, Headers(scope=scope)):
                return NotModifiedResponse(response.headers)
            return response

        headers = {
            "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
            "pragma": "no-cache",
        }
        response = FileResponse(
            full_path,
            status_code=status_code,
            stat_result=stat_result,
            headers=headers,
        )
        # 去掉校验器：客户端就不会再发条件请求，也就不会出现 304
        for validator in ("etag", "last-modified"):
            if validator in response.headers:
                del response.headers[validator]
        return response
