"""种子数据导入。

幂等：所有插入都是 INSERT OR IGNORE，重复执行不会产生重复行，也不会覆盖手工改过的数据。
需要「推倒重来」时用命令行：

    uv run python -m app.seed --force          # 只重建参考数据（模板/素材/点位/标签/商品）
    uv run python -m app.seed --force --orders  # 连演示订单一起重建
"""

from __future__ import annotations

import argparse
import logging
import sqlite3

from .config import get_settings
from .db import get_conn, init_schema
from .security import ensure_demo_user
from .seed_data import DEMO_ORDERS, GOODS, MATERIALS, NFC_TAGS, SPOTS, TEMPLATES
from .utils import dumps, to_cents

logger = logging.getLogger(__name__)

# 参考数据表：--force 时清空重建
REFERENCE_TABLES = (
    "collage_templates",
    "collage_materials",
    "map_spots",
    "nfc_tags",
    "goods",
)


def _insert_templates(conn: sqlite3.Connection) -> int:
    count = 0
    for index, item in enumerate(TEMPLATES):
        conn.execute(
            """
            INSERT OR IGNORE INTO collage_templates
                (template_id, name, theme, description, cover_url,
                 canvas_width, canvas_height, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                item["templateId"],
                item["name"],
                item["theme"],
                item["description"],
                item["coverUrl"],
                int(item["canvasWidth"]),
                int(item["canvasHeight"]),
                index,
            ),
        )
        count += 1
    return count


def _insert_materials(conn: sqlite3.Connection) -> int:
    for index, item in enumerate(MATERIALS):
        conn.execute(
            """
            INSERT OR IGNORE INTO collage_materials
                (id, template_id, name, image_url, description,
                 audio_url_mandarin, audio_url_hakka, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                item["id"],
                item["templateId"],
                item["name"],
                item["imageUrl"],
                item["description"],
                item["audioUrlMandarin"],
                item["audioUrlHakka"],
                index,
            ),
        )
    return len(MATERIALS)


def _insert_spots(conn: sqlite3.Connection) -> int:
    for index, item in enumerate(SPOTS):
        conn.execute(
            """
            INSERT OR IGNORE INTO map_spots
                (spot_id, name, map_x, map_y, description, image_url,
                 latitude, longitude, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                item["spotId"],
                item["name"],
                item["mapX"],
                item["mapY"],
                item["description"],
                item["imageUrl"],
                item["latitude"],
                item["longitude"],
                index,
            ),
        )
    return len(SPOTS)


def _insert_tags(conn: sqlite3.Connection) -> int:
    for item in NFC_TAGS:
        conn.execute(
            """
            INSERT OR IGNORE INTO nfc_tags
                (tag_id, title, story_text, history_image_urls, spot_id, goods_id,
                 audio_url_mandarin, audio_url_hakka)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                item["tagId"],
                item["title"],
                item["storyText"],
                dumps(item["historyImageUrls"]),
                item["spotId"],
                item["goodsId"],
                item["audioUrlMandarin"],
                item["audioUrlHakka"],
            ),
        )
    return len(NFC_TAGS)


def _insert_goods(conn: sqlite3.Connection) -> int:
    for index, item in enumerate(GOODS):
        # sortOrder 决定列表展示顺序（商品素材编号 1..N），没写就按列表顺序
        sort_order = int(item.get("sortOrder", index))
        conn.execute(
            """
            INSERT OR IGNORE INTO goods
                (goods_id, name, price_cents, cover_url, summary, detail_text,
                 detail_image_urls, spot_id, stock, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                item["goodsId"],
                item["name"],
                to_cents(item["price"]),
                item["coverUrl"],
                item["summary"],
                item["detailText"],
                dumps(item["detailImageUrls"]),
                item["spotId"],
                int(item.get("stock", 100)),
                sort_order,
            ),
        )
    return len(GOODS)


def _insert_demo_orders(conn: sqlite3.Connection, user_id: str) -> int:
    for item in DEMO_ORDERS:
        conn.execute(
            """
            INSERT OR IGNORE INTO orders
                (order_id, user_id, goods_id, goods_name, cover_url, price_cents,
                 quantity, total_cents, status, created_at, updated_at, paid_at,
                 address_id, receiver, receiver_phone, address_text, work_image,
                 pay_mode, prepay_id, remark)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, '', ?, NULL, NULL)
            """,
            (
                item["orderId"],
                user_id,
                item["goodsId"],
                item["goodsName"],
                item["coverUrl"],
                to_cents(item["price"]),
                int(item["quantity"]),
                to_cents(item["totalAmount"]),
                item["status"],
                item["createdAt"],
                item.get("paidAt") or item["createdAt"],
                item.get("paidAt"),
                item.get("receiver"),
                item.get("receiverPhone"),
                item.get("addressText"),
                item.get("payMode") or "mock",
            ),
        )
    return len(DEMO_ORDERS)


def seed_all(force: bool = False, reset_orders: bool = False) -> dict[str, int]:
    """导入种子数据，返回各表写入条数（便于日志）。"""
    settings = get_settings()
    counts: dict[str, int] = {}

    with get_conn() as conn:
        init_schema(conn)

        if force:
            for table in REFERENCE_TABLES:
                conn.execute(f"DELETE FROM {table}")  # 表名来自白名单常量
            logger.info("已清空参考数据表：%s", ", ".join(REFERENCE_TABLES))

        if reset_orders:
            conn.execute("DELETE FROM orders WHERE order_id IN (%s)" % ",".join(["?"] * len(DEMO_ORDERS)),
                         tuple(item["orderId"] for item in DEMO_ORDERS))

        counts["templates"] = _insert_templates(conn)
        counts["materials"] = _insert_materials(conn)
        counts["spots"] = _insert_spots(conn)
        counts["tags"] = _insert_tags(conn)
        counts["goods"] = _insert_goods(conn)

        demo_user = ensure_demo_user(conn)
        counts["demo_user"] = 1 if demo_user else 0

        if settings.seed_demo_data:
            counts["demo_orders"] = _insert_demo_orders(conn, demo_user["user_id"])
        else:
            counts["demo_orders"] = 0

    logger.info("种子数据就绪：%s", counts)
    return counts


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="初始化 / 重建数据库种子数据")
    parser.add_argument(
        "--force",
        action="store_true",
        help="先清空模板 / 素材 / 点位 / 标签 / 商品，再重新导入",
    )
    parser.add_argument(
        "--orders",
        action="store_true",
        help="同时重建三条演示订单（不影响用户自己下的订单之外的数据）",
    )
    args = parser.parse_args(argv)

    logging.basicConfig(level="INFO", format="%(levelname)s %(name)s: %(message)s")

    settings = get_settings()
    print(f"数据库文件：{settings.database_file}")
    counts = seed_all(force=args.force, reset_orders=args.orders)
    for key, value in counts.items():
        print(f"  {key:12s} {value}")


if __name__ == "__main__":
    main()
