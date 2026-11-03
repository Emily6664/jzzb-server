"""业务异常。

约定：业务错误（参数非法、资源不存在、未登录…）一律返回 HTTP 200 + {code, msg, data}，
因为小程序 utils/api.js 只在 2xx 时才读信封里的 msg 展示给用户；
真正的链路级故障（未捕获异常、未知路由）才用非 200。
"""

from __future__ import annotations

from typing import Any

# 与 API_DOC.md 1.1 的状态码表保持一致
CODE_OK = 0
CODE_BAD_REQUEST = 40001
CODE_UNAUTHORIZED = 40100
CODE_FORBIDDEN = 40300
CODE_NOT_FOUND = 40400
CODE_SERVER_ERROR = 50000


class BizError(Exception):
    def __init__(
        self,
        code: int,
        msg: str,
        *,
        http_status: int = 200,
        data: Any = None,
    ) -> None:
        super().__init__(msg)
        self.code = code
        self.msg = msg
        self.http_status = http_status
        self.data = data

    def __str__(self) -> str:  # 日志里好看一点
        return f"[{self.code}] {self.msg}"


def bad_request(msg: str, data: Any = None) -> BizError:
    return BizError(CODE_BAD_REQUEST, msg, data=data)


def unauthorized(msg: str = "未登录或登录已失效") -> BizError:
    return BizError(CODE_UNAUTHORIZED, msg)


def forbidden(msg: str = "无权访问该资源") -> BizError:
    return BizError(CODE_FORBIDDEN, msg)


def not_found(msg: str) -> BizError:
    return BizError(CODE_NOT_FOUND, msg, data=None)
