"""3.7 / 3.8 手绘地图点位。"""

from __future__ import annotations

import logging
import sqlite3

from fastapi import APIRouter, Depends, Request

from ..db import fetch_all, fetch_one, get_db
from ..envelope import ok, ok_or_not_found
from ..serializers import spot_out
from ..utils import clean_text

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/map", tags=["手绘地图"])

_LIST_KEYS = ("spotIds", "spotIds[]", "spotId")


def spot_ids_from_query(request: Request) -> list[str]:
    """兼容 spotIds=a&spotIds=b、spotIds[]=a、spotIds=a,b、spotIds[0]=a 几种写法。

    wx.request 对数组参数的序列化方式随基础库版本略有差异，这里全都接住。
    """
    values: list[str] = []
    for key, raw in request.query_params.multi_items():
        if key in _LIST_KEYS or key.startswith("spotIds["):
            values.extend(raw.split(","))

    result: list[str] = []
    for item in values:
        text = clean_text(item, 64)
        if text and text not in result:
            result.append(text)
    return result


@router.get("/spots", summary="3.7 手绘地图点位列表")
def list_spots(
    request: Request,
    conn: sqlite3.Connection = Depends(get_db),
):
    spot_ids = spot_ids_from_query(request)

    if spot_ids:
        placeholders = ", ".join("?" for _ in spot_ids)
        rows = fetch_all(
            conn,
            f"SELECT * FROM map_spots WHERE spot_id IN ({placeholders}) "
            "ORDER BY sort_order, spot_id",
            tuple(spot_ids),
        )
    else:
        rows = fetch_all(conn, "SELECT * FROM map_spots ORDER BY sort_order, spot_id")

    return ok([spot_out(row) for row in rows])


@router.get("/spots/{spot_id}", summary="3.8 手绘地图点位详情")
def spot_detail(
    spot_id: str,
    conn: sqlite3.Connection = Depends(get_db),
):
    row = fetch_one(conn, "SELECT * FROM map_spots WHERE spot_id = ?", (spot_id,))
    if row is None:
        return ok_or_not_found("点位不存在")
    return ok(spot_out(row))
