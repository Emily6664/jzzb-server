"""SQLite 存取层。

- 每次请求开一个连接，用完即关；SQLite 连接不能跨线程复用，这样最省心。
- 开启 WAL，读写互不阻塞；写操作用 BEGIN IMMEDIATE 提前抢写锁，避免下单并发撞号。
- 建表用 IF NOT EXISTS，可重复执行。
"""

from __future__ import annotations

import logging
import sqlite3
from contextlib import contextmanager
from typing import Any, Iterator, Sequence

from .config import get_settings

logger = logging.getLogger(__name__)

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS users (
    user_id       TEXT PRIMARY KEY,
    openid        TEXT UNIQUE,
    unionid       TEXT,
    phone         TEXT,
    nickname      TEXT    NOT NULL DEFAULT '',
    avatar_url    TEXT    NOT NULL DEFAULT '',
    address_count INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT    NOT NULL,
    updated_at    TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_tokens (
    token      TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens(user_id);

CREATE TABLE IF NOT EXISTS collage_templates (
    template_id   TEXT PRIMARY KEY,
    name          TEXT    NOT NULL,
    theme         TEXT    NOT NULL,
    description   TEXT    NOT NULL DEFAULT '',
    cover_url     TEXT    NOT NULL DEFAULT '',
    canvas_width  INTEGER NOT NULL DEFAULT 750,
    canvas_height INTEGER NOT NULL DEFAULT 1000,
    sort_order    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS collage_materials (
    id                 TEXT PRIMARY KEY,
    template_id        TEXT    NOT NULL,
    name               TEXT    NOT NULL,
    image_url          TEXT    NOT NULL DEFAULT '',
    description        TEXT    NOT NULL DEFAULT '',
    audio_url_mandarin TEXT    NOT NULL DEFAULT '',
    audio_url_hakka    TEXT    NOT NULL DEFAULT '',
    sort_order         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_collage_materials_template ON collage_materials(template_id);

CREATE TABLE IF NOT EXISTS map_spots (
    spot_id     TEXT PRIMARY KEY,
    name        TEXT    NOT NULL,
    map_x       REAL    NOT NULL DEFAULT 0,
    map_y       REAL    NOT NULL DEFAULT 0,
    description TEXT    NOT NULL DEFAULT '',
    image_url   TEXT    NOT NULL DEFAULT '',
    latitude    REAL,
    longitude   REAL,
    sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS nfc_tags (
    tag_id             TEXT PRIMARY KEY,
    title              TEXT NOT NULL,
    story_text         TEXT NOT NULL DEFAULT '',
    history_image_urls TEXT NOT NULL DEFAULT '[]',
    spot_id            TEXT,
    goods_id           TEXT,
    audio_url_mandarin TEXT NOT NULL DEFAULT '',
    audio_url_hakka    TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS nfc_scan_logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    tag_id     TEXT NOT NULL,
    scanned_at TEXT NOT NULL,
    latitude   REAL,
    longitude  REAL,
    user_id    TEXT,
    client_ip  TEXT,
    user_agent TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nfc_scan_logs_tag ON nfc_scan_logs(tag_id);

CREATE TABLE IF NOT EXISTS goods (
    goods_id          TEXT PRIMARY KEY,
    name              TEXT    NOT NULL,
    price_cents       INTEGER NOT NULL DEFAULT 0,
    cover_url         TEXT    NOT NULL DEFAULT '',
    summary           TEXT    NOT NULL DEFAULT '',
    detail_text       TEXT    NOT NULL DEFAULT '',
    detail_image_urls TEXT    NOT NULL DEFAULT '[]',
    spot_id           TEXT,
    stock             INTEGER NOT NULL DEFAULT 0,
    sort_order        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_goods_spot ON goods(spot_id);

CREATE TABLE IF NOT EXISTS orders (
    order_id       TEXT PRIMARY KEY,
    user_id        TEXT    NOT NULL,
    goods_id       TEXT    NOT NULL,
    goods_name     TEXT    NOT NULL,
    cover_url      TEXT    NOT NULL DEFAULT '',
    price_cents    INTEGER NOT NULL DEFAULT 0,
    quantity       INTEGER NOT NULL DEFAULT 1,
    total_cents    INTEGER NOT NULL DEFAULT 0,
    status         TEXT    NOT NULL DEFAULT 'unpaid',
    created_at     TEXT    NOT NULL,
    updated_at     TEXT    NOT NULL,
    paid_at        TEXT,
    address_id     TEXT,
    receiver       TEXT,
    receiver_phone TEXT,
    address_text   TEXT,
    work_image     TEXT    NOT NULL DEFAULT '',
    pay_mode       TEXT    NOT NULL DEFAULT 'mock',
    prepay_id      TEXT,
    remark         TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS collage_works (
    work_id     TEXT PRIMARY KEY,
    user_id     TEXT    NOT NULL,
    template_id TEXT,
    image_url   TEXT    NOT NULL DEFAULT '',
    title       TEXT    NOT NULL DEFAULT '',
    width       INTEGER NOT NULL DEFAULT 750,
    height      INTEGER NOT NULL DEFAULT 1000,
    item_count  INTEGER NOT NULL DEFAULT 0,
    layout_json TEXT    NOT NULL DEFAULT '[]',
    saved       INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL,
    saved_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_collage_works_user ON collage_works(user_id, created_at DESC);
"""


def connect() -> sqlite3.Connection:
    settings = get_settings()
    db_file = settings.database_file
    db_file.parent.mkdir(parents=True, exist_ok=True)

    # check_same_thread=False：FastAPI 会在不同的线程池线程里执行依赖和同步端点，
    # 同一个连接可能先后被两个线程用到。这里每个请求独占一个连接、用完即关，
    # 不存在并发访问，所以关掉线程亲和检查是安全的。
    conn = sqlite3.connect(
        str(db_file),
        timeout=15.0,
        isolation_level=None,
        check_same_thread=False,
    )
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=15000")
    return conn


@contextmanager
def get_conn() -> Iterator[sqlite3.Connection]:
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()


@contextmanager
def transaction() -> Iterator[sqlite3.Connection]:
    """写事务：BEGIN IMMEDIATE 先拿写锁，异常自动回滚。"""
    conn = connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        yield conn
        conn.execute("COMMIT")
    except BaseException:
        try:
            conn.execute("ROLLBACK")
        except sqlite3.Error:  # 已经回滚过，忽略
            pass
        raise
    finally:
        conn.close()


# ---------- FastAPI 依赖 ----------


def get_db() -> Iterator[sqlite3.Connection]:
    with get_conn() as conn:
        yield conn


# ---------- 小工具 ----------


def row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    return dict(row) if row is not None else None


def fetch_one(
    conn: sqlite3.Connection,
    sql: str,
    params: Sequence[Any] = (),
) -> dict[str, Any] | None:
    return row_to_dict(conn.execute(sql, tuple(params)).fetchone())


def fetch_all(
    conn: sqlite3.Connection,
    sql: str,
    params: Sequence[Any] = (),
) -> list[dict[str, Any]]:
    return [dict(row) for row in conn.execute(sql, tuple(params)).fetchall()]


def init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA_SQL)


def bootstrap(force_seed: bool = False) -> None:
    """建表 + 补种子数据；服务启动时调用，也可由命令行调用。"""
    from .seed import seed_all  # 放在函数里，避免循环导入

    settings = get_settings()
    with get_conn() as conn:
        init_schema(conn)

    if force_seed:
        seed_all(force=True)
    elif settings.seed_on_startup:
        seed_all(force=False)
