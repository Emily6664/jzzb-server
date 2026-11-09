"""初始数据（与小程序 mock/ 目录逐字段一致）。

注意：
- 图片 / 音频地址沿用 mock 里的占位域名 cdn.example.com，线上用 MEDIA_BASE_URL 统一替换；
  想换成真实地址，改这个文件后执行 `uv run python -m app.seed --force`。
- price 用「元」书写（与文档一致），入库时转成「分」。
"""

from __future__ import annotations

# ==================== 3.1 拼贴模板 ====================

TEMPLATES: list[dict] = [
    {
        "templateId": "tpl-childlike",
        "name": "童趣拼贴",
        "theme": "childlike",
        "description": "圆润线条配明亮配色，小朋友也能一眼认出的围屋、土楼和花灯。",
        "coverUrl": "https://cdn.example.com/xiangyu-xinxu/template/tpl-childlike-cover.png",
        "canvasWidth": 750,
        "canvasHeight": 1000,
    },
    {
        "templateId": "tpl-retro",
        "name": "复古拼贴",
        "theme": "retro",
        "description": "做旧纸感与低饱和色调，把老照片里的客家日常重新拼起来。",
        "coverUrl": "https://cdn.example.com/xiangyu-xinxu/template/tpl-retro-cover.png",
        "canvasWidth": 750,
        "canvasHeight": 1000,
    },
]

# ==================== 3.2 拼贴素材 ====================

MATERIALS: list[dict] = [
    # 童趣套装
    {
        "id": "mat-childlike-01",
        "templateId": "tpl-childlike",
        "name": "卡通围屋",
        "imageUrl": "https://cdn.example.com/xiangyu-xinxu/material/mat-childlike-01.png",
        "description": "圆角造型的客家围屋，屋前还趴着一只打盹的黄狗。",
        "audioUrlMandarin": "https://cdn.example.com/xiangyu-xinxu/audio/mat-childlike-01-mandarin.mp3",
        "audioUrlHakka": "https://cdn.example.com/xiangyu-xinxu/audio/mat-childlike-01-hakka.mp3",
    },
    {
        "id": "mat-childlike-02",
        "templateId": "tpl-childlike",
        "name": "卡通土楼",
        "imageUrl": "https://cdn.example.com/xiangyu-xinxu/material/mat-childlike-02.png",
        "description": "圆圆一圈的土楼，屋顶上画了几只飞过的燕子。",
        "audioUrlMandarin": "https://cdn.example.com/xiangyu-xinxu/audio/mat-childlike-02-mandarin.mp3",
        "audioUrlHakka": "https://cdn.example.com/xiangyu-xinxu/audio/mat-childlike-02-hakka.mp3",
    },
    {
        "id": "mat-childlike-03",
        "templateId": "tpl-childlike",
        "name": "花灯小灯",
        "imageUrl": "https://cdn.example.com/xiangyu-xinxu/material/mat-childlike-03.png",
        "description": "提着就能走的小花灯，灯面上画了笑脸。",
        "audioUrlMandarin": "https://cdn.example.com/xiangyu-xinxu/audio/mat-childlike-03-mandarin.mp3",
        "audioUrlHakka": "https://cdn.example.com/xiangyu-xinxu/audio/mat-childlike-03-hakka.mp3",
    },
    {
        "id": "mat-childlike-04",
        "templateId": "tpl-childlike",
        "name": "擂茶小碗",
        "imageUrl": "https://cdn.example.com/xiangyu-xinxu/material/mat-childlike-04.png",
        "description": "冒着热气的一碗擂茶，旁边还摆着花生和芝麻。",
        "audioUrlMandarin": "https://cdn.example.com/xiangyu-xinxu/audio/mat-childlike-04-mandarin.mp3",
        "audioUrlHakka": "https://cdn.example.com/xiangyu-xinxu/audio/mat-childlike-04-hakka.mp3",
    },
    # 复古套装
    {
        "id": "mat-retro-01",
        "templateId": "tpl-retro",
        "name": "老围屋",
        "imageUrl": "https://cdn.example.com/xiangyu-xinxu/material/mat-retro-01.png",
        "description": "上世纪八十年代拍下的围屋正门，墙面斑驳，门楣上还留着红漆字。",
        "audioUrlMandarin": "https://cdn.example.com/xiangyu-xinxu/audio/mat-retro-01-mandarin.mp3",
        "audioUrlHakka": "https://cdn.example.com/xiangyu-xinxu/audio/mat-retro-01-hakka.mp3",
    },
    {
        "id": "mat-retro-02",
        "templateId": "tpl-retro",
        "name": "竹编茶篮",
        "imageUrl": "https://cdn.example.com/xiangyu-xinxu/material/mat-retro-02.png",
        "description": "用了二十多年的竹编茶篮，提手已经磨得发亮。",
        "audioUrlMandarin": "https://cdn.example.com/xiangyu-xinxu/audio/mat-retro-02-mandarin.mp3",
        "audioUrlHakka": "https://cdn.example.com/xiangyu-xinxu/audio/mat-retro-02-hakka.mp3",
    },
    {
        "id": "mat-retro-03",
        "templateId": "tpl-retro",
        "name": "旧式花灯",
        "imageUrl": "https://cdn.example.com/xiangyu-xinxu/material/mat-retro-03.png",
        "description": "糊着棉纸的旧式花灯，灯骨是老师傅一根根削出来的。",
        "audioUrlMandarin": "https://cdn.example.com/xiangyu-xinxu/audio/mat-retro-03-mandarin.mp3",
        "audioUrlHakka": "https://cdn.example.com/xiangyu-xinxu/audio/mat-retro-03-hakka.mp3",
    },
    {
        "id": "mat-retro-04",
        "templateId": "tpl-retro",
        "name": "绣花鞋",
        "imageUrl": "https://cdn.example.com/xiangyu-xinxu/material/mat-retro-04.png",
        "description": "一双褪了色的绣花鞋，鞋面上的牡丹还能看出针脚。",
        "audioUrlMandarin": "https://cdn.example.com/xiangyu-xinxu/audio/mat-retro-04-mandarin.mp3",
        "audioUrlHakka": "https://cdn.example.com/xiangyu-xinxu/audio/mat-retro-04-hakka.mp3",
    },
]

