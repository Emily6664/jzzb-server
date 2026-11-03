"""零碎工具：时间、金额、ID、文本清洗。

约定（与 API_DOC.md 一致）：
- 时间统一 "YYYY-MM-DD HH:mm:ss" 本地时间字符串，不带时区后缀。
- 金额对外是「元」，number；数据库里存「分」，整数，避免浮点误差。
"""

from __future__ import annotations

import json
import random
import re
from datetime import datetime, timedelta, timezone as dt_timezone
from typing import Any
from zoneinfo import ZoneInfo

from .config import get_settings

FALLBACK_TZ = "Asia/Shanghai"

_TIME_FORMATS = (
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d %H:%M",
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%d",
    "%Y/%m/%d %H:%M:%S",
    "%Y/%m/%d %H:%M",
    "%Y/%m/%d",
)

# 手机号：宽松校验，只用于挡明显非法的输入
_PHONE_RE = re.compile(r"^[0-9+\-\s]{5,20}$")


def app_tz() -> Any:
    """取配置里的时区。

    Windows 上没有系统自带的 IANA 时区库，靠 tzdata 这个依赖提供；
    万一两边都拿不到，退回固定 +08:00，保证服务还能跑起来。
    """
    name = get_settings().timezone or FALLBACK_TZ
    try:
        return ZoneInfo(name)
    except Exception:  # 时区名写错 / 缺 tzdata
        try:
            return ZoneInfo(FALLBACK_TZ)
        except Exception:
            return dt_timezone(timedelta(hours=8))


def now() -> datetime:
    return datetime.now(app_tz())


def fmt(value: datetime | None) -> str | None:
    """datetime -> "YYYY-MM-DD HH:mm:ss"；naive 时间按本地时间处理。"""
    if value is None:
        return None
    if value.tzinfo is not None:
        value = value.astimezone(app_tz())
    return value.strftime("%Y-%m-%d %H:%M:%S")


def now_text() -> str:
    return fmt(now()) or ""


def parse_time(value: Any) -> datetime | None:
    """尽量宽松地把字符串解析成 datetime，解析不了返回 None。"""
    if isinstance(value, datetime):
        return value
    if not isinstance(value, str):
        return None

    text = value.strip()
    if not text:
        return None

    for pattern in _TIME_FORMATS:
        try:
            return datetime.strptime(text, pattern)
        except ValueError:
            continue

    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def time_or_now_text(value: Any) -> str:
    """客户端传的时间；非法或缺失时回退到服务器当前时间。"""
    parsed = parse_time(value)
    return fmt(parsed) or now_text()


def money(cents: Any) -> int | float:
    """分 -> 元。整数金额返回 int（39），非整数返回两位小数（39.9）。"""
    try:
        amount = round(int(cents or 0) / 100, 2)
    except (TypeError, ValueError):
        return 0
    return int(amount) if float(amount).is_integer() else amount


def to_cents(value: Any) -> int:
    """元 -> 分。"""
    try:
        return int(round(float(value) * 100))
    except (TypeError, ValueError):
        return 0


def new_order_id(moment: datetime | None = None) -> str:
    """订单号：ORD-YYYYMMDDHHMMSS-4位随机数（与 API_DOC 示例格式一致）。"""
    moment = moment or now()
    return f"ORD-{moment.strftime('%Y%m%d%H%M%S')}-{random.randint(1000, 9999)}"


def new_work_id(moment: datetime | None = None) -> str:
    moment = moment or now()
    return f"work-{moment.strftime('%Y%m%d%H%M%S')}-{random.randint(1000, 9999)}"


def loads_list(raw: Any) -> list:
    """数据库里的 JSON 数组字段 -> list；脏数据一律回退空数组。"""
    if isinstance(raw, list):
        return raw
    if not raw:
        return []
    try:
        value = json.loads(raw)
    except (TypeError, ValueError):
        return []
    return value if isinstance(value, list) else []


def dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def clean_text(value: Any, limit: int = 200) -> str:
    """去首尾空白并截断，避免超长文本进库。"""
    if value is None:
        return ""
    text = str(value).strip()
    return text[:limit]


def clean_phone(value: Any) -> str:
    text = clean_text(value, 32)
    return text if _PHONE_RE.match(text) else ""


def is_blank(value: Any) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def client_ip(request: Any) -> str:
    """反向代理后面取真实 IP：优先 X-Forwarded-For 的第一个。"""
    if request is None:
        return ""
    forwarded = request.headers.get("x-forwarded-for") or ""
    if forwarded:
        first = forwarded.split(",")[0].strip()
        if first:
            return first
    real = request.headers.get("x-real-ip") or ""
    if real.strip():
        return real.strip()
    return getattr(getattr(request, "client", None), "host", "") or ""
