"""微信支付 v3（可选能力，默认关闭）。

- WECHAT_PAY_ENABLED=false（默认）：create_pay_params() 直接返回 None，
  小程序 utils/api.js 的 doPay() 看到 payParams 为 null 就自动走模拟支付。
- WECHAT_PAY_ENABLED=true：用商户 API 私钥做 RSA-SHA256 签名，调 v3 JSAPI 统一下单，
  再给小程序返回 wx.requestPayment 需要的 5 个字段。

⚠️ 个人主体小程序无法开通微信支付；这段代码在没有真实商户号的情况下无法验证，
上线前必须用商户沙箱或 1 分钱实测一遍（签名、证书序列号、回调验签都要对）。
"""

from __future__ import annotations

import base64
import json
import logging
import time
import uuid
from pathlib import Path
from typing import Any, Mapping

from ..config import get_settings
from ..errors import CODE_SERVER_ERROR, BizError

logger = logging.getLogger(__name__)

PAY_HOST = "https://api.mch.weixin.qq.com"
JSAPI_PATH = "/v3/pay/transactions/jsapi"


def pay_enabled() -> bool:
    return bool(get_settings().wechat_pay_enabled)


def _require_crypto() -> Any:
    try:
        from cryptography.hazmat.primitives import hashes, serialization  # noqa: F401
        from cryptography.hazmat.primitives.asymmetric import padding  # noqa: F401
    except ImportError as exc:  # pragma: no cover - 取决于是否装了可选依赖
        raise BizError(
            CODE_SERVER_ERROR,
            "服务端未安装支付所需依赖，请执行 `uv sync --extra pay`",
        ) from exc
    return None


def _check_config() -> None:
    settings = get_settings()
    missing: list[str] = []
    if not settings.pay_appid:
        missing.append("WECHAT_APPID / WECHAT_PAY_APPID")
    if not settings.wechat_pay_mchid:
        missing.append("WECHAT_PAY_MCHID")
    if not settings.wechat_pay_serial_no:
        missing.append("WECHAT_PAY_SERIAL_NO")
    if not settings.wechat_pay_private_key_path:
        missing.append("WECHAT_PAY_PRIVATE_KEY_PATH")
    if not settings.wechat_pay_notify_url:
        missing.append("WECHAT_PAY_NOTIFY_URL")
    if missing:
        raise BizError(CODE_SERVER_ERROR, "微信支付配置不完整：" + "、".join(missing))


def _private_key_pem() -> str:
    path = Path(get_settings().wechat_pay_private_key_path)
    if not path.is_file():
        raise BizError(CODE_SERVER_ERROR, f"商户私钥文件不存在：{path}")
    return path.read_text(encoding="utf-8")


def _sign(message: str) -> str:
    """RSA-SHA256 签名，返回 base64。"""
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding

    key = serialization.load_pem_private_key(_private_key_pem().encode("utf-8"), password=None)
    signature = key.sign(message.encode("utf-8"), padding.PKCS1v15(), hashes.SHA256())
    return base64.b64encode(signature).decode("ascii")


def _auth_header(mchid: str, nonce: str, timestamp: str, signature: str) -> str:
    serial_no = get_settings().wechat_pay_serial_no
    return (
        'WECHATPAY2-SHA256-RSA2048 '
        f'mchid="{mchid}",nonce_str="{nonce}",signature="{signature}",'
        f'timestamp="{timestamp}",serial_no="{serial_no}"'
    )


async def _jsapi_prepay(order: Mapping[str, Any], openid: str) -> str:
    """调用 v3 JSAPI 统一下单，返回 prepay_id。"""
    import httpx

    settings = get_settings()
    body = {
        "appid": settings.pay_appid,
        "mchid": settings.wechat_pay_mchid,
        "description": f"{settings.wechat_pay_description_prefix}-{order['goods_name']}"[:127],
        "out_trade_no": order["order_id"],
        "notify_url": settings.wechat_pay_notify_url,
        "amount": {"total": int(order["total_cents"]), "currency": "CNY"},
        "payer": {"openid": openid},
    }
    payload = json.dumps(body, ensure_ascii=False, separators=(",", ":"))
    timestamp = str(int(time.time()))
    nonce = uuid.uuid4().hex

    message = f"POST\n{JSAPI_PATH}\n{timestamp}\n{nonce}\n{payload}\n"
    signature = _sign(message)
    headers = {
        "Authorization": _auth_header(settings.wechat_pay_mchid, nonce, timestamp, signature),
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "xiangyu-xinxu-server/1.0",
    }

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(15.0)) as client:
            response = await client.post(
                PAY_HOST + JSAPI_PATH,
                content=payload.encode("utf-8"),
                headers=headers,
            )
    except httpx.HTTPError as exc:
        logger.warning("微信支付统一下单网络异常: %s", exc)
        raise BizError(CODE_SERVER_ERROR, "微信支付服务暂时不可用") from exc

    if response.status_code >= 400:
        logger.warning("微信支付下单失败 %s: %s", response.status_code, response.text[:500])
        raise BizError(CODE_SERVER_ERROR, "微信支付下单失败，请稍后再试")

    try:
        data = response.json()
    except ValueError as exc:
        raise BizError(CODE_SERVER_ERROR, "微信支付返回异常") from exc

    prepay_id = str(data.get("prepay_id") or "")
    if not prepay_id:
        raise BizError(CODE_SERVER_ERROR, "微信支付未返回 prepay_id")
    return prepay_id


