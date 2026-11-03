"""数据库行 -> 接口字段。

集中在这一层，保证「返回给小程序的结构」和 API_DOC.md 的字段表逐项对得上：
- 字段一个不多一个不少（扩展字段单独注释）；
- 空值按文档用 "" / [] / null / 0，不省略 key；
- 金额从「分」转「元」，整数金额给 int。
"""

from __future__ import annotations

from typing import Any

from .utils import loads_list, money


def text(value: Any) -> str:
    return "" if value is None else str(value)


def nullable_text(value: Any) -> str | None:
    if value is None:
        return None
    return "" if value == "" else str(value)


def number(value: Any) -> int | float:
    """REAL 列读出来是 168.0，接口上给 168 更自然。"""
    if value is None:
        return 0
    try:
        num = float(value)
    except (TypeError, ValueError):
        return 0
    return int(num) if num.is_integer() else num


def coord(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return round(float(value), 6)
    except (TypeError, ValueError):
        return None


# ==================== 3.1 模板 ====================


def template_out(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "templateId": text(row.get("template_id")),
        "name": text(row.get("name")),
        "theme": text(row.get("theme")),
        "description": text(row.get("description")),
        "coverUrl": text(row.get("cover_url")),
        "canvasWidth": int(row.get("canvas_width") or 0),
        "canvasHeight": int(row.get("canvas_height") or 0),
    }


# ==================== 3.2 素材 ====================


def material_out(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": text(row.get("id")),
        "templateId": text(row.get("template_id")),
        "name": text(row.get("name")),
        "imageUrl": text(row.get("image_url")),
        "description": text(row.get("description")),
        "audioUrlMandarin": text(row.get("audio_url_mandarin")),
        "audioUrlHakka": text(row.get("audio_url_hakka")),
    }


# ==================== 3.7 / 3.8 点位 ====================


def spot_out(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "spotId": text(row.get("spot_id")),
        "name": text(row.get("name")),
        "mapX": number(row.get("map_x")),
        "mapY": number(row.get("map_y")),
        "description": text(row.get("description")),
        "imageUrl": text(row.get("image_url")),
        "latitude": coord(row.get("latitude")),
        "longitude": coord(row.get("longitude")),
    }


# ==================== 3.5 溯源 ====================


def tag_out(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "tagId": text(row.get("tag_id")),
        "title": text(row.get("title")),
        "storyText": text(row.get("story_text")),
        "historyImageUrls": loads_list(row.get("history_image_urls")),
        "spotId": nullable_text(row.get("spot_id")),
        "goodsId": nullable_text(row.get("goods_id")),
        "audioUrlMandarin": text(row.get("audio_url_mandarin")),
        "audioUrlHakka": text(row.get("audio_url_hakka")),
    }


# ==================== 3.9 商品列表 ====================


def goods_list_out(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "goodsId": text(row.get("goods_id")),
        "name": text(row.get("name")),
        "price": money(row.get("price_cents")),
        "coverUrl": text(row.get("cover_url")),
        "summary": text(row.get("summary")),
        "spotId": nullable_text(row.get("spot_id")),
    }


# ==================== 3.10 商品详情 ====================


def goods_detail_out(row: dict[str, Any]) -> dict[str, Any]:
    item = goods_list_out(row)
    item.update(
        {
            "detailText": text(row.get("detail_text")),
            "detailImageUrls": loads_list(row.get("detail_image_urls")),
            # 扩展字段（文档 5.4 允许新增），前端不用也不影响
            "stock": int(row.get("stock") or 0),
        }
    )
    return item


# ==================== 3.11 订单 ====================


def order_out(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "orderId": text(row.get("order_id")),
        "goodsId": text(row.get("goods_id")),
        "goodsName": text(row.get("goods_name")),
        "coverUrl": text(row.get("cover_url")),
        "price": money(row.get("price_cents")),
        "count": int(row.get("quantity") or 0),
        "totalAmount": money(row.get("total_cents")),
        "status": text(row.get("status")),
        "createdAt": text(row.get("created_at")),
        # 以下是扩展字段：文档 3.11 提到的本地订单字段，服务端也一并下发
        "receiver": nullable_text(row.get("receiver")),
        "receiverPhone": nullable_text(row.get("receiver_phone")),
        "addressText": nullable_text(row.get("address_text")),
        "workImage": text(row.get("work_image")),
        "payMode": text(row.get("pay_mode")),
        "paidAt": nullable_text(row.get("paid_at")),
    }


# ==================== 拼贴作品（扩展接口） ====================


def work_out(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "workId": text(row.get("work_id")),
        "imageUrl": text(row.get("image_url")),
        "title": text(row.get("title")),
        "templateId": nullable_text(row.get("template_id")),
        "width": int(row.get("width") or 0),
        "height": int(row.get("height") or 0),
        "itemCount": int(row.get("item_count") or 0),
        "createdAt": text(row.get("created_at")),
        "savedAt": nullable_text(row.get("saved_at")),
    }


# ==================== 3.14 / 3.15 用户 ====================


def user_out(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "userId": text(row.get("user_id")),
        "phone": nullable_text(row.get("phone")),
        "nickname": text(row.get("nickname")),
        "avatarUrl": text(row.get("avatar_url")),
    }


def profile_out(row: dict[str, Any]) -> dict[str, Any]:
    item = user_out(row)
    item["addressCount"] = int(row.get("address_count") or 0)
    return item
