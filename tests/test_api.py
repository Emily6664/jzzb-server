"""接口契约冒烟测试。

重点验证「返回字段与 API_DOC.md 一致」，而不是内部实现细节。
运行：cd server && uv run pytest
"""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient


def _data(response: Any) -> Any:
    payload = response.json()
    assert response.status_code == 200, payload
    assert payload["code"] == 0, payload
    return payload["data"]


def _error(response: Any) -> dict:
    payload = response.json()
    assert response.status_code == 200, payload
    assert payload["code"] != 0, payload
    return payload


# ==================== 基础 ====================


def test_root_and_health(client: TestClient):
    # 根路径返回只写着 OK 的 HTML，给浏览器 / 监控做存活探测
    root = client.get("/")
    assert root.status_code == 200
    assert root.headers["content-type"].startswith("text/html")
    assert "<body>OK</body>" in root.text

    assert _data(client.get("/healthz"))["status"] == "ok"
    assert _data(client.get("/api/health"))["status"] == "ok"
    assert client.get("/openapi.json").status_code == 200


def test_unknown_route_returns_404_envelope(client: TestClient):
    response = client.get("/api/not-exist")
    assert response.status_code == 404
    assert response.json()["code"] == 40400


def test_api_prefix_is_optional(client: TestClient, api: str):
    """反向代理剥掉 /api 前缀时也要能命中。"""
    assert len(_data(client.get(f"{api}/goods/list"))) == len(
        _data(client.get("/goods/list"))
    )


# ==================== 拼贴 ====================


def test_templates(client: TestClient, api: str):
    data = _data(client.get(f"{api}/collage/templates"))
    assert len(data) == 2
    assert set(data[0]) == {
        "templateId",
        "name",
        "theme",
        "description",
        "coverUrl",
        "canvasWidth",
        "canvasHeight",
    }
    assert data[0]["templateId"] == "tpl-childlike"
    assert data[0]["canvasWidth"] == 750


def test_materials_filter(client: TestClient, api: str):
    all_items = _data(client.get(f"{api}/collage/materials"))
    assert len(all_items) == 8
    assert set(all_items[0]) == {
        "id",
        "templateId",
        "name",
        "imageUrl",
        "description",
        "audioUrlMandarin",
        "audioUrlHakka",
    }

    retro = _data(client.get(f"{api}/collage/materials", params={"templateId": "tpl-retro"}))
    assert len(retro) == 4
    assert {item["templateId"] for item in retro} == {"tpl-retro"}


def test_collage_compose_and_save(client: TestClient, api: str):
    composed = _data(
        client.post(
            f"{api}/collage/compose",
            json={
                "templateId": "tpl-childlike",
                "materials": [
                    {"id": "mat-childlike-01", "x": 120, "y": 200, "scale": 1, "rotate": 0},
                    {"id": "mat-childlike-02", "x": 300, "y": 420},
                ],
            },
        )
    )
    assert composed["width"] == 750
    assert composed["height"] == 1000
    assert composed["imageUrl"].endswith(".png")

    saved = _data(
        client.post(
            f"{api}/collage/works",
            json={
                "workId": composed["workId"],
                "imageUrl": composed["imageUrl"],
                "title": "测试作品",
            },
        )
    )
    assert saved["success"] is True
    assert saved["workId"] == composed["workId"]

    works = _data(client.get(f"{api}/collage/works"))
    assert any(
        item["workId"] == composed["workId"] and item["title"] == "测试作品" for item in works
    )

    deleted = _data(client.delete(f"{api}/collage/works/{composed['workId']}"))
    assert deleted["deleted"] is True


def test_collage_compose_rejects_unknown_material(client: TestClient, api: str):
    result = _error(
        client.post(
            f"{api}/collage/compose",
            json={"templateId": "tpl-retro", "materials": [{"id": "mat-childlike-01", "x": 1, "y": 1}]},
        )
    )
    assert result["code"] == 40001


# ==================== NFC ====================


def test_nfc_trace(client: TestClient, api: str):
    data = _data(client.get(f"{api}/nfc/trace", params={"tagId": "NFC-TAG-0001"}))
    assert set(data) == {
        "tagId",
        "title",
        "storyText",
        "historyImageUrls",
        "spotId",
        "goodsId",
        "audioUrlMandarin",
        "audioUrlHakka",
    }
    assert data["tagId"] == "NFC-TAG-0001"
    assert data["spotId"] == "spot-01"
    assert data["goodsId"] == "goods-01"
    assert len(data["historyImageUrls"]) == 2


def test_nfc_trace_unknown_tag(client: TestClient, api: str):
    """未登记的标签默认返回 code 0 + data null，页面走空态（对应 NOT_FOUND_AS_NULL）。"""
    payload = client.get(f"{api}/nfc/trace", params={"tagId": "NFC-TAG-9999"}).json()
    assert payload["code"] == 0
    assert payload["data"] is None


def test_nfc_scan_log(client: TestClient, api: str):
    data = _data(
        client.post(
            f"{api}/nfc/scan-log",
            json={
                "tagId": "NFC-TAG-0001",
                "scannedAt": "2025-03-18 10:24:00",
                "latitude": 24.2886,
                "longitude": 116.1225,
            },
        )
    )
    assert data["success"] is True
    assert data["tagId"] == "NFC-TAG-0001"
    assert len(data["reportedAt"]) == 19


# ==================== 地图 ====================


def test_map_spots(client: TestClient, api: str):
    spots = _data(client.get(f"{api}/map/spots"))
    assert len(spots) == 5
    assert set(spots[0]) == {
        "spotId",
        "name",
        "mapX",
        "mapY",
        "description",
        "imageUrl",
        "latitude",
        "longitude",
    }
    assert spots[0]["spotId"] == "spot-01"
    assert spots[0]["mapX"] == 168
    assert spots[0]["longitude"] == 116.1225


