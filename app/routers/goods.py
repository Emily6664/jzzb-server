"""3.9 ~ 3.13 文创商品、订单、支付参数。"""

from __future__ import annotations

import logging
import sqlite3
from typing import Any

from fastapi import APIRouter, Depends, Request

from ..config import get_settings
from ..db import fetch_all, fetch_one, get_db, transaction
from ..envelope import ok, ok_or_not_found
from ..errors import CODE_SERVER_ERROR, BizError, bad_request, forbidden, not_found
from ..schemas import CreateOrderRequest
from ..security import get_current_user
from ..serializers import goods_detail_out, goods_list_out, order_out
from ..services import pay as pay_service
from ..utils import clean_phone, clean_text, money, new_order_id, now_text

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/goods", tags=["文创商品"])

ORDER_STATUSES = ("unpaid", "paid", "shipped", "finished", "canceled")
PAID_STATUSES = ("paid", "shipped", "finished")
MAX_COUNT = 99


# ==================== 商品 ====================


@router.get("/list", summary="3.9 文创商品列表")
def list_goods(
    request: Request,
    conn: sqlite3.Connection = Depends(get_db),
):
    spot_id = clean_text(request.query_params.get("spotId"), 64)

    if spot_id:
        rows = fetch_all(
            conn,
            "SELECT * FROM goods WHERE spot_id = ? ORDER BY sort_order, goods_id",
            (spot_id,),
        )
    else:
        rows = fetch_all(conn, "SELECT * FROM goods ORDER BY sort_order, goods_id")

    return ok([goods_list_out(row) for row in rows])


@router.get("/detail", summary="3.10 文创商品详情")
def goods_detail(
    request: Request,
    conn: sqlite3.Connection = Depends(get_db),
):
    goods_id = clean_text(request.query_params.get("goodsId"), 64)
    if not goods_id:
        raise bad_request("缺少商品 ID goodsId")

    row = fetch_one(conn, "SELECT * FROM goods WHERE goods_id = ?", (goods_id,))
    if row is None:
        # 默认返回 {code:0, data:null}，小程序详情页据此显示空态（见 NOT_FOUND_AS_NULL）
        return ok_or_not_found("商品不存在")

    return ok(goods_detail_out(row))


# ==================== 订单 ====================


