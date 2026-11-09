"""FastAPI 应用入口：装配中间件、异常处理、路由。

只监听一个端口；接口同时挂在 API_PREFIX（默认 /api）和根路径下，
这样反向代理无论保不保留 /api 前缀都能命中。
"""

from __future__ import annotations

import logging
import time
import uuid
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

from fastapi import APIRouter, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import __version__
from .config import Settings, get_settings
from .db import bootstrap
from .envelope import fail
from .errors import (
    CODE_BAD_REQUEST,
    CODE_FORBIDDEN,
    CODE_NOT_FOUND,
    CODE_SERVER_ERROR,
    CODE_UNAUTHORIZED,
    BizError,
)
from .routers import collage, goods, health, maps, nfc, notify, user

logger = logging.getLogger(__name__)

DESCRIPTION = """
乡语新叙微信小程序后端。

- 所有接口统一返回 `{ code, msg, data }`，业务错误也是 HTTP 200 + 非 0 的 `code`；
- 接口路径 = `API_PREFIX`（默认 `/api`）+ 文档里的路径，例如 `GET /api/goods/list`；
- 不配微信参数时，登录走演示模式；不配支付参数时，下单返回 `payParams: null`（前端自动模拟支付）。
"""

# 参数校验报错时把字段名翻成人话
_FIELD_LABELS = {
    "goodsId": "商品 ID",
    "count": "购买数量",
    "addressId": "收货地址 ID",
    "address": "收货地址",
    "address.name": "收货人",
    "address.phone": "收货手机号",
    "address.region": "省市区",
    "address.detail": "详细地址",
    "workImage": "作品图地址",
    "templateId": "模板 ID",
    "materials": "素材列表",
    "workId": "作品 ID",
    "imageUrl": "成图地址",
    "title": "作品标题",
    "tagId": "标签 ID",
    "scannedAt": "扫码时间",
    "loginCode": "登录凭证 loginCode",
    "phoneCode": "手机号凭证 phoneCode",
}


