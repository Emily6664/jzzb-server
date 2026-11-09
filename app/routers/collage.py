"""3.1 ~ 3.4 拼贴模板 / 素材 / 合成 / 作品。"""

from __future__ import annotations

import logging
import sqlite3

from fastapi import APIRouter, Depends, Request

from ..config import get_settings
from ..db import fetch_all, fetch_one, get_db
from ..envelope import ok
from ..errors import CODE_SERVER_ERROR, BizError, bad_request, forbidden, not_found
from ..schemas import ComposeRequest, GenerateImageRequest, SaveWorkRequest
from ..security import get_current_user
from ..serializers import material_out, template_out, work_out
from ..services import illustration, image_generation
from ..utils import clean_text, dumps, new_work_id, now_text

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/collage", tags=["拼贴"])

MAX_MATERIALS = 50


@router.get("/templates", summary="3.1 拼贴模板列表")
def list_templates(conn: sqlite3.Connection = Depends(get_db)):
    rows = fetch_all(conn, "SELECT * FROM collage_templates ORDER BY sort_order, template_id")
    return ok([template_out(row) for row in rows])


@router.get("/materials", summary="3.2 拼贴素材列表")
def list_materials(
    request: Request,
    conn: sqlite3.Connection = Depends(get_db),
):
    template_id = clean_text(request.query_params.get("templateId"), 64)
    if template_id:
        rows = fetch_all(
            conn,
            "SELECT * FROM collage_materials WHERE template_id = ? ORDER BY sort_order, id",
            (template_id,),
        )
    else:
        rows = fetch_all(conn, "SELECT * FROM collage_materials ORDER BY sort_order, id")
    return ok([material_out(row) for row in rows])


