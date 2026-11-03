"""微信小程序服务端接口调用（code2session / 手机号换取）。

只在配置了 WECHAT_APPID + WECHAT_SECRET 时会被真正调用；
否则 user 路由走「演示登录」，不会发任何外部请求。
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

import httpx

from ..config import Settings, get_settings
from ..errors import CODE_BAD_REQUEST, CODE_SERVER_ERROR, BizError

logger = logging.getLogger(__name__)

# access_token 全局缓存（自动续期），避免每次换手机号都刷一次
_TOKEN_CACHE: dict[str, Any] = {"token": "", "expires_at": 0.0}
_TOKEN_LOCK = asyncio.Lock()


class WeChatClient:
    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()

    @property
    def mock(self) -> bool:
        return self.settings.wechat_mock

    # ---------- 底层 ----------

    async def _request(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        url = self.settings.wechat_api_base.rstrip("/") + path
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(10.0)) as client:
                response = await client.request(method, url, **kwargs)
        except httpx.HTTPError as exc:
            logger.warning("调用微信接口失败 %s: %s", path, exc)
            raise BizError(CODE_SERVER_ERROR, "微信服务暂时不可用，请稍后再试") from exc

        if response.status_code >= 400:
            logger.warning("微信接口返回 %s %s: %s", response.status_code, path, response.text[:300])
            raise BizError(CODE_SERVER_ERROR, "微信服务返回异常，请稍后再试")

        try:
            data = response.json()
        except ValueError as exc:
            logger.warning("微信接口返回非 JSON %s: %s", path, response.text[:300])
            raise BizError(CODE_SERVER_ERROR, "微信服务返回异常，请稍后再试") from exc

        return data if isinstance(data, dict) else {}

    # ---------- 业务 ----------

    async def code2session(self, js_code: str) -> dict[str, Any]:
        """用 wx.login 的 code 换 openid / session_key。"""
        data = await self._request(
            "GET",
            "/sns/jscode2session",
            params={
                "appid": self.settings.wechat_appid,
                "secret": self.settings.wechat_secret,
                "js_code": js_code,
                "grant_type": "authorization_code",
            },
        )

        if data.get("errcode"):
            msg = data.get("errmsg") or f"errcode {data.get('errcode')}"
            logger.info("code2session 失败: %s", msg)
            raise BizError(CODE_BAD_REQUEST, f"微信登录失败：{msg}")

        if not data.get("openid"):
            raise BizError(CODE_SERVER_ERROR, "微信登录失败：未取到 openid")

        return data

    async def access_token(self) -> str:
        """获取接口调用凭证，带内存缓存。"""
        cached = _TOKEN_CACHE["token"]
        if cached and float(_TOKEN_CACHE["expires_at"]) > time.time() + 120:
            return str(cached)

        async with _TOKEN_LOCK:
            cached = _TOKEN_CACHE["token"]
            if cached and float(_TOKEN_CACHE["expires_at"]) > time.time() + 120:
                return str(cached)

            data = await self._request(
                "GET",
                "/cgi-bin/token",
                params={
                    "grant_type": "client_credential",
                    "appid": self.settings.wechat_appid,
                    "secret": self.settings.wechat_secret,
                },
            )

            token = data.get("access_token")
            if not token:
                logger.warning("获取 access_token 失败: %s", data)
                raise BizError(CODE_SERVER_ERROR, "微信服务暂时不可用，请稍后再试")

            expires_in = int(data.get("expires_in") or 7200)
            _TOKEN_CACHE["token"] = str(token)
            _TOKEN_CACHE["expires_at"] = time.time() + expires_in
            return str(token)

    async def phone_number(self, phone_code: str) -> str:
        """用 getPhoneNumber 回调里的 code 换手机号明文。"""
        token = await self.access_token()
        data = await self._request(
            "POST",
            "/wxa/business/getuserphonenumber",
            params={"access_token": token},
            json={"code": phone_code},
        )

        if data.get("errcode"):
            msg = data.get("errmsg") or f"errcode {data.get('errcode')}"
            logger.info("getPhoneNumber 失败: %s", msg)
            raise BizError(CODE_BAD_REQUEST, f"获取手机号失败：{msg}")

        info = data.get("phone_info") or {}
        phone = info.get("purePhoneNumber") or info.get("phoneNumber")
        if not phone:
            raise BizError(CODE_BAD_REQUEST, "未获取到手机号，请重新授权")

        return str(phone)