def test_map_spots_filter_and_detail(client: TestClient, api: str):
    filtered = _data(client.get(f"{api}/map/spots", params={"spotIds": "spot-01,spot-03"}))
    assert [item["spotId"] for item in filtered] == ["spot-01", "spot-03"]

    detail = _data(client.get(f"{api}/map/spots/spot-03"))
    assert detail["name"] == "擂茶老铺"

    missing = client.get(f"{api}/map/spots/spot-99").json()
    assert missing["code"] == 0
    assert missing["data"] is None


# ==================== 商品与订单 ====================


def test_goods_list_and_detail(client: TestClient, api: str):
    items = _data(client.get(f"{api}/goods/list"))
    assert len(items) == 5
    assert set(items[0]) == {"goodsId", "name", "price", "coverUrl", "summary", "spotId"}

    detail = _data(client.get(f"{api}/goods/detail", params={"goodsId": "goods-03"}))
    assert detail["price"] == 128
    assert detail["detailText"]
    assert len(detail["detailImageUrls"]) == 2
    assert "stock" in detail

    subset = _data(client.get(f"{api}/goods/list", params={"spotId": "spot-03"}))
    assert [item["goodsId"] for item in subset] == ["goods-03"]

    missing = client.get(f"{api}/goods/detail", params={"goodsId": "goods-404"}).json()
    assert missing["code"] == 0
    assert missing["data"] is None


def test_seeded_orders(client: TestClient, api: str):
    orders = _data(client.get(f"{api}/goods/orders"))
    ids = {item["orderId"] for item in orders}
    assert {"ORD-20250315-0001", "ORD-20250302-0002", "ORD-20250220-0003"} <= ids

    paid = _data(client.get(f"{api}/goods/orders", params={"status": "paid"}))
    assert paid and all(item["status"] == "paid" for item in paid)


def test_create_pay_cancel_order(client: TestClient, api: str):
    address = {
        "name": "张三",
        "phone": "13800138000",
        "region": ["江西省", "赣州市", "龙南县"],
        "detail": "围屋村 1 号",
    }

    # ---------- 下单 ----------
    created = _data(
        client.post(
            f"{api}/goods/orders",
            json={
                "goodsId": "goods-01",
                "count": 2,
                "addressId": "addr-local-1",
                "address": address,
                "workImage": "",
            },
        )
    )
    assert created["status"] == "unpaid"
    assert created["totalAmount"] == 78  # 金额由后端按 goodsId 计算
    assert created["payParams"] is None  # 未开启支付
    order_id = created["orderId"]
    assert order_id.startswith("ORD-")

    listed = {item["orderId"]: item for item in _data(client.get(f"{api}/goods/orders"))}
    assert order_id in listed
    assert listed[order_id]["totalAmount"] == 78
    assert listed[order_id]["count"] == 2
    assert listed[order_id]["receiver"] == "张三"

    # ---------- 支付（未开真支付 → 模拟支付，直接置为已付款） ----------
    paid = _data(client.post(f"{api}/goods/orders/{order_id}/pay"))
    assert paid["status"] == "paid"
    assert paid["payParams"] is None

    # ---------- 另下一单再取消 ----------
    second = _data(
        client.post(
            f"{api}/goods/orders",
            json={"goodsId": "goods-03", "count": 1, "address": address},
        )
    )
    assert second["totalAmount"] == 128

    cancelled = _data(client.post(f"{api}/goods/orders/{second['orderId']}/cancel"))
    assert cancelled["status"] == "canceled"

    # 已取消的订单不能再支付
    assert _error(client.post(f"{api}/goods/orders/{second['orderId']}/pay"))["code"] == 40001

    after = {item["orderId"]: item for item in _data(client.get(f"{api}/goods/orders"))}
    assert after[order_id]["status"] == "paid"
    assert after[second["orderId"]]["status"] == "canceled"


def test_pay_already_paid_order(client: TestClient, api: str):
    data = _data(client.post(f"{api}/goods/orders/ORD-20250315-0001/pay"))
    assert data["status"] == "paid"
    assert data["payParams"] is None


def test_order_validation(client: TestClient, api: str):
    missing_goods = _error(client.post(f"{api}/goods/orders", json={}))
    assert missing_goods["code"] == 40001

    unknown_goods = _error(
        client.post(
            f"{api}/goods/orders",
            json={
                "goodsId": "goods-404",
                "count": 1,
                "address": {
                    "name": "张三",
                    "phone": "13800138000",
                    "region": ["江西省"],
                    "detail": "围屋村 1 号",
                },
            },
        )
    )
    assert unknown_goods["code"] == 40400

    bad_count = _error(
        client.post(
            f"{api}/goods/orders",
            json={
                "goodsId": "goods-01",
                "count": 0,
                "address": {
                    "name": "张三",
                    "phone": "13800138000",
                    "region": ["江西省"],
                    "detail": "围屋村 1 号",
                },
            },
        )
    )
    assert bad_count["code"] == 40001

    bad_status = _error(client.get(f"{api}/goods/orders", params={"status": "unknown"}))
    assert bad_status["code"] == 40001


# ==================== 用户 ====================


def test_login_and_profile(client: TestClient, api: str, token: str):
    assert token

    profile = _data(
        client.get(f"{api}/user/profile", headers={"Authorization": f"Bearer {token}"})
    )
    assert profile["userId"] == "user-0001"
    assert profile["phone"] == "13800138000"
    assert isinstance(profile["addressCount"], int)


def test_login_requires_code(client: TestClient, api: str):
    result = _error(client.post(f"{api}/user/login", json={}))
    assert result["code"] == 40001
