"""「AI 生成家庭插画」——本地合成。

没有接第三方生图模型（也不需要 API key）。这里的做法是**规则合成**：
把前端导出的拼贴海报，装进 `media/material/1..4.jpg` 这几张同主题插画的版式里，
产出一张 1080×1350 的「家庭专属插画」——上方标题、中间你的拼贴、外面是插画底纹。

替换成真实生图服务时，只要保持 `compose_and_save()` 的签名与输出尺寸，
接口契约（workId / imageUrl / width / height）不用动。
"""

from __future__ import annotations

import base64
import binascii
import io
import logging
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

from ..config import get_settings

logger = logging.getLogger(__name__)

WIDTH = 1080
HEIGHT = 1440

CREAM = (246, 241, 231)
INK = (92, 80, 64)
INK_SOFT = (128, 114, 92)
GOLD = (176, 148, 98)
WHITE = (255, 255, 255)

# 模板主题 -> 插画素材（1/2 是彩稿，3/4 是线稿）
ILLUSTRATION_POOL: dict[str, tuple[str, ...]] = {
    "childlike": ("1.jpg", "2.jpg"),
    "retro": ("3.jpg", "4.jpg"),
}

THEME_TEXT = {"childlike": "童趣", "retro": "复古"}

MAX_BYTES = 12 * 1024 * 1024

FONT_CANDIDATES = (
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\msyhbd.ttc",
    r"C:\Windows\Fonts\simhei.ttf",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
)


class IllustrationError(ValueError):
    """入参不合法（base64 解不出来、不是图片、太大）。"""


# ==================== 入参 ====================


def decode_data_url(data: str) -> Image.Image:
    """把 data:image/png;base64,... 解成 RGBA 图。"""
    text = (data or "").strip()
    if not text:
        raise IllustrationError("缺少拼贴成图 image")

    if text.startswith("data:"):
        _, _, text = text.partition(",")
    if not text:
        raise IllustrationError("image 内容为空")

    try:
        raw = base64.b64decode(text, validate=False)
    except (binascii.Error, ValueError) as exc:
        raise IllustrationError("image 不是合法的 base64") from exc

    if not raw:
        raise IllustrationError("image 内容为空")
    if len(raw) > MAX_BYTES:
        raise IllustrationError(f"拼贴成图太大（{len(raw) / 1024 / 1024:.1f}MB，上限 12MB）")

    try:
        image = Image.open(io.BytesIO(raw))
        image.load()
    except Exception as exc:  # PIL 的异常类型很多，统一兜住
        raise IllustrationError("image 不是可识别的图片") from exc

    return image.convert("RGBA")


# ==================== 绘图工具 ====================


def _font(size: int) -> ImageFont.FreeTypeFont | None:
    for path in FONT_CANDIDATES:
        if Path(path).is_file():
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return None


def _cover(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    """等比缩放后居中裁剪到目标尺寸（铺满）。"""
    target_w, target_h = size
    ratio = max(target_w / image.width, target_h / image.height)
    resized = image.resize(
        (max(1, round(image.width * ratio)), max(1, round(image.height * ratio))),
        Image.LANCZOS,
    )
    left = (resized.width - target_w) // 2
    top = (resized.height - target_h) // 2
    return resized.crop((left, top, left + target_w, top + target_h))


def _rounded_mask(size: tuple[int, int], radius: int) -> Image.Image:
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size[0] - 1, size[1] - 1), radius=radius, fill=255)
    return mask


def _pick_illustration(theme: str) -> Path | None:
    pool = ILLUSTRATION_POOL.get(theme) or ILLUSTRATION_POOL["childlike"]
    folder = get_settings().media_dir / "material"
    candidates = [folder / name for name in pool if (folder / name).is_file()]
    if not candidates:
        logger.warning("没有找到插画素材，改用纯色底：%s", folder)
        return None
    return random.choice(candidates)


# ==================== 合成 ====================


