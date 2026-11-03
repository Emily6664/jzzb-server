"""微信支付结果回调（服务端到服务端，小程序不调这个接口）。

注意：这个接口必须返回微信约定的 {"code":"SUCCESS"} 结构，不能套 { code, msg, data } 信封，
否则微信会一直重推。
"""

from __future__ import annotations

import json
import logging
import sqlite3

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from ..db import fetch_one, get_db, transaction
from ..errors import BizError
from ..services import pay as pay_service
from ..utils import now_text

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/notify", tags=["支付回调"])


def _wechat_ack(success: bool, message: str = "成功") -> JSONResponse:
    return JSONResponse(
        status_code=200 if success else 500,
        content={"code": "SUCCESS" if success else "FAIL", "message": message},
    )


@router.post("/wechat-pay", summary="微信支付结果回调")
async def wechat_pay_notify(
    request: Request,
    conn: sqlite3.Connection = Depends(get_db),
) -> JSONResponse:
    raw = await request.body()

    try:
        pay_service.verify_notify(request.headers, raw)
    except BizError as exc:
        logger.warning("支付回调验签失败：%s", exc)
        return _wechat_ack(False, exc.msg)

    try:
        payload = json.loads(raw or b"{}")
    except ValueError:
        return _wechat_ack(False, "回调内容不是合法 JSON")

    if not isinstance(payload, dict):
        return _wechat_ack(False, "回调内容格式不正确")

    event_type = str(payload.get("event_type") or "")
    if event_type and event_type != "TRANSACTION.SUCCESS":
        # 退款等其它事件这里不处理，但也要回 SUCCESS，否则微信会反复重推
        logger.info("忽略支付回调事件：%s", event_type)
        return _wechat_ack(True)

    resource = payload.get("resource") or {}
    if not isinstance(resource, dict):
        return _wechat_ack(False, "回调 resource 缺失")

    try:
        data = pay_service.decrypt_resource(resource)
    except BizError as exc:
        logger.warning("支付回调解密失败：%s", exc)
        return _wechat_ack(False, exc.msg)

    out_trade_no = str(data.get("out_trade_no") or "")
    if not out_trade_no:
        return _wechat_ack(False, "缺少 out_trade_no")

    order = fetch_one(conn, "SELECT * FROM orders WHERE order_id = ?", (out_trade_no,))
    if order is None:
        # 订单不存在的回调没必要让微信重推，记日志人工排查
        logger.warning("支付回调的订单不存在：%s", out_trade_no)
        return _wechat_ack(True)

    if str(order.get("status")) in ("paid", "shipped", "finished"):
        return _wechat_ack(True)

    trade_state = str(data.get("trade_state") or "")
    if trade_state and trade_state != "SUCCESS":
        logger.info("订单 %s 支付状态为 %s，暂不置为已付款", out_trade_no, trade_state)
        return _wechat_ack(True)

    stamp = now_text()
    with transaction() as tx:
        tx.execute(
            "UPDATE orders SET status = 'paid', paid_at = ?, updated_at = ?, remark = ? "
            "WHERE order_id = ?",
            (stamp, stamp, str(data.get("transaction_id") or ""), out_trade_no),
        )

    logger.info("订单 %s 已支付（微信回调）", out_trade_no)
    return _wechat_ack(True)
