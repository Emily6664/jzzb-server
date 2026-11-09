"""请求体模型（只用于入参校验，响应统一走 { code, msg, data } 信封）。

字段别名与 API_DOC.md 保持一致：小程序发的是 camelCase（goodsId / templateId …），
这里用 alias 映射到 Python 的 snake_case，两种写法都能被接受。
extra="ignore"：以后前端多传字段不会报错（文档 5.4 的兼容约定）。
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class ApiModel(BaseModel):
    model_config = ConfigDict(
        extra="ignore",
        populate_by_name=True,
        str_strip_whitespace=True,
    )


# ==================== 3.12 创建订单 ====================


class AddressSnapshot(ApiModel):
    name: str = Field(default="", max_length=64, description="收货人")
    phone: str = Field(default="", max_length=32, description="收货手机号")
    region: list[str] = Field(default_factory=list, description="省 / 市 / 区")
    detail: str = Field(default="", max_length=256, description="详细地址")


class CreateOrderRequest(ApiModel):
    goods_id: str = Field(default="", alias="goodsId", description="商品 ID")
    count: int = Field(default=1, alias="count", description="购买数量")
    address_id: str = Field(default="", alias="addressId", description="收货地址 ID")
    address: AddressSnapshot | None = Field(default=None, description="收货地址快照")
    work_image: str = Field(default="", alias="workImage", description="定制作品图地址")


# ==================== 3.3 拼贴合成 ====================


class ComposeItem(ApiModel):
    id: str = Field(default="", description="素材 ID")
    x: float = Field(default=0, description="相对画布左上角的 X（设计稿像素）")
    y: float = Field(default=0, description="相对画布左上角的 Y（设计稿像素）")
    scale: float = Field(default=1, description="缩放比例")
    rotate: float = Field(default=0, description="旋转角度（度）")


class ComposeRequest(ApiModel):
    template_id: str = Field(default="", alias="templateId", description="模板 ID")
    materials: list[ComposeItem] = Field(default_factory=list, description="已放置的素材")


# ==================== 3.4 保存作品 ====================


class SaveWorkRequest(ApiModel):
    work_id: str = Field(default="", alias="workId", description="compose 返回的作品 ID")
    image_url: str = Field(default="", alias="imageUrl", description="成图地址")
    title: str = Field(default="", max_length=64, description="作品标题")


# ==================== 3.6 扫码上报 ====================


class ScanLogRequest(ApiModel):
    tag_id: str = Field(default="", alias="tagId", description="标签唯一标识")
    scanned_at: str | None = Field(default=None, alias="scannedAt", description="扫码时间")
    latitude: float | None = Field(default=None, description="扫码位置纬度（GCJ-02）")
    longitude: float | None = Field(default=None, description="扫码位置经度（GCJ-02）")


# ==================== 3.14 登录 ====================


class LoginRequest(ApiModel):
    login_code: str = Field(default="", alias="loginCode", description="wx.login() 的 code")
    phone_code: str | None = Field(
        default=None, alias="phoneCode", description="getPhoneNumber 回调里的 code"
    )


class GenerateImageRequest(ApiModel):
    template_id: str = Field(alias="templateId", min_length=1, max_length=64)
    image: str = Field(min_length=1, max_length=12000000, description="PNG/JPEG/WebP data URL")
