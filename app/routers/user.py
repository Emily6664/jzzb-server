"""3.14 / 3.15 用户登录与资料。"""

from __future__ import annotations

import logging
import sqlite3

from fastapi import APIRouter, Depends, Request

from ..db import get_db
from ..envelope import ok
from ..errors import bad_request
from ..schemas import LoginRequest
from ..security import (
    ensure_demo_user,
    get_current_user,
    issue_token,
    read_bearer_token,
    revoke_token,
    upsert_wechat_user,
)
from ..serializers import profile_out, user_out
from ..services.wechat import WeChatClient

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/user", tags=["用户"])


@router.post("/login", summary="3.14 微信手机号一键登录")
async def login(
    payload: LoginRequest,
    conn: sqlite3.Connection = Depends(get_db),
):
    """用 wx.login 的 code 建立会话，用 getPhoneNumber 的 code 换手机号。

    - 配了 WECHAT_APPID / WECHAT_SECRET：真实调微信接口，按 openid 建号；
    - 没配（默认）：走演示登录，固定返回演示用户，便于本地联调；
    - 真实模式下没传 phoneCode 也能登录，只是 phone 为 null（前端会提示未登录）。
    """
    login_code = (payload.login_code or "").strip()
    if not login_code:
        raise bad_request("缺少登录凭证 loginCode")

    phone_code = (payload.phone_code or "").strip()
    client = WeChatClient()

    if client.mock:
        logger.debug("未配置微信小程序参数，登录走演示模式")
        user = ensure_demo_user(conn)
    else:
        session = await client.code2session(login_code)
        phone = await client.phone_number(phone_code) if phone_code else None
        user = upsert_wechat_user(
            conn,
            str(session.get("openid") or ""),
            unionid=session.get("unionid"),
            phone=phone,
        )

    token = issue_token(conn, str(user["user_id"]))

    data = user_out(user)
    data["nickname"] = data["nickname"] or "围山访客"
    data["token"] = token
    return ok(data)


@router.get("/profile", summary="3.15 用户资料")
def profile(
    conn: sqlite3.Connection = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    return ok(profile_out(user))


@router.post("/logout", summary="退出登录（扩展）")
def logout(
    request: Request,
    conn: sqlite3.Connection = Depends(get_db),
):
    token = read_bearer_token(request)
    if token:
        revoke_token(conn, token)
    return ok({"success": True})