# ==================== 3.7 手绘地图点位 ====================
# mapX / mapY 是设计稿 750 x 1334 上的绝对像素，latitude / longitude 是 GCJ-02 真实坐标。

SPOTS: list[dict] = [
    {
        "spotId": "spot-01",
        "name": "客家围屋",
        "mapX": 168,
        "mapY": 420,
        "description": "三进两横的方形围屋，门楼朝南，屋前有一口半月形水塘。",
        "imageUrl": "https://cdn.example.com/xiangyu-xinxu/spot/spot-01.png",
        "latitude": 24.2886,
        "longitude": 116.1225,
    },
    {
        "spotId": "spot-02",
        "name": "圆形土楼",
        "mapX": 486,
        "mapY": 268,
        "description": "一圈四层的环形土楼，中间天井里还留着那口老石臼。",
        "imageUrl": "https://cdn.example.com/xiangyu-xinxu/spot/spot-02.png",
        "latitude": 24.6512,
        "longitude": 116.9821,
    },
    {
        "spotId": "spot-03",
        "name": "擂茶老铺",
        "mapX": 302,
        "mapY": 742,
        "description": "临街的一间老铺，门口摆着陶钵和茶棍，进门先上一碗擂茶。",
        "imageUrl": "https://cdn.example.com/xiangyu-xinxu/spot/spot-03.png",
        "latitude": 24.3014,
        "longitude": 116.1308,
    },
    {
        "spotId": "spot-04",
        "name": "花灯工坊",
        "mapX": 596,
        "mapY": 918,
        "description": "作坊里长年堆着竹篾和棉纸，正月前最热闹。",
        "imageUrl": "https://cdn.example.com/xiangyu-xinxu/spot/spot-04.png",
        "latitude": 24.2765,
        "longitude": 116.1052,
    },
    {
        "spotId": "spot-05",
        "name": "古渡口",
        "mapX": 214,
        "mapY": 1068,
        "description": "旧时水上货运的起点，石阶被船工踩出了深槽。",
        "imageUrl": "https://cdn.example.com/xiangyu-xinxu/spot/spot-05.png",
        "latitude": 24.2601,
        "longitude": 116.0918,
    },
]

# ==================== 3.5 NFC 标签 ====================

