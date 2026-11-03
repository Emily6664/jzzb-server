"""用户与登录态。

token 用随机串 + 数据库表存（不引 JWT 依赖）：
- 登录签发，30 天有效（TOKEN_TTL_SECONDS 可配）；
- 请求带 `Authorization: Bearer <token>` 时解析用户；
- AUTH_REQUIRED=false（默认）时，没带 token 或 token 失效都按「演示用户」处理，
  这样小程序在 utils/api.js 还没注入 Authorization 头的情况下也能直接联调。
"""

from __future__ import annotations

import logging
import secrets
import sqlite3
import uuid
from datetime import timedelta
from typing import Any

from fastapi import Depends, Request

from .config import get_settings
from .db import fetch_one, get_db
from .errors import CODE_UNAUTHORIZED, unauthorized
from .utils import clean_text, fmt, now

logger = logging.getLogger(__name__)

DEMO_OPENID = "demo-openid"


# ==================== 用户 ====================


def _new_user_id() -> str:
    return f"user-{uuid.uuid4().hex[:8]}"


def ensure_demo_user(conn: sqlite3.Connection) -> dict[str, Any]:
    """取演示用户，不存在就建一个（与 mock/mock-user.js 的数据一致）。"""
    settings = get_settings()

    row = fetch_one(conn, "SELECT * FROM users WHERE user_id = ?", (settings.demo_user_id,))
    if row is not None:
        return row

    stamp = fmt(now())
    conn.execute(
        """
        INSERT OR IGNORE INTO users
            (user_id, openid, unionid, phone, nickname, avatar_url,
             address_count, created_at, updated_at)
        VALUES (?, ?, NULL, ?, ?, '', 0, ?, ?)
        """,
        (
            settings.demo_user_id,
            DEMO_OPENID,
            settings.demo_user_phone,
            settings.demo_user_nickname,
            stamp,
            stamp,
        ),
    )
    row = fetch_one(conn, "SELECT * FROM users WHERE user_id = ?", (settings.demo_user_id,))
    if row is None:
        # user_id 被占用、或同一个 openid 已经建过号：退回按 openid 找，别让服务起不来
        row = fetch_one(conn, "SELECT * FROM users WHERE openid = ?", (DEMO_OPENID,))
    if row is None:
        raise RuntimeError("演示用户创建失败")
    return row


def upsert_wechat_user(
    conn: sqlite3.Connection,
    openid: str,
    *,
    unionid: str | None = None,
    phone: str | None = None,
    nickname: str | None = None,
    avatar_url: str | None = None,
) -> dict[str, Any]:
    """按 openid 建号或更新资料。真实登录走后端换 openid 的流程时使用。"""
    openid = clean_text(openid, 128)
    if not openid:
        raise ValueError("openid 不能为空")

    stamp = fmt(now())
    row = fetch_one(conn, "SELECT * FROM users WHERE openid = ?", (openid,))

    if row is None:
        user_id = _new_user_id()
        conn.execute(
            """
            INSERT INTO users
                (user_id, openid, unionid, phone, nickname, avatar_url,
                 address_count, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
            """,
            (
                user_id,
                openid,
                clean_text(unionid, 128) or None,
                clean_text(phone, 32) or None,
                clean_text(nickname, 64),
                clean_text(avatar_url, 512),
                stamp,
                stamp,
            ),
        )
        row = fetch_one(conn, "SELECT * FROM users WHERE user_id = ?", (user_id,))
        if row is None:
            raise RuntimeError("用户创建失败")
        return row

    updates: list[str] = []
    params: list[Any] = []

    if phone and phone != row.get("phone"):
        updates.append("phone = ?")
        params.append(clean_text(phone, 32))
    if nickname and not row.get("nickname"):
        updates.append("nickname = ?")
        params.append(clean_text(nickname, 64))
    if avatar_url and not row.get("avatar_url"):
        updates.append("avatar_url = ?")
        params.append(clean_text(avatar_url, 512))
    if unionid and not row.get("unionid"):
        updates.append("unionid = ?")
        params.append(clean_text(unionid, 128))

    if updates:
        updates.append("updated_at = ?")
        params.append(stamp)
        params.append(row["user_id"])
        conn.execute(f"UPDATE users SET {', '.join(updates)} WHERE user_id = ?", tuple(params))
        row = fetch_one(conn, "SELECT * FROM users WHERE user_id = ?", (row["user_id"],)) or row

    return row


# ==================== 登录态 ====================


def issue_token(conn: sqlite3.Connection, user_id: str) -> str:
    settings = get_settings()
    token = secrets.token_urlsafe(32)
    created = now()
    expires = created + timedelta(seconds=max(int(settings.token_ttl_seconds), 60))

    # 顺手清掉这个用户已过期的 token，表不会无限膨胀
    conn.execute(
        "DELETE FROM auth_tokens WHERE user_id = ? AND expires_at < ?",
        (user_id, fmt(created)),
    )
    conn.execute(
        "INSERT INTO auth_tokens (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
        (token, user_id, fmt(created), fmt(expires)),
    )
    return token


def resolve_token(conn: sqlite3.Connection, token: str) -> dict[str, Any] | None:
    item = clean_text(token, 256)
    if not item:
        return None

    row = fetch_one(conn, "SELECT * FROM auth_tokens WHERE token = ?", (item,))
    if row is None:
        return None

    if str(row["expires_at"]) < (fmt(now()) or ""):
        conn.execute("DELETE FROM auth_tokens WHERE token = ?", (item,))
        return None

    return fetch_one(conn, "SELECT * FROM users WHERE user_id = ?", (row["user_id"],))


def revoke_token(conn: sqlite3.Connection, token: str) -> None:
    conn.execute("DELETE FROM auth_tokens WHERE token = ?", (clean_text(token, 256),))


# ==================== FastAPI 依赖 ====================


def read_bearer_token(request: Request) -> str:
    header = request.headers.get("authorization") or ""
    text = header.strip()
    if text.lower().startswith("bearer "):
        return text[7:].strip()
    return text


def get_current_user(
    request: Request,
    conn: sqlite3.Connection = Depends(get_db),
) -> dict[str, Any]:
    """必须有一个「当前用户」：有 token 就用 token，否则按配置回落到演示用户。"""
    settings = get_settings()
    token = read_bearer_token(request)

    if token:
        user = resolve_token(conn, token)
        if user is not None:
            return user
        if settings.auth_required:
            raise unauthorized("登录已失效，请重新登录")
        logger.debug("token 无效，已回落到演示用户")

    if settings.auth_required:
        raise unauthorized("请先登录")

    return ensure_demo_user(conn)


def get_optional_user(
    request: Request,
    conn: sqlite3.Connection = Depends(get_db),
) -> dict[str, Any] | None:
    """不强求登录；没 token 或 token 无效都返回 None。"""
    token = read_bearer_token(request)
    if not token:
        return None
    return resolve_token(conn, token)


__all__ = [
    "CODE_UNAUTHORIZED",
    "DEMO_OPENID",
    "ensure_demo_user",
    "get_current_user",
    "get_optional_user",
    "issue_token",
    "read_bearer_token",
    "resolve_token",
    "revoke_token",
    "upsert_wechat_user",
]