def compose(collage: Image.Image, theme: str, subtitle: str) -> Image.Image:
    """把拼贴成图装进插画版式，返回 1080×1440 的成品。"""
    canvas = Image.new("RGBA", (WIDTH, HEIGHT), CREAM + (255,))

    # 1) 底纹：插画铺满 -> 模糊 -> 米色蒙层，留出一点颜色和笔触
    art = _pick_illustration(theme)
    if art is not None:
        try:
            with Image.open(art) as src:
                backdrop = _cover(src.convert("RGB"), (WIDTH, HEIGHT))
        except OSError as exc:
            logger.warning("插画素材读取失败 %s：%s", art, exc)
            backdrop = None

        if backdrop is not None:
            backdrop = backdrop.filter(ImageFilter.GaussianBlur(26))
            canvas.paste(backdrop, (0, 0))
            canvas = Image.alpha_composite(canvas, Image.new("RGBA", canvas.size, CREAM + (198,)))

    # 2) 标题
    draw = ImageDraw.Draw(canvas)
    title_font = _font(66)
    sub_font = _font(30)
    small_font = _font(26)

    if title_font:
        draw.text((WIDTH // 2, 118), "家庭专属插画", font=title_font, fill=INK, anchor="mm")
    if sub_font:
        draw.text(
            (WIDTH // 2, 186),
            f"AI 拼贴 · {THEME_TEXT.get(theme, '童趣')}风格",
            font=sub_font,
            fill=INK_SOFT,
            anchor="mm",
        )

    # 3) 白卡按作品比例贴合，四周留出插画底纹
    pad = 26
    zone_top, zone_bottom = 236, 1214
    box_w = WIDTH - 2 * 96 - 2 * pad
    box_h = zone_bottom - zone_top - 2 * pad
    ratio = min(box_w / collage.width, box_h / collage.height, 4.0)
    inner_w = max(1, round(collage.width * ratio))
    inner_h = max(1, round(collage.height * ratio))
    card_w = inner_w + pad * 2
    card_h = inner_h + pad * 2
    card_left = (WIDTH - card_w) // 2
    card_top = zone_top + ((zone_bottom - zone_top) - card_h) // 2
    card = (card_left, card_top, card_left + card_w, card_top + card_h)

    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        (card[0] + 8, card[1] + 16, card[2] + 8, card[3] + 16),
        radius=30,
        fill=(78, 66, 48, 76),
    )
    canvas = Image.alpha_composite(canvas, shadow.filter(ImageFilter.GaussianBlur(18)))

    card_layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(card_layer).rounded_rectangle(card, radius=30, fill=WHITE + (255,))
    canvas = Image.alpha_composite(canvas, card_layer)

    inner = collage.resize((inner_w, inner_h), Image.LANCZOS)
    canvas.paste(inner, (card_left + pad, card_top + pad), _rounded_mask(inner.size, 16))

    # 4) 页脚
    draw = ImageDraw.Draw(canvas)
    draw.line(
        ((WIDTH - 240) // 2, 1252, (WIDTH + 240) // 2, 1252),
        fill=GOLD,
        width=2,
    )
    if small_font:
        draw.text((WIDTH // 2, 1300), subtitle, font=small_font, fill=INK_SOFT, anchor="mm")

    return canvas.convert("RGB")


def compose_and_save(
    collage: Image.Image,
    theme: str,
    target: Path,
    subtitle: str = "",
) -> tuple[int, int]:
    """合成并写入文件，返回 (width, height)。"""
    canvas = compose(collage, theme, subtitle)
    target.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(target, format="JPEG", quality=90, optimize=True, progressive=True)
    return canvas.size


def build_subtitle(template_name: str, date_text: str) -> str:
    name = (template_name or "").strip()
    return f"{name} · {date_text}" if name else date_text


def render(
    image_data_url: str,
    theme: str,
    work_id: str,
    subtitle: str = "",
) -> tuple[str, int, int]:
    """合成一张家庭插画并落盘，返回 (对外 URL, width, height)。"""
    settings = get_settings()
    collage = decode_data_url(image_data_url)

    target = settings.media_dir / "work" / f"{work_id}.jpg"
    width, height = compose_and_save(collage, theme, target, subtitle)

    logger.info("家庭插画已生成：%s（%dx%d，%dKB）", target.name, width, height, target.stat().st_size // 1024)
    return f"{settings.media_public_base}/work/{target.name}", width, height


def image_size(path: Path) -> tuple[int, int]:
    with Image.open(path) as image:
        return image.width, image.height


def mirror_remote(url: str, work_id: str) -> tuple[str, int, int]:
    """把图生图服务返回的 https 图片下载到本地 media/work。

    好处有两个：
    - 对外只有一个域名，小程序不用再给服务商的图片域名配 downloadFile 白名单；
    - 图片真正落在自己服务器上，不会因为服务商链接过期而变成裂图。
    """
    import httpx

    settings = get_settings()

    with httpx.Client(timeout=30.0, follow_redirects=True) as client:
        response = client.get(url, headers={"User-Agent": "xiangyu-xinxu-server/1.0"})
        response.raise_for_status()
        data = response.content

    if not data:
        raise IllustrationError("图生图返回了空图片")
    if len(data) > MAX_BYTES:
        raise IllustrationError(f"图生图返回的图片过大（{len(data) / 1024 / 1024:.1f}MB）")

    try:
        with Image.open(io.BytesIO(data)) as source:
            source.load()
            image = source.convert("RGB")
    except Exception as exc:
        raise IllustrationError("图生图返回的内容不是图片") from exc

    target = settings.media_dir / "work" / f"{work_id}.jpg"
    target.parent.mkdir(parents=True, exist_ok=True)
    image.save(target, format="JPEG", quality=92, optimize=True, progressive=True)

    logger.info(
        "图生图结果已镜像到本地：%s（%dx%d，%dKB）",
        target.name,
        image.width,
        image.height,
        target.stat().st_size // 1024,
    )
    return f"{settings.media_public_base}/work/{target.name}", image.width, image.height