NFC_TAGS: list[dict] = [
    {
        "tagId": "NFC-TAG-0001",
        "title": "围屋门楼",
        "storyText": (
            "这座围屋建于清光绪年间，门楼上的青砖是从河滩一块块挑回来的。"
            "门楣内侧还留着一行小字，记的是当年修屋时各家各户出的工。"
            "逢年过节，族人在门楼前摆开八仙桌，一坐就是十几桌。"
        ),
        "historyImageUrls": [
            "https://cdn.example.com/xiangyu-xinxu/nfc/NFC-TAG-0001-history-01.jpg",
            "https://cdn.example.com/xiangyu-xinxu/nfc/NFC-TAG-0001-history-02.jpg",
        ],
        "spotId": "spot-01",
        "goodsId": "goods-01",
        "audioUrlMandarin": "https://cdn.example.com/xiangyu-xinxu/audio/NFC-TAG-0001-mandarin.mp3",
        "audioUrlHakka": "https://cdn.example.com/xiangyu-xinxu/audio/NFC-TAG-0001-hakka.mp3",
    },
    {
        "tagId": "NFC-TAG-0002",
        "title": "土楼天井",
        "storyText": (
            "圆形土楼中间的天井是整个家族的公共客厅。井边那口石臼用了一百多年，"
            "逢年过节打糍粑，几户人家轮流用，谁家先打好都会先给邻居送一碗。"
        ),
        "historyImageUrls": [
            "https://cdn.example.com/xiangyu-xinxu/nfc/NFC-TAG-0002-history-01.jpg",
        ],
        "spotId": "spot-02",
        "goodsId": "goods-04",
        "audioUrlMandarin": "https://cdn.example.com/xiangyu-xinxu/audio/NFC-TAG-0002-mandarin.mp3",
        "audioUrlHakka": "https://cdn.example.com/xiangyu-xinxu/audio/NFC-TAG-0002-hakka.mp3",
    },
    {
        "tagId": "NFC-TAG-0003",
        "title": "擂茶老铺",
        "storyText": (
            "擂茶要把茶叶、花生、芝麻放进陶钵里，用茶棍一圈一圈擂碎。"
            "老铺的茶棍传了三代人，木头中间已经被磨出一个凹槽。客人进门先上一碗，喝完再谈事。"
        ),
        "historyImageUrls": [
            "https://cdn.example.com/xiangyu-xinxu/nfc/NFC-TAG-0003-history-01.jpg",
            "https://cdn.example.com/xiangyu-xinxu/nfc/NFC-TAG-0003-history-02.jpg",
        ],
        "spotId": "spot-03",
        "goodsId": "goods-03",
        "audioUrlMandarin": "https://cdn.example.com/xiangyu-xinxu/audio/NFC-TAG-0003-mandarin.mp3",
        "audioUrlHakka": "https://cdn.example.com/xiangyu-xinxu/audio/NFC-TAG-0003-hakka.mp3",
    },
    {
        "tagId": "NFC-TAG-0004",
        "title": "花灯作坊",
        "storyText": (
            "作坊里的花灯全靠手工，一盏灯要用掉七十多根竹篾。"
            "糊灯面的棉纸刷过桐油，透光却不透风，正月里挂出去能亮一整月。"
        ),
        "historyImageUrls": [
            "https://cdn.example.com/xiangyu-xinxu/nfc/NFC-TAG-0004-history-01.jpg",
        ],
        "spotId": "spot-04",
        "goodsId": "goods-05",
        "audioUrlMandarin": "https://cdn.example.com/xiangyu-xinxu/audio/NFC-TAG-0004-mandarin.mp3",
        "audioUrlHakka": "https://cdn.example.com/xiangyu-xinxu/audio/NFC-TAG-0004-hakka.mp3",
    },
]

# ==================== 3.9 / 3.10 文创商品 ====================
# stock 是扩展字段（文档 5.4 允许新增），默认给足。
#
# 【图片素材编号】server/media/goods/ 下的文件按「商品序号-图序号」命名：
#   {n}-1 封面，{n}-2、{n}-3 详情长图（按数组顺序纵向渲染）
# 商品序号（N）就是列表展示顺序，用 sortOrder 控制；goodsId 是历史 ID 不跟着改，
# 因为 NFC 标签、订单快照都在引用它：
#   1 -> goods-01 客家围屋冰箱贴
#   2 -> goods-03 擂茶礼盒
#   3 -> goods-02 童趣拼贴明信片套装
#   4 -> goods-04 土楼手绘帆布袋
#   5 -> goods-05 客家花灯书签

_GOODS_IMAGE_BASE = "https://cdn.example.com/xiangyu-xinxu/goods"


def _goods_cover(index: int) -> str:
    """第 index 个商品的封面：media/goods/{index}-1.png"""
    return f"{_GOODS_IMAGE_BASE}/{index}-1.png"


def _goods_details(index: int, count: int = 2) -> list[str]:
    """第 index 个商品的详情图：{index}-2.png、{index}-3.png …；图片多了就调大 count。"""
    return [f"{_GOODS_IMAGE_BASE}/{index}-{n}.png" for n in range(2, count + 2)]


