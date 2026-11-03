"""3.5 / 3.6 NFC 溯源与扫码上报。"""

from __future__ import annotations

import logging
import sqlite3

from fastapi import APIRouter, Depends, Request

from ..db import fetch_one, get_db
from ..envelope import ok, ok_or_not_found
from ..errors import bad_request
from ..schemas import ScanLogRequest
from ..security import get_current_user
from ..serializers import tag_out
from ..utils import clean_text, client_ip, now_text, time_or_now_text

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/nfc", tags=["NFC 溯源"])


@router.get("/trace", summary="3.5 NFC 溯源详情")
def trace(
    request: Request,
    conn: sqlite3.Connection = Depends(get_db),
):
    tag_id = clean_text(request.query_params.get("tagId"), 128)
    if not tag_id:
        raise bad_request("缺少标签 ID tagId")

    row = fetch_one(conn, "SELECT * FROM nfc_tags WHERE tag_id = ?", (tag_id,))
    if row is None:
        # 文档约定是 40400；但小程序页面用 `if (!trace) 显示空态` 处理，
        # 所以默认返回 {code:0, data:null}（见 NOT_FOUND_AS_NULL 配置项）。
        return ok_or_not_found("标签未登记")

    return ok(tag_out(row))


@router.post("/scan-log", summary="3.6 NFC 扫码上报")
def scan_log(
    payload: ScanLogRequest,
    request: Request,
    conn: sqlite3.Connection = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """记录一次扫码。上报失败不阻塞小程序主流程，所以这里只做最基本的校验。"""
    tag_id = clean_text(payload.tag_id, 128)
    if not tag_id:
        raise bad_request("缺少标签 ID tagId")

    scanned_at = time_or_now_text(payload.scanned_at)
    reported_at = now_text()

    conn.execute(
        """
        INSERT INTO nfc_scan_logs
            (tag_id, scanned_at, latitude, longitude, user_id, client_ip, user_agent, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            tag_id,
            scanned_at,
            payload.latitude,
            payload.longitude,
            str(user.get("user_id") or ""),
            client_ip(request),
            clean_text(request.headers.get("user-agent"), 256),
            reported_at,
        ),
    )

    logger.info("扫码上报：%s @ %s", tag_id, scanned_at)
    return ok({"success": True, "reportedAt": reported_at, "tagId": tag_id})