@router.post("/compose", summary="3.3 提交拼贴合成")
def compose(
    payload: ComposeRequest,
    conn: sqlite3.Connection = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """记录一次拼贴排版并返回作品地址。

    真正的像素合成（把素材按坐标画到画布上）需要图片处理能力，
    这一步先落库 + 返回占位地址；接上渲染服务后只需替换 image_url 的来源，
    接口结构不用动。
    """
    settings = get_settings()
    template_id = clean_text(payload.template_id, 64)
    if not template_id:
        raise bad_request("缺少模板 ID templateId")

    template = fetch_one(
        conn, "SELECT * FROM collage_templates WHERE template_id = ?", (template_id,)
    )
    if template is None:
        raise bad_request(f"模板不存在：{template_id}")

    if not payload.materials:
        raise bad_request("画布还是空的，请先放入素材")
    if len(payload.materials) > MAX_MATERIALS:
        raise bad_request(f"单个作品最多 {MAX_MATERIALS} 个素材")

    known_ids = {
        row["id"]
        for row in fetch_all(
            conn,
            "SELECT id FROM collage_materials WHERE template_id = ?",
            (template_id,),
        )
    }

    layout: list[dict] = []
    for item in payload.materials:
        material_id = clean_text(item.id, 64)
        if not material_id:
            raise bad_request("素材缺少 id")
        if material_id not in known_ids:
            raise bad_request(f"素材不存在或不属于该模板：{material_id}")
        layout.append(
            {
                "id": material_id,
                "x": round(float(item.x), 2),
                "y": round(float(item.y), 2),
                "scale": round(float(item.scale or 1), 3),
                "rotate": round(float(item.rotate or 0), 2),
            }
        )

    work_id = new_work_id()
    width = int(template.get("canvas_width") or 750)
    height = int(template.get("canvas_height") or 1000)
    image_url = f"{settings.media_public_base}/work/{work_id}.png"
    stamp = now_text()

    conn.execute(
        """
        INSERT INTO collage_works
            (work_id, user_id, template_id, image_url, title, width, height,
             item_count, layout_json, saved, created_at, saved_at)
        VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, 0, ?, NULL)
        """,
        (
            work_id,
            str(user["user_id"]),
            template_id,
            image_url,
            width,
            height,
            len(layout),
            dumps(layout),
            stamp,
        ),
    )

    logger.info("拼贴合成：%s（%d 个素材）", work_id, len(layout))
    return ok({"workId": work_id, "imageUrl": image_url, "width": width, "height": height})


@router.post("/works", summary="3.4 保存拼贴作品")
def save_work(
    payload: SaveWorkRequest,
    conn: sqlite3.Connection = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    work_id = clean_text(payload.work_id, 64)
    if not work_id:
        raise bad_request("缺少作品 ID workId")

    image_url = clean_text(payload.image_url, 512)
    title = clean_text(payload.title, 64) or "我的拼贴作品"
    stamp = now_text()

    row = fetch_one(conn, "SELECT * FROM collage_works WHERE work_id = ?", (work_id,))

    if row is None:
        # 允许「先出图后补单」：compose 没落库（比如换了设备）也能保存
        if not image_url:
            raise bad_request("缺少成图地址 imageUrl")
        conn.execute(
            """
            INSERT INTO collage_works
                (work_id, user_id, template_id, image_url, title, width, height,
                 item_count, layout_json, saved, created_at, saved_at)
            VALUES (?, ?, NULL, ?, ?, 750, 1000, 0, '[]', 1, ?, ?)
            """,
            (work_id, str(user["user_id"]), image_url, title, stamp, stamp),
        )
    else:
        if str(row["user_id"]) != str(user["user_id"]):
            raise forbidden("无权操作该作品")
        conn.execute(
            "UPDATE collage_works SET image_url = ?, title = ?, saved = 1, saved_at = ? WHERE work_id = ?",
            (image_url or row["image_url"], title, stamp, work_id),
        )

    return ok({"workId": work_id, "savedAt": stamp, "success": True})


@router.get("/works", summary="我的作品列表（扩展）")
def list_works(
    conn: sqlite3.Connection = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    rows = fetch_all(
        conn,
        "SELECT * FROM collage_works WHERE user_id = ? AND saved = 1 "
        "ORDER BY created_at DESC, work_id DESC",
        (str(user["user_id"]),),
    )
    return ok([work_out(row) for row in rows])


@router.delete("/works/{work_id}", summary="删除作品（扩展）")
def delete_work(
    work_id: str,
    conn: sqlite3.Connection = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    row = fetch_one(conn, "SELECT * FROM collage_works WHERE work_id = ?", (work_id,))
    if row is None:
        raise not_found("作品不存在")
    if str(row["user_id"]) != str(user["user_id"]):
        raise forbidden("无权操作该作品")

    conn.execute("DELETE FROM collage_works WHERE work_id = ?", (work_id,))
    return ok({"workId": work_id, "deleted": True})


@router.post("/generate", summary="AI 生成家庭插画")
def generate_image(
    payload: GenerateImageRequest,
    conn: sqlite3.Connection = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """把前端导出的拼贴成图变成一张「家庭专属插画」。

    - 配了 `IMAGE_API_KEY`：先调外部图生图服务，失败自动回落本地合成
    - 没配（默认）：用 `media/material/1..4.jpg` 这几张插画做本地合成，离线、无费用
    """
    settings = get_settings()
    template_id = clean_text(payload.template_id, 64)
    if not template_id:
        raise bad_request("缺少模板 ID templateId")

    template = fetch_one(
        conn, "SELECT * FROM collage_templates WHERE template_id = ?", (template_id,)
    )
    if template is None:
        raise bad_request(f"模板不存在：{template_id}")

    theme = str(template.get("theme") or "")
    work_id = new_work_id()
    subtitle = illustration.build_subtitle(str(template.get("name") or ""), now_text()[:10])
    width = int(template.get("canvas_width") or 750)
    height = int(template.get("canvas_height") or 1000)
    image_url: str | None = None

    if settings.image_api_key:
        try:
            remote = image_generation.generate(payload.image, theme, work_id)
            if remote.startswith("https://"):
                # 服务商给的是外链：下载回本地，统一用我们的域名下发
                try:
                    image_url, width, height = illustration.mirror_remote(remote, work_id)
                except Exception as exc:
                    logger.warning("镜像外部图片失败，直接使用原地址：%s", exc)
                    image_url = remote
            elif remote.startswith("/media/"):
                relative = remote[len("/media/") :]
                width, height = illustration.image_size(settings.media_dir / relative)
                image_url = f"{settings.media_public_base}/{relative}"
            else:
                raise BizError(CODE_SERVER_ERROR, "图生图服务返回了无法识别的地址")
        except Exception as exc:  # 外部服务不稳定时不让用户白等
            logger.warning("外部图生图不可用，改用本地合成：%s", exc)
            image_url = None

    if image_url is None:
        try:
            image_url, width, height = illustration.render(payload.image, theme, work_id, subtitle)
        except illustration.IllustrationError as exc:
            raise bad_request(str(exc))
        except Exception as exc:
            logger.exception("家庭插画合成失败：%s", exc)
            raise BizError(CODE_SERVER_ERROR, "插画生成失败，请稍后重试")

    # 生成即入库并标记为已保存：图片已经落在 media/work，作品列表立即可见；
    # 前端后面再调 /collage/works 只是补标题（幂等更新）。
    stamp = now_text()
    conn.execute(
        "INSERT INTO collage_works (work_id,user_id,template_id,image_url,title,width,height,item_count,layout_json,saved,created_at,saved_at) VALUES (?,?,?,?,?,?,?,0,'[]',1,?,?)",
        (
            work_id,
            str(user["user_id"]),
            template_id,
            image_url,
            "家庭专属插画",
            width,
            height,
            stamp,
            stamp,
        ),
    )

    logger.info("生成家庭插画：%s（%s）", work_id, template_id)
    return ok({"workId": work_id, "imageUrl": image_url, "width": width, "height": height})
