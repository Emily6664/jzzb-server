"""统一返回信封 { code, msg, data }。"""

from __future__ import annotations

from typing import Any

from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse

from .config import get_settings
from .errors import (  # noqa: F401  这些常量从本模块也导出，路由里只 import 一处即可
    CODE_BAD_REQUEST,
    CODE_FORBIDDEN,
    CODE_NOT_FOUND,
    CODE_OK,
    CODE_SERVER_ERROR,
    CODE_UNAUTHORIZED,
)
from .media import rewrite_media

# 显式带上 charset：Starlette 默认只给 text/* 补 charset，而 Windows PowerShell 5.1 的
# Invoke-RestMethod 在 application/json 没有 charset 时会按 ISO-8859-1 解码，中文变乱码。
# 带上它，curl / PowerShell / 小程序都能正常显示中文。
JSON_MEDIA_TYPE = "application/json; charset=utf-8"


def envelope(code: int = CODE_OK, msg: str = "ok", data: Any = None) -> dict[str, Any]:
    return {"code": code, "msg": msg, "data": data}


def ok(data: Any = None, msg: str = "ok") -> JSONResponse:
    """成功响应：HTTP 200 + code 0。"""
    payload = envelope(CODE_OK, msg, rewrite_media(data))
    return JSONResponse(
        status_code=200,
        content=jsonable_encoder(payload),
        media_type=JSON_MEDIA_TYPE,
    )


def fail(
    code: int,
    msg: str,
    data: Any = None,
    *,
    status_code: int = 200,
) -> JSONResponse:
    payload = envelope(code, msg, rewrite_media(data))
    return JSONResponse(
        status_code=status_code,
        content=jsonable_encoder(payload),
        media_type=JSON_MEDIA_TYPE,
    )


def ok_or_not_found(msg: str, data: Any = None) -> JSONResponse:
    """详情类查询没命中时的统一返回。

    NOT_FOUND_AS_NULL=true（默认）时返回 code 0 + data null——和小程序 mock 的行为一致，
    页面走「空态」而不是弹错误；设成 false 则按 API_DOC 返回 40400。
    """
    if get_settings().not_found_as_null:
        return ok(data)
    return fail(CODE_NOT_FOUND, msg)