def _sign_pay_params(prepay_id: str) -> dict[str, str]:
    """生成 wx.requestPayment 需要的 5 个字段。"""
    settings = get_settings()
    timestamp = str(int(time.time()))
    nonce = uuid.uuid4().hex
    package = f"prepay_id={prepay_id}"

    message = f"{settings.pay_appid}\n{timestamp}\n{nonce}\n{package}\n"
    pay_sign = _sign(message)

    return {
        "timeStamp": timestamp,
        "nonceStr": nonce,
        "package": package,
        "signType": "RSA",
        "paySign": pay_sign,
    }


async def create_pay_params(order: Mapping[str, Any], openid: str | None) -> dict[str, str] | None:
    """未开启支付或缺少 openid 时返回 None（前端据此走模拟支付）。"""
    if not pay_enabled():
        return None

    if not openid:
        logger.warning("订单 %s 缺少 openid，跳过微信统一下单", order.get("order_id"))
        return None

    try:
        _require_crypto()
        _check_config()
        prepay_id = await _jsapi_prepay(order, openid)
        return _sign_pay_params(prepay_id)
    except BizError:
        raise
    except Exception as exc:  # pragma: no cover - 只在真商户号下才会走到
        logger.exception("微信支付签名失败: %s", exc)
        raise BizError(CODE_SERVER_ERROR, "微信支付签名失败，请检查支付配置") from exc


# ==================== 支付回调 ====================


def verify_notify(headers: Mapping[str, str], body: bytes) -> None:
    """校验微信支付回调签名；没配平台证书时只记一条告警。"""
    settings = get_settings()
    cert_path = settings.wechat_pay_platform_cert_path

    if not cert_path:
        logger.warning(
            "未配置 WECHAT_PAY_PLATFORM_CERT_PATH，跳过支付回调验签"
            "（生产环境务必配置，否则任何人都能伪造回调）"
        )
        return

    path = Path(cert_path)
    if not path.is_file():
        raise BizError(CODE_SERVER_ERROR, f"支付平台证书不存在：{path}")

    timestamp = str(headers.get("wechatpay-timestamp") or "")
    nonce = str(headers.get("wechatpay-nonce") or "")
    signature = str(headers.get("wechatpay-signature") or "")
    if not (timestamp and nonce and signature):
        raise BizError(CODE_SERVER_ERROR, "支付回调缺少签名头")

    # 简单防重放：5 分钟以外的回调直接拒绝
    try:
        if abs(int(time.time()) - int(timestamp)) > 300:
            raise BizError(CODE_SERVER_ERROR, "支付回调时间戳超出允许范围")
    except ValueError as exc:
        raise BizError(CODE_SERVER_ERROR, "支付回调时间戳非法") from exc

    from cryptography import x509
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import padding

    certificate = x509.load_pem_x509_certificate(path.read_bytes())
    message = f"{timestamp}\n{nonce}\n".encode("utf-8") + body + b"\n"

    try:
        certificate.public_key().verify(
            base64.b64decode(signature),
            message,
            padding.PKCS1v15(),
            hashes.SHA256(),
        )
    except Exception as exc:
        logger.warning("支付回调验签失败: %s", exc)
        raise BizError(CODE_SERVER_ERROR, "支付回调验签失败") from exc


def decrypt_resource(resource: Mapping[str, Any]) -> dict[str, Any]:
    """用 APIv3 密钥做 AES-256-GCM 解密，拿到通知里的订单信息。"""
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    key = (get_settings().wechat_pay_api_v3_key or "").encode("utf-8")
    if len(key) != 32:
        raise BizError(CODE_SERVER_ERROR, "WECHAT_PAY_API_V3_KEY 必须是 32 字节")

    ciphertext = str(resource.get("ciphertext") or "")
    nonce = str(resource.get("nonce") or "")
    associated = str(resource.get("associated_data") or "")
    if not (ciphertext and nonce):
        raise BizError(CODE_SERVER_ERROR, "支付回调内容不完整")

    plaintext = AESGCM(key).decrypt(
        nonce.encode("utf-8"),
        base64.b64decode(ciphertext),
        associated.encode("utf-8"),
    )

    try:
        data = json.loads(plaintext)
    except ValueError as exc:
        raise BizError(CODE_SERVER_ERROR, "支付回调内容解析失败") from exc

    return data if isinstance(data, dict) else {}