GOODS: list[dict] = [
    {
        "goodsId": "goods-01",
        "name": "客家围屋冰箱贴",
        "price": 39,
        "coverUrl": _goods_cover(1),
        "summary": "手工上色的围屋门楼，贴在冰箱上就是一小片故乡。",
        "detailText": (
            "以围屋门楼为原型，树脂材质手工上色，边缘做了旧砖的肌理。"
            "背面是整块软磁，吸力足够。每只都有细微色差，属于手工痕迹。"
        ),
        "detailImageUrls": _goods_details(1),
        "spotId": "spot-01",
        "stock": 100,
        "sortOrder": 1,
    },
    {
        "goodsId": "goods-02",
        "name": "童趣拼贴明信片套装",
        "price": 29,
        "coverUrl": _goods_cover(3),
        "summary": "一套十二张，把拼贴里的小围屋和小花灯寄给朋友。",
        "detailText": (
            "十二张一套，正面是童趣拼贴模板里的素材插画，背面留了足够写字的空白。"
            "纸张 300g，可以直接寄，也可以裱起来。"
        ),
        "detailImageUrls": _goods_details(3),
        "spotId": "spot-05",
        "stock": 100,
        "sortOrder": 3,
    },
    {
        "goodsId": "goods-03",
        "name": "擂茶礼盒",
        "price": 128,
        "coverUrl": _goods_cover(2),
        "summary": "茶叶、花生、芝麻分装备好，配一支竹制茶棍。",
        "detailText": (
            "按老铺的配比分装，茶叶、花生、芝麻各一袋，附竹制茶棍一支和陶钵一只。"
            "开水冲调后按同一方向擂匀，风味最接近现擂的。"
        ),
        "detailImageUrls": _goods_details(2),
        "spotId": "spot-03",
        "stock": 100,
        "sortOrder": 2,
    },
    {
        "goodsId": "goods-04",
        "name": "土楼手绘帆布袋",
        "price": 69,
        "coverUrl": _goods_cover(4),
        "summary": "手绘土楼印在厚帆布上，装得下 A4 和一台相机。",
        "detailText": (
            "16 安加厚帆布，手绘土楼图案丝网印刷，洗过几次也不易掉色。"
            "内里加了一个小口袋，能放钥匙和手机。"
        ),
        "detailImageUrls": _goods_details(4),
        "spotId": "spot-02",
        "stock": 100,
        "sortOrder": 4,
    },
    {
        "goodsId": "goods-05",
        "name": "客家花灯书签",
        "price": 19,
        "coverUrl": _goods_cover(5),
        "summary": "黄铜镂空花灯，夹在书里会透出一小块光。",
        "detailText": (
            "黄铜薄片蚀刻镂空，做成花灯灯面的纹样。单片厚 0.4mm，"
            "夹在书里不会顶出折痕，用久了会有自然的氧化色。"
        ),
        "detailImageUrls": _goods_details(5),
        "spotId": "spot-04",
        "stock": 100,
        "sortOrder": 5,
    },
]

# ==================== 3.11 演示订单（归属演示用户） ====================

DEMO_ORDERS: list[dict] = [
    {
        "orderId": "ORD-20250315-0001",
        "goodsId": "goods-01",
        "goodsName": "客家围屋冰箱贴",
        "coverUrl": _goods_cover(1),
        "price": 39,
        "quantity": 2,
        "totalAmount": 78,
        "status": "paid",
        "createdAt": "2025-03-15 10:24:00",
        "paidAt": "2025-03-15 10:26:00",
        "receiver": "围山访客",
        "receiverPhone": "13800138000",
        "addressText": "江西省赣州市龙南县围屋村 1 号",
        "payMode": "mock",
    },
    {
        "orderId": "ORD-20250302-0002",
        "goodsId": "goods-03",
        "goodsName": "擂茶礼盒",
        "coverUrl": _goods_cover(2),
        "price": 128,
        "quantity": 1,
        "totalAmount": 128,
        "status": "shipped",
        "createdAt": "2025-03-02 16:40:00",
        "paidAt": "2025-03-02 16:42:00",
        "receiver": "围山访客",
        "receiverPhone": "13800138000",
        "addressText": "江西省赣州市龙南县围屋村 1 号",
        "payMode": "mock",
    },
    {
        "orderId": "ORD-20250220-0003",
        "goodsId": "goods-05",
        "goodsName": "客家花灯书签",
        "coverUrl": _goods_cover(5),
        "price": 19,
        "quantity": 3,
        "totalAmount": 57,
        "status": "finished",
        "createdAt": "2025-02-20 09:05:00",
        "paidAt": "2025-02-20 09:06:00",
        "receiver": "围山访客",
        "receiverPhone": "13800138000",
        "addressText": "江西省赣州市龙南县围屋村 1 号",
        "payMode": "mock",
    },
]
