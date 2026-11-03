"""运行配置。

所有配置项都可以用同名环境变量覆盖（大小写不敏感），也可以写在 server/.env 里。
.env 只在本机开发时用；线上建议直接用环境变量或 systemd EnvironmentFile。
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# server/ 目录（pyproject.toml 所在目录），相对路径都以它为基准
BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ---------- 基础 ----------
    app_name: str = "乡语新叙 API"
    # 监听所有网卡，配合反向代理（https://ecg.proxy.lc.cygnomatic.net/）使用；
    # 只想让本机代理转发，可以在 .env 里改回 127.0.0.1
    host: str = "0.0.0.0"
    port: int = 8000
    # 信任哪些来源的 X-Forwarded-*（对应 uvicorn 的 forwarded_allow_ips）。
    # "*" = 全部信任；代理和服务在同一台机器时，建议改成 127.0.0.1 防止别人伪造客户端 IP。
    forwarded_allow_ips: str = "*"
    # 接口前缀，与小程序 utils/api.js 的 BASE_URL 结尾保持一致（默认 https://域名/api）
    api_prefix: str = "/api"
    # 反向代理把服务挂在子路径（例如 https://域名/xiangyu）时填这个
    root_path: str = ""
    log_level: str = "INFO"
    timezone: str = "Asia/Shanghai"
    # 生产环境可关掉 /docs，避免暴露接口文档
    docs_enabled: bool = True
    # 允许跨域的来源，逗号分隔；"*" 表示全部（仅小程序用不到 CORS，留着方便浏览器调试）
    cors_origins: str = "*"

    # ---------- 存储 ----------
    data_dir: Path = BASE_DIR / "data"
    # 留空则使用 data_dir/app.db
    db_path: Path | None = None
    # 启动时建表并补种子数据（幂等，不会覆盖已有数据）
    seed_on_startup: bool = True
    # 是否插入演示订单（与 mock/mock-goods.js 的三条一致）
    seed_demo_data: bool = True

    # ---------- 登录态 ----------
    # 小程序当前不会自动带 Authorization 头，所以默认不强制登录：
    # 没有 token 时后端按「演示用户」处理，接口照样能跑通。
    # 等前端补上 token 注入后，把它改成 true 即可开启强校验。
    auth_required: bool = False
    token_ttl_seconds: int = 60 * 60 * 24 * 30
    demo_user_id: str = "user-0001"
    demo_user_phone: str = "13800138000"
    demo_user_nickname: str = "围山访客"

    # 未开启微信支付时，调 /goods/orders/{id}/pay 是否直接把订单标记为已支付。
    # 小程序在拿到 payParams=null 时会自己判定「支付成功」，这里保持同样的语义，
    # 否则「我的订单」里本地显示已付款、服务端仍是待付款，两端会打架。
    mock_pay_auto_confirm: bool = True

    # 详情类查询（标签 / 商品 / 点位）没命中时怎么返回：
    #   true  → code 0 + data null，和小程序 mock 的行为一致，页面走「空态」；
    #   false → 按 API_DOC 返回 40400 + msg，调用方按错误处理。
    # 前端页面目前用 `if (!detail) 显示空态`，所以默认 true。
    not_found_as_null: bool = True

    # ---------- 静态资源域名 ----------
    # 种子数据里图片 / 音频用的占位域名，默认与 mock/ 完全一致
    media_source_base: str = "https://cdn.example.com/xiangyu-xinxu"
    # 配了就把上面的前缀替换成真实地址（例如 https://cdn.your-domain.com/xiangyu），
    # 不用改数据库、也不用重新导入种子数据。留空表示原样返回。
    media_base_url: str = ""

    # ---------- 微信小程序 ----------
    wechat_appid: str = ""
    wechat_secret: str = ""
    wechat_api_base: str = "https://api.weixin.qq.com"
    # 未配置 appid/secret 时登录走演示模式（固定返回演示用户），便于本地联调
    # ---------- 微信支付 v3（默认关闭，个人主体小程序用不上） ----------
    wechat_pay_enabled: bool = False
    wechat_pay_appid: str = ""
    wechat_pay_mchid: str = ""
    wechat_pay_serial_no: str = ""
    wechat_pay_private_key_path: str = ""
    wechat_pay_api_v3_key: str = ""
    wechat_pay_notify_url: str = ""
    # 平台证书 PEM 路径，配了才校验支付回调签名（生产环境强烈建议配）
    wechat_pay_platform_cert_path: str = ""
    wechat_pay_description_prefix: str = "乡语新叙文创"

    # ---------- 校验 ----------

    @field_validator("api_prefix", mode="before")
    @classmethod
    def _normalize_api_prefix(cls, value: Any) -> str:
        text = str(value or "").strip()
        if text in ("", "/"):
            return ""
        if not text.startswith("/"):
            text = "/" + text
        return text.rstrip("/")

    @field_validator("root_path", mode="before")
    @classmethod
    def _normalize_root_path(cls, value: Any) -> str:
        text = str(value or "").strip()
        if text in ("", "/"):
            return ""
        if not text.startswith("/"):
            text = "/" + text
        return text.rstrip("/")

    @field_validator("data_dir", mode="before")
    @classmethod
    def _resolve_data_dir(cls, value: Any) -> Path:
        path = Path(str(value or "data")).expanduser()
        return path if path.is_absolute() else (BASE_DIR / path)

    @field_validator("db_path", mode="before")
    @classmethod
    def _resolve_db_path(cls, value: Any) -> Path | None:
        if value is None:
            return None
        text = str(value).strip()
        if text in ("", "null", "None"):
            return None
        path = Path(text).expanduser()
        return path if path.is_absolute() else (BASE_DIR / path)

    @field_validator("log_level", mode="before")
    @classmethod
    def _upper_log_level(cls, value: Any) -> str:
        return str(value or "INFO").upper()

    # ---------- 派生属性 ----------

    @property
    def database_file(self) -> Path:
        return self.db_path or (self.data_dir / "app.db")

    @property
    def cors_origin_list(self) -> list[str]:
        raw = (self.cors_origins or "").strip()
        if not raw or raw == "*":
            return ["*"]
        return [item.strip() for item in raw.split(",") if item.strip()]

    @property
    def wechat_mock(self) -> bool:
        """没配 appid/secret 就无法真正调微信接口，登录降级为演示模式。"""
        return not (self.wechat_appid and self.wechat_secret)

    @property
    def pay_appid(self) -> str:
        return self.wechat_pay_appid or self.wechat_appid

    @property
    def media_public_base(self) -> str:
        """生成新资源地址时用的对外前缀。"""
        return (self.media_base_url or self.media_source_base).rstrip("/")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
