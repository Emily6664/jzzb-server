"""根路径与健康检查。

- `/` 返回一个只写着 OK 的极简 HTML 页面，给反向代理 / 浏览器 / 监控做存活探测；
- `/healthz` 返回 JSON 信封，给监控脚本用；
- `/api/health` 与接口同前缀，方便小程序或运维脚本统一访问。
"""

from __future__ import annotations

from fastapi import APIRouter, FastAPI
from fastapi.responses import HTMLResponse

from .. import __version__
from ..config import get_settings
from ..envelope import ok
from ..utils import now_text

router = APIRouter(tags=["健康检查"])

# 根路径返回的极简页面：可见内容只有一个 OK
OK_HTML = (
    "<!doctype html>\n"
    '<html lang="zh-CN">\n'
    "<head>\n"
    '  <meta charset="utf-8">\n'
    '  <meta name="viewport" content="width=device-width, initial-scale=1">\n'
    "  <title>OK</title>\n"
    "</head>\n"
    "<body>OK</body>\n"
    "</html>\n"
)


def health_payload() -> dict:
    settings = get_settings()
    return {
        "status": "ok",
        "service": settings.app_name,
        "version": __version__,
        "time": now_text(),
        "database": str(settings.database_file),
        "apiPrefix": settings.api_prefix or "/",
        # 图片/音频实际下发的前缀：接口返回的 coverUrl 就拼在这个前缀后面，
        # 排查「图片 pending / 404」时先看这两个字段
        "mediaBase": settings.media_public_base,
        "mediaDir": str(settings.media_dir),
        # 0 = 禁用缓存（每次 200）；>0 = 允许客户端缓存 N 秒并走 304
        "mediaCacheSeconds": settings.media_cache_seconds,
        "wechatMock": settings.wechat_mock,
        "payEnabled": settings.wechat_pay_enabled,
    }


@router.get("/health", summary="健康检查")
def health():
    return ok(health_payload())


def register_root_routes(app: FastAPI) -> None:
    @app.get("/healthz", include_in_schema=False)
    def healthz():
        return ok(health_payload())

    @app.get("/", include_in_schema=False, response_class=HTMLResponse)
    def index() -> HTMLResponse:
        """根路径只回 OK，方便浏览器 / 监控一眼确认服务活着。"""
        return HTMLResponse(content=OK_HTML)