@router.get("/orders", summary="3.11 我的订单列表")
def list_orders(
    request: Request,
    conn: sqlite3.Connection = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    status = clean_text(request.query_params.get("status"), 32)
    if status and status not in ORDER_STATUSES:
        raise bad_request(
            "status 取值非法，可选：" + " / ".join(ORDER_STATUSES)
        )

    if status:
        rows = fetch_all(
            conn,
            "SELECT * FROM orders WHERE user_id = ? AND status = ? "
            "ORDER BY created_at DESC, order_id DESC",
            (str(user["user_id"]), status),
        )
    else:
        rows = fetch_all(
            conn,
            "SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC, order_id DESC",
            (str(user["user_id"]),),
        )

    return ok([order_out(row) for row in rows])


def _unique_order_id(conn: sqlite3.Connection) -> str:
    for _ in range(6):
        candidate = new_order_id()
        exists = conn.execute(
            "SELECT 1 FROM orders WHERE order_id = ?", (candidate,)
        ).fetchone()
        if exists is None:
            return candidate
    raise BizError(CODE_SERVER_ERROR, "订单号生成失败，请重试")


@router.post("/orders", summary="3.12 创建订单")
async def create_order(
    payload: CreateOrderRequest,
    conn: sqlite3.Connection = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """金额一律由后端按 goodsId 现算，前端传的价格不作数。"""
    goods_id = clean_text(payload.goods_id, 64)
    if not goods_id:
        raise bad_request("缺少商品 ID goodsId")

    count = int(payload.count)
    if count < 1:
        raise bad_request("购买数量必须大于 0")
    if count > MAX_COUNT:
        raise bad_request(f"单个订单最多购买 {MAX_COUNT} 件")

    address = payload.address
    if address is None:
        raise bad_request("缺少收货地址 address")

    receiver = clean_text(address.name, 64)
    phone = clean_phone(address.phone)
    detail = clean_text(address.detail, 256)
    region = [clean_text(item, 32) for item in (address.region or [])]
    region = [item for item in region if item]

    if not receiver:
        raise bad_request("请填写收货人姓名")
    if not phone:
        raise bad_request("请填写正确的收货手机号")
    if not detail:
        raise bad_request("请填写详细地址")

    address_text = "".join(region) + detail
    stamp = now_text()
    pay_mode = "wxpay" if pay_service.pay_enabled() else "mock"

    with transaction() as tx:
        goods = fetch_one(tx, "SELECT * FROM goods WHERE goods_id = ?", (goods_id,))
        if goods is None:
            raise not_found("商品不存在")

        stock = int(goods.get("stock") or 0)
        if stock < count:
            raise bad_request(f"库存不足，仅剩 {stock} 件")

        price_cents = int(goods.get("price_cents") or 0)
        total_cents = price_cents * count
        order_id = _unique_order_id(tx)

        tx.execute(
            """
            INSERT INTO orders
                (order_id, user_id, goods_id, goods_name, cover_url, price_cents,
                 quantity, total_cents, status, created_at, updated_at, paid_at,
                 address_id, receiver, receiver_phone, address_text, work_image,
                 pay_mode, prepay_id, remark)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', ?, ?, NULL,
                    ?, ?, ?, ?, ?, ?, NULL, NULL)
            """,
            (
                order_id,
                str(user["user_id"]),
                goods_id,
                str(goods.get("name") or ""),
                str(goods.get("cover_url") or ""),
                price_cents,
                count,
                total_cents,
                stamp,
                stamp,
                clean_text(payload.address_id, 64),
                receiver,
                phone,
                address_text,
                clean_text(payload.work_image, 512),
                pay_mode,
            ),
        )

        tx.execute(
            "UPDATE goods SET stock = stock - ? WHERE goods_id = ?", (count, goods_id)
        )

    # 统一下单失败不应该让用户丢掉这张订单：落单成功即返回，支付可稍后在我的订单里重试
    pay_params: dict[str, Any] | None = None
    if pay_mode == "wxpay":
        try:
            pay_params = await pay_service.create_pay_params(
                {
                    "order_id": order_id,
                    "goods_name": str(goods.get("name") or ""),
                    "total_cents": total_cents,
                },
                user.get("openid"),
            )
        except BizError as exc:
            logger.warning("订单 %s 统一下单失败，先保留为待付款：%s", order_id, exc)

    logger.info(
        "创建订单 %s：%s x%d = %s 分（用户 %s）",
        order_id,
        goods_id,
        count,
        total_cents,
        user["user_id"],
    )

    return ok(
        {
            "orderId": order_id,
            "totalAmount": money(total_cents),
            "status": "unpaid",
            "payParams": pay_params,
        }
    )


@router.post("/orders/{order_id}/pay", summary="3.13 获取支付参数")
async def pay_order(
    order_id: str,
    conn: sqlite3.Connection = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    order = fetch_one(conn, "SELECT * FROM orders WHERE order_id = ?", (order_id,))
    if order is None:
        raise not_found("订单不存在")
    if str(order["user_id"]) != str(user["user_id"]):
        raise forbidden("无权操作该订单")

    status = str(order.get("status") or "")

    if status == "canceled":
        raise bad_request("订单已取消，无法支付")
    if status in PAID_STATUSES:
        # 已付款：payParams 给 null，前端据此不再调起支付
        return ok({"orderId": order_id, "status": status, "payParams": None})

    settings = get_settings()

    # 没开真支付：小程序拿到 payParams=null 会自己判「支付成功」，这里同步把订单置为已付款
    if not pay_service.pay_enabled():
        if settings.mock_pay_auto_confirm:
            stamp = now_text()
            conn.execute(
                "UPDATE orders SET status = 'paid', paid_at = ?, updated_at = ? "
                "WHERE order_id = ?",
                (stamp, stamp, order_id),
            )
            logger.info("模拟支付：订单 %s 直接置为已支付", order_id)
            return ok({"orderId": order_id, "status": "paid", "payParams": None})

        return ok({"orderId": order_id, "status": status, "payParams": None})

    pay_params = await pay_service.create_pay_params(
        {
            "order_id": order_id,
            "goods_name": str(order.get("goods_name") or ""),
            "total_cents": int(order.get("total_cents") or 0),
        },
        user.get("openid"),
    )

    return ok({"orderId": order_id, "status": status, "payParams": pay_params})


@router.post("/orders/{order_id}/cancel", summary="取消待付款订单（扩展）")
def cancel_order(
    order_id: str,
    conn: sqlite3.Connection = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    order = fetch_one(conn, "SELECT * FROM orders WHERE order_id = ?", (order_id,))
    if order is None:
        raise not_found("订单不存在")
    if str(order["user_id"]) != str(user["user_id"]):
        raise forbidden("无权操作该订单")
    if str(order.get("status")) != "unpaid":
        raise bad_request("只有待付款订单可以取消")

    stamp = now_text()
    with transaction() as tx:
        tx.execute(
            "UPDATE orders SET status = 'canceled', updated_at = ? WHERE order_id = ?",
            (stamp, order_id),
        )
        tx.execute(
            "UPDATE goods SET stock = stock + ? WHERE goods_id = ?",
            (int(order.get("quantity") or 0), str(order.get("goods_id") or "")),
        )

    logger.info("取消订单 %s", order_id)
    return ok({"orderId": order_id, "status": "canceled"})