def _configure_logging(level: str) -> None:
    numeric = getattr(logging, str(level).upper(), logging.INFO)
    logging.basicConfig(
        level=numeric,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    _configure_logging(settings.log_level)
    bootstrap()
    logger.info(
        "%s v%s 启动完成｜监听 %s:%s｜数据库 %s｜资源前缀 %s｜登录校验=%s｜支付=%s",
        settings.app_name,
        __version__,
        settings.host,
        settings.port,
        settings.database_file,
        settings.media_public_base,
        "强制" if settings.auth_required else "宽松（无 token 走演示用户）",
        "开启" if settings.wechat_pay_enabled else "关闭",
    )
    yield
    logger.info("服务已停止")


# ==================== 异常处理 ====================


async def _handle_biz_error(request: Request, exc: Exception) -> JSONResponse:
    error = exc if isinstance(exc, BizError) else BizError(CODE_SERVER_ERROR, "服务异常")
    logger.info("业务错误 %s %s -> %s", request.method, request.url.path, error)
    return fail(error.code, error.msg, error.data, status_code=error.http_status)


def _validation_message(exc: RequestValidationError) -> str:
    errors = exc.errors()
    if not errors:
        return "请求参数不合法"

    first = errors[0]
    location = [
        str(part)
        for part in first.get("loc", ())
        if str(part) not in ("body", "query", "path", "header")
    ]
    field = ".".join(location) or "参数"
    label = _FIELD_LABELS.get(field, field)
    error_type = str(first.get("type") or "")

    if error_type == "missing":
        return f"缺少必填参数：{label}"
    if error_type.startswith(("int", "float", "decimal")):
        return f"参数 {label} 必须是数字"
    if error_type.startswith("string") or error_type in ("too_long", "too_short"):
        return f"参数 {label} 格式不正确"
    if error_type in ("greater_than", "greater_than_equal"):
        return f"参数 {label} 必须大于 0"
    if error_type in ("less_than", "less_than_equal"):
        return f"参数 {label} 超出允许范围"
    if error_type in ("bool", "bool_parsing"):
        return f"参数 {label} 必须是布尔值"
    if error_type.startswith(("list", "dict", "model")):
        return f"参数 {label} 格式不正确"
    return f"参数 {label} 不合法"


async def _handle_validation_error(
    request: Request, exc: Exception
) -> JSONResponse:
    error = exc if isinstance(exc, RequestValidationError) else None
    details = error.errors() if error is not None else []
    logger.info("参数校验失败 %s %s：%s", request.method, request.url.path, details)
    message = _validation_message(error) if error is not None else "请求参数不合法"
    return fail(CODE_BAD_REQUEST, message)


async def _handle_http_exception(request: Request, exc: Exception) -> JSONResponse:
    status_code = getattr(exc, "status_code", 500)
    detail = getattr(exc, "detail", "")

    if status_code == 404:
        return fail(CODE_NOT_FOUND, "接口不存在，请检查请求路径", status_code=404)
    if status_code == 405:
        return fail(
            CODE_BAD_REQUEST,
            f"接口不支持 {request.method} 方法",
            status_code=405,
        )
    if status_code == 401:
        return fail(CODE_UNAUTHORIZED, str(detail or "未登录"), status_code=401)
    if status_code == 403:
        return fail(CODE_FORBIDDEN, str(detail or "无权访问"), status_code=403)
    if status_code >= 500:
        return fail(CODE_SERVER_ERROR, "服务异常，请稍后再试", status_code=status_code)
    return fail(CODE_BAD_REQUEST, str(detail or "请求不合法"), status_code=status_code)


async def _handle_unexpected_error(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("未处理异常 %s %s", request.method, request.url.path)
    return fail(CODE_SERVER_ERROR, "服务异常，请稍后再试", status_code=500)


# ==================== 装配 ====================


def _install_middleware(app: FastAPI, settings: Settings) -> None:
    @app.middleware("http")
    async def access_log(request: Request, call_next: Any) -> Any:
        request_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
        started = time.perf_counter()
        response = await call_next(request)
        elapsed_ms = (time.perf_counter() - started) * 1000
        response.headers["X-Request-Id"] = request_id
        logger.info(
            "%s %s -> %s %.1fms rid=%s",
            request.method,
            request.url.path,
            response.status_code,
            elapsed_ms,
            request_id,
        )
        return response

    # 后添加的中间件在最外层：CORS 要包住访问日志
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Request-Id"],
    )


def _install_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(BizError, _handle_biz_error)
    app.add_exception_handler(RequestValidationError, _handle_validation_error)
    app.add_exception_handler(StarletteHTTPException, _handle_http_exception)
    app.add_exception_handler(Exception, _handle_unexpected_error)


def _install_routes(app: FastAPI, settings: Settings) -> None:
    api = APIRouter()
    api.include_router(user.router)
    api.include_router(collage.router)
    api.include_router(nfc.router)
    api.include_router(maps.router)
    api.include_router(goods.router)
    api.include_router(notify.router)
    api.include_router(health.router)

    app.include_router(api, prefix=settings.api_prefix)

    if settings.api_prefix:
        # 反向代理把 /api 前缀剥掉时（proxy_pass .../ ）也能直接命中，少一个排查点
        app.include_router(api, include_in_schema=False)

    health.register_root_routes(app)


def _install_media(app: FastAPI, settings: Settings) -> None:
    """把 MEDIA_DIR 同时挂到 /media 和 {API_PREFIX}/media。

    这样图片、音频和接口共用同一个域名和同一个端口，不需要 CDN：
      https://你的域名/media/goods/1-1.png
      https://你的域名/api/media/goods/1-1.png      ← 只放行 /api/* 的网关也能用
        -> {MEDIA_DIR}/goods/1-1.png

    两个路径指向同一个目录，按网关实际放行的前缀选一个填进 MEDIA_BASE_URL 即可。
    网关若会把 /api 剥掉再转发（/api/media/x.png -> /media/x.png），两种也都命中。
    """
    directory = settings.media_dir
    try:
        directory.mkdir(parents=True, exist_ok=True)
    except OSError as exc:  # 目录不可写时不要拖垮整个服务
        logger.warning("媒体目录不可用，跳过 /media 挂载：%s（%s）", directory, exc)
        return

    static_files = StaticFiles(directory=str(directory))
    app.mount("/media", static_files, name="media")

    api_media_path = f"{settings.api_prefix}/media" if settings.api_prefix else "/media"
    if api_media_path != "/media":
        app.mount(api_media_path, static_files, name="api-media")

    logger.info("媒体目录已挂载：/media 与 %s -> %s", api_media_path, directory)


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title=settings.app_name,
        version=__version__,
        description=DESCRIPTION,
        lifespan=lifespan,
        root_path=settings.root_path or "",
        docs_url="/docs" if settings.docs_enabled else None,
        redoc_url="/redoc" if settings.docs_enabled else None,
        openapi_url="/openapi.json" if settings.docs_enabled else None,
    )

    _install_middleware(app, settings)
    _install_exception_handlers(app)
    _install_routes(app, settings)
    _install_media(app, settings)
    return app


app = create_app()
