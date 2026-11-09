#  小程序接口文档

> 适用范围：`weapp-xiangyu-xinxu` 微信原生小程序 ↔ 后端 API 对接
> 前端封装位置：`api/` 目录；mock 数据位置：`mock/` 目录；请求底座：`utils/api.js`
> 本文档与代码严格对应，代码改动后请同步更新本文档。


---

## 1. 基础约定

### 1.1 统一返回格式 `{ code, msg, data }`

后端所有接口**必须**返回统一的信封结构：

```json
{
  "code": 0,
  "msg": "ok",
  "data": {}
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `code` | number | 是 | 业务状态码，`0` 表示成功，非 `0` 表示失败 |
| `msg` | string | 是 | 提示文案，成功时固定 `"ok"`，失败时是可直接展示给用户的中文说明 |
| `data` | any | 是 | 业务数据。成功时是对象 / 数组；失败时传 `null` |

**状态码约定**

| code | 含义 | 前端处理建议 |
| --- | --- | --- |
| `0` | 成功 | 正常取 `data` |
| `40001` | 请求参数缺失或非法 | toast 提示 `msg` |
| `40100` | 未登录 / 登录态失效 | 静默重新登录后重试一次 |
| `40300` | 无权限访问该资源 | toast 提示 `msg` |
| `40400` | 资源不存在（如 tagId 查不到） | 展示空态，不弹错误 |
| `50000` | 服务端异常 | toast 提示「服务异常，请稍后再试」 |

**HTTP 状态码**：链路层错误（超时、域名不通、5xx）由前端统一按失败处理，不依赖 `code`。

#### 现状与联调待办（重要）

- **mock 分支**：`USE_MOCK = true` 时，`request()` 直接返回 `mock/` 里的业务数据对象，它等价于信封里的 `data` 本体。
- **真实分支**：`USE_MOCK = false` 时，`utils/api.js` 的 `networkRequest()` 目前把后端响应体原样 `resolve` 出来，**尚未剥离信封**。因此联调前需要在该函数的 `success` 回调里补上解包（仅此一处，mock 与 `api/` 层都不用动）：

```js
success: function (res) {
  const statusCode = res && res.statusCode;
  if (statusCode < 200 || statusCode >= 300) {
    reject(new Error('请求失败，HTTP 状态码 ' + statusCode));
    return;
  }

  const body = res.data || {};
  if (body.code === 0) {
    resolve(body.data);              // 只把 data 往上抛，api 层拿到的结构与 mock 完全一致
  } else {
    reject(new Error(body.msg || '业务处理失败'));
  }
}
```

按当前阶段的约定（不修改 `utils/api.js`），这段解包**留到联调时再补**；在此之前，`api/` 层与 mock 返回的是同一种结构（业务数据本体），页面代码不受影响。

### 1.2 USE_MOCK 开关

开关只有**一处**，在 `utils/api.js` 顶部：

```js
const USE_MOCK = true;                              // 总开关
const BASE_URL = 'https://example.com/api';         // 后端地址占位
const TIMEOUT = 10000;                              // 超时 10s
const MOCK_DELAY = 0;                               // mock 模拟延迟，0 表示立即返回
```

| 开关值 | 行为 |
| --- | --- |
| `true` | `request()` **不发起任何网络请求**，直接把调用方传入的 `mock` 值（或 `mock(data)` 的返回值）resolve 出来 |
| `false` | `request()` 用 `wx.request` 请求 `BASE_URL + url`，`url` 若本身就是完整 `http(s)` 地址则直接使用 |

**`api/` 层的写法约定**：每个接口函数只调用 `request()`，并把 mock 一并传入，例如：

```js
function getList(params) {
  return request({
    url: '/goods/list',
    method: 'GET',
    data: params,
    mock: function (query) {
      return query && query.spotId
        ? mockGoods.list.filter((item) => item.spotId === query.spotId)
        : mockGoods.list;
    }
  });
}
```

开关切换时 `api/` 层与页面层**零改动**。

**联调切换 checklist**

1. `utils/api.js` → `USE_MOCK = false`
2. `utils/api.js` → `BASE_URL` 改成真实网关地址（含协议，不带结尾 `/`）
3. 小程序管理后台 → 开发设置 → 服务器域名：把网关域名加进 **request 合法域名**
4. 图片 / 音频走 CDN 时，把 CDN 域名加进 **downloadFile 合法域名**（否则真机不加载、音频不播放）
5. 按 1.1 补上信封解包
6. 逐页回归：`api/` 返回结构与 mock 结构必须完全一致（字段名、类型、层级）

### 1.3 请求约定

| 项 | 约定 |
| --- | --- |
| 请求方法 | 查询用 `GET`，提交用 `POST` |
| Content-Type | `application/json`（`utils/api.js` 已默认带上） |
| 超时 | 10s（`TIMEOUT`） |
| 鉴权 | 预留 `Authorization: Bearer <token>`；token 存 `utils/storage.js`，`utils/api.js` 统一注入 |
| 分页 | 预留 `page` / `pageSize`（当前 Demo 数据量小，接口暂未实现分页） |

### 1.4 字段命名与数据格式总则

- **命名**：全部小写 camelCase，主键统一 `xxxId` 形式（`tagId` / `spotId` / `goodsId` / `orderId` / `templateId`）。
- **金额**：`price` / `totalAmount` 均为 `number`，单位 **元**，保留两位小数以内；不使用「分」。
- **时间**：统一字符串 `YYYY-MM-DD HH:mm:ss`（本地时间，不带时区后缀）。
- **图片 / 音频**：统一 `https://` 绝对地址，**不下发相对路径**。
  - 单图字段名：`coverUrl` / `imageUrl`
  - 多图字段名：`xxxImageUrls`（数组）
  - 音频字段名：`audioUrlMandarin`（普通话）/ `audioUrlHakka`（客家方言）
- **空值**：字段必须存在；无值用 `null`（对象）、`[]`（数组）、`0`（数字），**不要省略 key**，前端按固定字段名取值。
- **语言**：所有面向用户的文案（`name` / `description` / `storyText` / `msg`）直接下发中文成品，前端不做拼接。

### 1.5 支付与登录的前置条件（必读）

这三项能力**不是前端能单独搞定的**，缺一项就跑不通，请提前对齐：

| 能力 | 必须满足的条件 | 不满足会怎样 |
| --- | --- | --- |
| **微信支付** | ① 企业主体（含个体工商户）小程序；② 微信支付商户号 `mchid`；③ 商户 API 密钥 / 证书；④ 后端按微信 v3 规范统一下单并签名；⑤ 小程序后台配置支付相关域名 | **个人主体小程序无法使用**，`wx.requestPayment` 直接报错 |
| **微信手机号** | ① 已认证主体（个人主体拿不到）；② 后台「用户隐私保护指引」声明手机号用途；③ 后端用 `phoneCode` 调 `phonenumber.getPhoneNumber` 换取 | 拿不到手机号，登录失败 |
| **收货地址** | 纯前端功能，地址存本地 storage，**不走后端接口**；用微信地址导入时才需要用户授权 `scope.address` | 用户手动填写即可，不阻塞下单 |

**前端侧的开关**（`utils/api.js`）：

```js
const USE_MOCK = true;      // mock 数据开关
const PAY_ENABLE = false;   // 微信支付开关
```

- `PAY_ENABLE = false`（**当前默认**）→ 前端走「模拟支付」：`createOrder` 后直接判定支付成功，不调 `wx.requestPayment`。
- `PAY_ENABLE = true` **且** `USE_MOCK = false` → 才会真正调起微信支付。
- 两个条件是「与」关系：只要还在 mock 阶段，就算把 `PAY_ENABLE` 设成 `true` 也不会真扣款，避免联调前误触发。

> 后端同学请注意：`createOrder` 的返回里有 `payParams`。**未开启支付时返回 `payParams: null`**，前端会自动降级为模拟支付；开启支付时按第 3.13 节的字段下发即可。

---

## 2. 接口总览

| # | 接口名称 | 方法 | 路径 | 前端封装 | Demo 是否已调用 |
| --- | --- | --- | --- | --- | --- |
| 1 | 拼贴模板列表 | GET | `/collage/templates` | `api/collage.js` → `getTemplates()` | ✅ 拼贴页已调用 |
| 2 | 拼贴素材列表 | GET | `/collage/materials` | `api/collage.js` → `getMaterials(params)` | ✅ 拼贴页已调用 |
| 3 | 提交拼贴合成 | POST | `/collage/compose` | `api/collage.js` → `compose(payload)` | ⬜ 预留（Demo 用本地 Canvas 出图） |
| 4 | 保存拼贴作品 | POST | `/collage/works` | `api/collage.js` → `saveWork(payload)` | ⬜ 预留（Demo 先存本地 storage） |
| 5 | NFC 溯源详情 | GET | `/nfc/trace` | `api/nfc.js` → `getTraceByTag(tagId)` | ✅ NFC 页已调用 |
| 6 | NFC 扫码上报 | POST | `/nfc/scan-log` | `api/nfc.js` → `reportScan(payload)` | ✅ NFC 页已调用（静默上报） |
| 7 | 手绘地图点位列表 | GET | `/map/spots` | `api/map.js` → `getSpots(params)` | ✅ 地图页已调用 |
| 8 | 手绘地图点位详情 | GET | `/map/spots/{spotId}` | `api/map.js` → `getSpotDetail(spotId)` | ⬜ 预留（列表已含全部字段，够用） |
| 9 | 文创商品列表 | GET | `/goods/list` | `api/goods.js` → `getList(params)` | ✅ 商品列表页已调用 |
| 10 | 文创商品详情 | GET | `/goods/detail` | `api/goods.js` → `getDetail(goodsId)` | ✅ 商品详情页已调用 |
| 11 | 我的订单列表 | GET | `/goods/orders` | `api/goods.js` → `getOrders(params)` | ✅ 我的订单页已调用 |
| 12 | 创建订单 | POST | `/goods/orders` | `api/goods.js` → `createOrder(payload)` | ✅ 商品详情页已调用 |
| 13 | 获取支付参数 | POST | `/goods/orders/{orderId}/pay` | `api/goods.js` → `payOrder(orderId)` | ✅ 我的订单页已调用 |
| 14 | 微信手机号登录 | POST | `/user/login` | `api/user.js` → `login(payload)` | ✅ 我的页已调用 |
| 15 | 用户资料 | GET | `/user/profile` | `api/user.js` → `getProfile()` | ⬜ 预留（登录返回已够用） |

> **给后端同学的提示**：标 ⬜ 的 4 个接口在 `api/` 里已经写好、签名和结构都定了，只是 Demo 阶段页面还没调用它们。
> 可以按文档实现，但**排期优先级低于 ✅ 的 11 个**；也可以先只做 ✅ 的接口，项目照样能跑。


请求地址 = `BASE_URL` + 上表路径，例如 `https://example.com/api/goods/list`。

---

## 3. 接口详情

### 3.1 拼贴模板列表

- **接口名称**：获取拼贴模板列表
- **请求**：`GET /collage/templates`
- **前端封装**：`collageApi.getTemplates()`
- **请求参数**：无
- **用途**：拼贴页顶部的模板切换（童趣 / 复古）

**返回示例**

```json
{
  "code": 0,
  "msg": "ok",
  "data": [
    {
      "templateId": "tpl-childlike",
      "name": "童趣拼贴",
      "theme": "childlike",
      "description": "圆润线条配明亮配色，小朋友也能一眼认出的围屋、土楼和花灯。",
      "coverUrl": "https://cdn.example.com/xiangyu-xinxu/template/tpl-childlike-cover.png",
      "canvasWidth": 750,
      "canvasHeight": 1000
    },
    {
      "templateId": "tpl-retro",
      "name": "复古拼贴",
      "theme": "retro",
      "description": "做旧纸感与低饱和色调，把老照片里的客家日常重新拼起来。",
      "coverUrl": "https://cdn.example.com/xiangyu-xinxu/template/tpl-retro-cover.png",
      "canvasWidth": 750,
      "canvasHeight": 1000
    }
  ]
}
```

**字段说明**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `templateId` | string | 模板 ID，全局唯一 |
| `name` | string | 模板名称 |
| `theme` | string | 主题枚举：`childlike` 童趣 / `retro` 复古 |
| `description` | string | 模板简介 |
| `coverUrl` | string | 模板封面图地址 |
| `canvasWidth` | number | 画布宽（设计稿像素） |
| `canvasHeight` | number | 画布高（设计稿像素） |

---

### 3.2 拼贴素材列表

- **接口名称**：获取拼贴素材列表
- **请求**：`GET /collage/materials`
- **前端封装**：`collageApi.getMaterials(params)`
- **用途**：拼贴页素材面板；素材可拖入画布

**请求参数**

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `templateId` | string | 否 | 按模板筛选；不传返回全部素材 |

**返回示例**

```json
{
  "code": 0,
  "msg": "ok",
  "data": [
    {
      "id": "mat-childlike-01",
      "templateId": "tpl-childlike",
      "name": "卡通围屋",
      "imageUrl": "https://cdn.example.com/xiangyu-xinxu/material/mat-childlike-01.png",
      "description": "圆角造型的客家围屋，屋前还趴着一只打盹的黄狗。",
      "audioUrlMandarin": "https://cdn.example.com/xiangyu-xinxu/audio/mat-childlike-01-mandarin.mp3",
      "audioUrlHakka": "https://cdn.example.com/xiangyu-xinxu/audio/mat-childlike-01-hakka.mp3"
    }
  ]
}
```

**字段说明**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 素材 ID（注意：素材主键是 `id`，不是 `materialId`） |
| `templateId` | string | 所属模板 ID |
| `name` | string | 素材名称 |
| `imageUrl` | string | 素材图片地址（透明底 PNG 优先） |
| `description` | string | 素材简介 |
| `audioUrlMandarin` | string | 普通话讲解音频地址 |
| `audioUrlHakka` | string | 客家方言讲解音频地址 |

> 音频播放统一走 `utils/audio.js` 的 `play(src, options)`，已内置异常捕获。

---

### 3.3 提交拼贴合成

- **接口名称**：提交拼贴合成
- **请求**：`POST /collage/compose`
- **前端封装**：`collageApi.compose(payload)`
- **用途**：把用户排好的画布提交给后端合成一张成图

**请求参数**

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `templateId` | string | 是 | 使用的模板 ID |
| `materials` | array | 是 | 已放置的素材，见下表 |
| `materials[].id` | string | 是 | 素材 ID |
| `materials[].x` | number | 是 | 相对画布左上角的 X（设计稿像素） |
| `materials[].y` | number | 是 | 相对画布左上角的 Y（设计稿像素） |
| `materials[].scale` | number | 否 | 缩放比例，默认 `1` |
| `materials[].rotate` | number | 否 | 旋转角度（度），默认 `0` |

**返回示例**

```json
{
  "code": 0,
  "msg": "ok",
  "data": {
    "workId": "work-demo-0001",
    "imageUrl": "https://cdn.example.com/xiangyu-xinxu/work/work-demo-0001.png",
    "width": 750,
    "height": 1000
  }
}
```

**字段说明**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `workId` | string | 作品 ID，保存作品时需要回传 |
| `imageUrl` | string | 合成后的成图地址 |
| `width` | number | 成图宽（像素） |
| `height` | number | 成图高（像素） |

---

### 3.4 保存拼贴作品

- **接口名称**：保存拼贴作品
- **请求**：`POST /collage/works`
- **前端封装**：`collageApi.saveWork(payload)`
- **用途**：把合成结果保存到「我的作品」

**请求参数**

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `workId` | string | 是 | 3.3 返回的作品 ID |
| `imageUrl` | string | 是 | 成图地址 |
| `title` | string | 否 | 作品标题（用户可编辑），不传由后端生成 |

**返回示例**

```json
{
  "code": 0,
  "msg": "ok",
  "data": {
    "workId": "work-demo-0001",
    "savedAt": "2025-03-18 10:24:00",
    "success": true
  }
}
```

**字段说明**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `workId` | string | 作品 ID |
| `savedAt` | string | 保存时间 |
| `success` | boolean | 是否保存成功 |

---

### 3.5 NFC 溯源详情

- **接口名称**：根据 NFC 标签 ID 获取溯源详情
- **请求**：`GET /nfc/trace`
- **前端封装**：`nfcApi.getTraceByTag(tagId)`
- **用途**：用户碰一碰 NFC 标签，用标签 ID 换取故事内容、史料图、关联点位与商品

**请求参数**

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `tagId` | string | 是 | NFC 标签唯一标识，硬件烧录值 |

**返回示例**

```json
{
  "code": 0,
  "msg": "ok",
  "data": {
    "tagId": "NFC-TAG-0001",
    "title": "围屋门楼",
    "storyText": "这座围屋建于清光绪年间，门楼上的青砖是从河滩一块块挑回来的……",
    "historyImageUrls": [
      "https://cdn.example.com/xiangyu-xinxu/nfc/NFC-TAG-0001-history-01.jpg",
      "https://cdn.example.com/xiangyu-xinxu/nfc/NFC-TAG-0001-history-02.jpg"
    ],
    "spotId": "spot-01",
    "goodsId": "goods-01",
    "audioUrlMandarin": "https://cdn.example.com/xiangyu-xinxu/audio/NFC-TAG-0001-mandarin.mp3",
    "audioUrlHakka": "https://cdn.example.com/xiangyu-xinxu/audio/NFC-TAG-0001-hakka.mp3"
  }
}
```

**字段说明**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `tagId` | string | 标签唯一标识 |
| `title` | string | 标签标题 |
| `storyText` | string | 故事文本（纯文本，不含 HTML） |
| `historyImageUrls` | string[] | 史料图片地址列表，可空数组 |
| `spotId` | string | 关联手绘地图点位 ID，可用于跳转地图 |
| `goodsId` | string | 关联文创商品 ID，可用于跳转商品详情 |
| `audioUrlMandarin` | string | 普通话朗读音频 |
| `audioUrlHakka` | string | 客家方言朗读音频 |

**异常约定**：`tagId` 不存在时返回 `{"code": 40400, "msg": "标签未登记", "data": null}`，前端展示空态而非报错。

---

### 3.6 NFC 扫码上报

- **接口名称**：上报一次 NFC 扫码记录
- **请求**：`POST /nfc/scan-log`
- **前端封装**：`nfcApi.reportScan(payload)`
- **用途**：记录何时何地扫了哪个标签，用于后台统计

**请求参数**

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `tagId` | string | 是 | 标签唯一标识 |
| `scannedAt` | string | 是 | 扫码时间，`YYYY-MM-DD HH:mm:ss` |
| `latitude` | number | 否 | 扫码位置纬度（GCJ-02），用户拒绝授权时不传 |
| `longitude` | number | 否 | 扫码位置经度（GCJ-02），用户拒绝授权时不传 |

**返回示例**

```json
{
  "code": 0,
  "msg": "ok",
  "data": {
    "success": true,
    "reportedAt": "2025-03-18 10:24:00",
    "tagId": "NFC-TAG-0001"
  }
}
```

**字段说明**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `success` | boolean | 是否上报成功 |
| `reportedAt` | string | 服务端记录时间 |
| `tagId` | string | 回执的标签 ID |

> 上报失败**不阻塞**主流程：前端打日志即可，不弹错误。

---

### 3.7 手绘地图点位列表

- **接口名称**：获取手绘地图点位列表
- **请求**：`GET /map/spots`
- **前端封装**：`mapApi.getSpots(params)`
- **用途**：在地图底图上按 `mapX` / `mapY` 打点

**请求参数**

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `spotIds` | string[] | 否 | 只取指定点位；不传返回全部 |

**返回示例**

```json
{
  "code": 0,
  "msg": "ok",
  "data": [
    {
      "spotId": "spot-01",
      "name": "客家围屋",
      "mapX": 168,
      "mapY": 420,
      "description": "三进两横的方形围屋，门楼朝南，屋前有一口半月形水塘。",
      "imageUrl": "https://cdn.example.com/xiangyu-xinxu/spot/spot-01.png",
      "latitude": 24.2886,
      "longitude": 116.1225
    }
  ]
}
```

**字段说明**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `spotId` | string | 点位 ID，跨表外键 |
| `name` | string | 地点名称 |
| `mapX` | number | **设计稿原始像素** X 坐标，取值 `0 ~ 750` |
| `mapY` | number | **设计稿原始像素** Y 坐标，取值 `0 ~ 1334` |
| `description` | string | 地点描述 |
| `imageUrl` | string | 点位配图地址 |
| `latitude` | number | 真实纬度（GCJ-02） |
| `longitude` | number | 真实经度（GCJ-02） |

详见 [4.3 mapX / mapY](#43-mapx--mapy-手绘地图坐标) 与 [4.4 经纬度](#44-latitude--longitude真实经纬度)。

---

### 3.8 手绘地图点位详情

- **接口名称**：获取单个点位详情
- **请求**：`GET /map/spots/{spotId}`
- **前端封装**：`mapApi.getSpotDetail(spotId)`
- **用途**：点击地图点位后拉取完整信息

**请求参数**

| 参数 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `spotId` | path | string | 是 | 点位 ID，拼在路径上 |

示例：`GET https://example.com/api/map/spots/spot-03`

**返回示例**

```json
{
  "code": 0,
  "msg": "ok",
  "data": {
    "spotId": "spot-03",
    "name": "擂茶老铺",
    "mapX": 302,
    "mapY": 742,
    "description": "临街的一间老铺，门口摆着陶钵和茶棍，进门先上一碗擂茶。",
    "imageUrl": "https://cdn.example.com/xiangyu-xinxu/spot/spot-03.png",
    "latitude": 24.3014,
    "longitude": 116.1308
  }
}
```

**字段说明**：与 3.7 列表项**完全一致**（同一份结构，不分「列表字段」和「详情字段」）。

**异常约定**：`spotId` 不存在时返回 `{"code": 40400, "msg": "点位不存在", "data": null}`。

---

### 3.9 文创商品列表

- **接口名称**：获取文创商品列表
- **请求**：`GET /goods/list`
- **前端封装**：`goodsApi.getList(params)`
- **用途**：商品列表页；也可在点位详情里按 `spotId` 推荐关联商品

**请求参数**

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `spotId` | string | 否 | 按关联点位筛选；不传返回全部商品 |

**返回示例**

```json
{
  "code": 0,
  "msg": "ok",
  "data": [
    {
      "goodsId": "goods-01",
      "name": "客家围屋冰箱贴",
      "price": 39,
      "coverUrl": "https://cdn.example.com/xiangyu-xinxu/goods/goods-01-cover.png",
      "summary": "手工上色的围屋门楼，贴在冰箱上就是一小片故乡。",
      "spotId": "spot-01"
    }
  ]
}
```

**字段说明**（列表项是详情的子集）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `goodsId` | string | 商品 ID |
| `name` | string | 商品名称 |
| `price` | number | 价格，单位：元 |
| `coverUrl` | string | 封面图地址 |
| `summary` | string | 一句话卖点 |
| `spotId` | string | 关联点位 ID |

---

### 3.10 文创商品详情

- **接口名称**：获取商品详情
- **请求**：`GET /goods/detail`
- **前端封装**：`goodsApi.getDetail(goodsId)`
- **用途**：商品详情页

**请求参数**

| 参数 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `goodsId` | query | string | 是 | 商品 ID |

示例：`GET https://example.com/api/goods/detail?goodsId=goods-03`

**返回示例**

```json
{
  "code": 0,
  "msg": "ok",
  "data": {
    "goodsId": "goods-03",
    "name": "擂茶礼盒",
    "price": 128,
    "coverUrl": "https://cdn.example.com/xiangyu-xinxu/goods/goods-03-cover.png",
    "summary": "茶叶、花生、芝麻分装备好，配一支竹制茶棍。",
    "detailText": "按老铺的配比分装，茶叶、花生、芝麻各一袋，附竹制茶棍一支和陶钵一只……",
    "detailImageUrls": [
      "https://cdn.example.com/xiangyu-xinxu/goods/goods-03-detail-01.jpg",
      "https://cdn.example.com/xiangyu-xinxu/goods/goods-03-detail-02.jpg"
    ],
    "spotId": "spot-03"
  }
}
```

**字段说明**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `goodsId` | string | 商品 ID |
| `name` | string | 商品名称 |
| `price` | number | 价格，单位：元 |
| `coverUrl` | string | 封面图地址 |
| `summary` | string | 一句话卖点 |
| `detailText` | string | 详情文案（纯文本） |
| `detailImageUrls` | string[] | 详情长图地址列表，按数组顺序纵向渲染 |
| `spotId` | string | 关联点位 ID |

比列表项**多** `detailText` / `detailImageUrls`，列表项字段全部包含。

**异常约定**：`goodsId` 不存在时返回 `{"code": 40400, "msg": "商品不存在", "data": null}`。

---

### 3.11 我的订单列表

- **接口名称**：获取我的订单列表
- **请求**：`GET /goods/orders`
- **前端封装**：`goodsApi.getOrders(params)`
- **用途**：我的订单页

**请求参数**

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `status` | string | 否 | 按状态筛选：`unpaid` / `paid` / `shipped` / `finished`；不传返回全部 |

**返回示例**

```json
{
  "code": 0,
  "msg": "ok",
  "data": [
    {
      "orderId": "ORD-20250315-0001",
      "goodsId": "goods-01",
      "goodsName": "客家围屋冰箱贴",
      "coverUrl": "https://cdn.example.com/xiangyu-xinxu/goods/goods-01-cover.png",
      "price": 39,
      "count": 2,
      "totalAmount": 78,
      "status": "paid",
      "createdAt": "2025-03-15 10:24:00"
    }
  ]
}
```

**字段说明**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `orderId` | string | 订单号 |
| `goodsId` | string | 商品 ID |
| `goodsName` | string | 下单时的商品名**快照**（不跟随商品改名） |
| `coverUrl` | string | 下单时的封面图**快照** |
| `price` | number | 单价，单位：元 |
| `count` | number | 购买数量 |
| `totalAmount` | number | 实付金额，单位：元，应等于 `price × count`（不含运费） |
| `status` | string | 订单状态枚举 |
| `createdAt` | string | 下单时间 |

**订单状态枚举**：`unpaid` 待付款 / `paid` 已付款 / `shipped` 已发货 / `finished` 已完成。

> **本地订单额外字段**：Demo 阶段下单后订单记在本地 storage，除上表字段外还会带
> `receiver`（收货人）、`receiverPhone`（收货手机号）、`addressText`（收货地址快照）、
> `workImage`（定制作品图）、`payMode`（`wxpay` / `mock`）。
> 这些是**前端本地字段**，后端可按需在订单详情里扩展，不影响上面的既有字段。

---

### 3.12 创建订单

- **接口名称**：创建订单（统一下单）
- **请求**：`POST /goods/orders`
- **前端封装**：`goodsApi.createOrder(payload)`
- **用途**：商品详情页点「立即购买」时，把商品 + 收货地址 + 定制作品图提交给后端，锁库存并生成待支付订单

**请求参数**

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `goodsId` | string | 是 | 商品 ID |
| `count` | number | 是 | 购买数量 |
| `addressId` | string | 是 | 收货地址 ID（本地地址的 ID） |
| `address` | object | 是 | 收货地址**快照**，见下表 |
| `address.name` | string | 是 | 收货人 |
| `address.phone` | string | 是 | 收货手机号 |
| `address.region` | string[] | 是 | 省 / 市 / 区 |
| `address.detail` | string | 是 | 详细地址 |
| `workImage` | string | 否 | 定制作品图地址（文创定制用，无定制时为空串） |

**返回示例**

```json
{
  "code": 0,
  "msg": "ok",
  "data": {
    "orderId": "ORD-20251101123045-4821",
    "totalAmount": 39,
    "status": "unpaid",
    "payParams": {
      "timeStamp": "1730000000",
      "nonceStr": "5K8264ILTKCH16CQ2502SI8ZNMTM67VS",
      "package": "prepay_id=wx201410272009395522657a690389285100",
      "signType": "RSA",
      "paySign": "oR9d8PuhnIc+YZ8cBHFCwfgpaK9gd7vaRvkYD7rthRAZ..."
    }
  }
}
```

**字段说明**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `orderId` | string | 后端订单号，必须全局唯一 |
| `totalAmount` | number | 应付金额，单位：元，**由后端计算** |
| `status` | string | 初始为 `unpaid` |
| `payParams` | object \| null | 调起支付参数；`null` 表示未开启支付或无需支付 |

> ⚠️ **金额必须由后端按 `goodsId` 计算**，前端传的价格不作数（防止篡改）。前端在页面上展示的价格仅用于显示。

---

### 3.13 获取支付参数

- **接口名称**：获取订单支付参数
- **请求**：`POST /goods/orders/{orderId}/pay`
- **前端封装**：`goodsApi.payOrder(orderId)`
- **用途**：「我的订单」里对未付款订单点「去支付」时，后端按订单号重新签名并返回支付参数

**请求参数**

| 参数 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `orderId` | path | string | 是 | 订单号 |

**返回示例**

```json
{
  "code": 0,
  "msg": "ok",
  "data": {
    "orderId": "ORD-20251101123045-4821",
    "status": "unpaid",
    "payParams": {
      "timeStamp": "1730000000",
      "nonceStr": "5K8264ILTKCH16CQ2502SI8ZNMTM67VS",
      "package": "prepay_id=wx201410272009395522657a690389285100",
      "signType": "RSA",
      "paySign": "oR9d8PuhnIc+YZ8cBHFCwfgpaK9gd7vaRvkYD7rthRAZ..."
    }
  }
}
```

**字段说明**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `orderId` | string | 订单号 |
| `status` | string | `paid` 表示已支付（此时 `payParams` 为 `null`，前端不再调起支付） |
| `payParams` | object \| null | 同 3.12：`timeStamp` / `nonceStr` / `package` / `signType` / `paySign` |

**支付参数说明**（`payParams` 内部字段，直接透传给 `wx.requestPayment`）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `timeStamp` | string | 时间戳（**字符串**，不是数字） |
| `nonceStr` | string | 随机字符串 |
| `package` | string | 形如 `prepay_id=wx...` |
| `signType` | string | `RSA`（微信支付 v3）或 `MD5` |
| `paySign` | string | 签名 |

**异常约定**：`orderId` 不存在返回 `{"code": 40400, "msg": "订单不存在", "data": null}`。

---

### 3.14 微信手机号一键登录

- **接口名称**：手机号登录
- **请求**：`POST /user/login`
- **前端封装**：`userApi.login(payload)`
- **用途**：「我的」页点「微信手机号一键登录」时换取登录态与手机号

**前端调用链**（后端需要知道 code 从哪来）：

```
<button open-type="getPhoneNumber"> 点击
   → 回调 detail.code          （手机号凭证，5 分钟有效、一次性）
   → wx.login() 得到 code       （登录凭证，换取 openid / session_key）
   → 两个 code 一起 POST /user/login
```

**请求参数**

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `loginCode` | string | 是 | `wx.login()` 返回的 code |
| `phoneCode` | string | 是 | `getPhoneNumber` 回调里的 `detail.code` |

**返回示例**

```json
{
  "code": 0,
  "msg": "ok",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "userId": "user-0001",
    "phone": "13800138000",
    "nickname": "围山访客",
    "avatarUrl": ""
  }
}
```

**字段说明**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `token` | string | 登录凭证，后续请求放 `Authorization: Bearer <token>` |
| `userId` | string | 用户唯一标识 |
| `phone` | string | 手机号（**后端换取，前端拿不到明文**） |
| `nickname` | string | 昵称，为空时前端显示「围山访客」 |
| `avatarUrl` | string | 头像地址，空串表示用默认头像 |

> 后端实现要点：用 `phoneCode` 调微信 `phonenumber.getPhoneNumber`（需要 `access_token`），
> 同时用 `loginCode` 换 `openid`，两者关联后建号并签发自己的 token。

---

### 3.15 用户资料

- **接口名称**：获取当前登录用户资料
- **请求**：`GET /user/profile`
- **前端封装**：`userApi.getProfile()`
- **用途**：用 token 换昵称、手机号、地址数量（当前 Demo 用登录返回的信息即可，此接口预留）

**请求参数**：无（靠 `Authorization` 头识别用户）

**返回示例**

```json
{
  "code": 0,
  "msg": "ok",
  "data": {
    "userId": "user-0001",
    "phone": "13800138000",
    "nickname": "围山访客",
    "avatarUrl": "",
    "addressCount": 2
  }
}
```

**字段说明**：`userId` / `phone` / `nickname` / `avatarUrl` 同 3.14；`addressCount` 为已保存的收货地址数量。

---

## 4. 特殊约定

### 4.1 `spotId`

- **含义**：手绘地图点位的唯一标识，格式为 `spot-01`、`spot-02` 这类**固定字符串**（不是自增数字）。
- **作用**：它是三张表的**外键**，串起「地图 → 故事 → 商品」的链路：
  - `mock-map-spots.js` 的 `spots[].spotId` —— 主表
  - `mock-nfc.js` 的 `tags[].spotId` —— NFC 标签指向某个点位
  - `mock-goods.js` 的 `details[].spotId` —— 商品关联某个点位
- **约束**：由后端统一分配，一旦上线**不可修改**（NFC 标签已烧录，改了就断链）；前端只做透传，不拼装、不解析。
- **用法**：`mapApi.getSpots()` 打点 → 点某个点位 → `mapApi.getSpotDetail(spotId)`；同时可用 `goodsApi.getList({ spotId })` 拉该点位下的关联商品。

### 4.2 `tagId`

- **含义**：NFC 标签的唯一标识，是**烧录进标签芯片的物理 ID**，格式如 `NFC-TAG-0001`。
- **来源**：由写卡工具写入，后端建档；前端只读取、不上传自定义值。
- **约束**：
  - 一标签一故事：`tagId` 与故事是 1:1，同一 `tagId` 重复查询结果一致。
  - 大小写敏感，必须原样回传（勿做 `toLowerCase()`）。
  - 未登记的标签返回 `code: 40400`，前端展示「这张标签还没登记」的空态。
- **链路**：碰标签 → 拿到 `tagId` → `nfcApi.getTraceByTag(tagId)` → 结果里的 `spotId` 可跳地图、`goodsId` 可跳商品详情。

### 4.3 `mapX` / `mapY`（手绘地图坐标）

- **坐标系**：手绘地图**设计稿原图**上的绝对像素坐标，原点在左上角，X 向右、Y 向下。
- **设计稿尺寸**：固定 **750 × 1334**（宽 × 高），因此 `mapX ∈ [0, 750]`、`mapY ∈ [0, 1334]`。
- **不是什么**：不是百分比、不是 `rpx`、不是页面渲染坐标，**不能直接**写进 `left` / `top`。
- **换算**：渲染前必须先经 `utils/map-calc.js`（当前为函数外壳，逻辑待实现）把设计稿像素换算成当前屏幕的渲染坐标；反向点击命中也要用它把点击坐标换算回设计稿坐标。
- **后端注意**：`mapX` / `mapY` 与设计稿尺寸强绑定。若设计稿换成 `1080 × 1920`，必须同时告知前端修改 `map-calc` 的 `source` 尺寸，否则所有点位会错位。
- **推荐做法**：后端存设计稿绝对像素；若更倾向于存百分比（`0~100` 的 `x` / `y`），需与前端约定后统一改字段语义，并同步 `map-calc`。

### 4.4 `latitude` / `longitude`（真实经纬度）

- **含义**：点位在真实世界中的经纬度，坐标系 **GCJ-02**（与 `wx.openLocation`、腾讯地图一致，勿下发 WGS-84 原始 GPS）。
- **作用**：**只用于**「导航到这里」——点按钮跳 `wx.openLocation({ latitude, longitude })`，或复制地址。
- **不参与手绘地图定位**：地图上的位置完全由 `mapX` / `mapY` 决定，经纬度与小地图渲染无关。两者可能不一致（手绘地图是艺术化处理，不是等比地图），这是正常的。
- **精度**：建议保留 6 位小数。
- **上报场景**：`POST /nfc/scan-log` 里的 `latitude` / `longitude` 是**用户扫码时的实时位置**，与点位的经纬度是两个概念，别混用。

---

## 5. 附录

### 5.1 mock 文件与接口对照

| mock 文件 | 导出内容 | 对应接口 |
| --- | --- | --- |
| `mock/mock-material.js` | `templates` / `materials` / `composeResult` / `saveResult` | 3.1 ~ 3.4 |
| `mock/mock-nfc.js` | `tags` / `reportResult` | 3.5 ~ 3.6 |
| `mock/mock-map-spots.js` | `spots` | 3.7 ~ 3.8 |
| `mock/mock-goods.js` | `list` / `details` / `orders` | 3.9 ~ 3.11 |

mock 返回的结构**就是** `data` 的本体，与后端联调后返回的 `data` 必须逐字段一致。

### 5.2 枚举值汇总

| 枚举 | 取值 | 含义 |
| --- | --- | --- |
| `theme`（模板） | `childlike` / `retro` | 童趣 / 复古 |
| `status`（订单） | `unpaid` / `paid` / `shipped` / `finished` | 待付款 / 已付款 / 已发货 / 已完成 |
| `uiMode`（本地配置，非接口） | `normal` / `elder` / `child` | 普通 / 长辈大字 / 儿童简易 |
| `voiceType`（本地配置，非接口） | `mandarin` / `hakka` | 普通话 / 客家方言 |

`uiMode` / `voiceType` 只存在小程序本地 `storage`（键名 `USER_CONFIG`），**不上传后端**；如需同步多端，再另开用户配置接口。

### 5.3 待补充接口

以下能力页面已预留，但接口尚未定义，需后端补齐后在此文档追加：

| 能力 | 建议路径 | 说明 |
| --- | --- | --- |
| 我的作品列表 | `GET /collage/works` | 「我的作品」页目前只能保存、不能列表 |
| 作品删除 | `DELETE /collage/works/{workId}` | 作品管理 |
| 订单支付回调 | `POST /notify/wechat-pay` | 微信支付结果回调（服务端到服务端，前端不调） |
| 订单取消 | `POST /goods/orders/{orderId}/cancel` | 用户主动取消待付款订单 |

> 已从「待补充」移出：`POST /user/login`（见 3.14）、`POST /goods/orders`（见 3.12），
> 以及支付参数接口（见 3.13）—— 这三个本轮已定义。

### 5.4 字段扩展与兼容约定（后续加功能看这里）

**结论：只要遵守下面几条，后续往 Demo 里加内容都不会破坏本文档和前后端约定。**

| 规则 | 是否允许 | 说明 |
| --- | --- | --- |
| **新增字段** | ✅ 允许 | 后端多返回字段，前端不使用即无影响；前端不认识的字段不会报错 |
| **新增枚举值** | ✅ 允许 | 例如订单状态加 `canceled`，前端会原样显示原始值，只需补一版中文映射 |
| **新增数据条目** | ✅ 允许 | 加商品 / 点位 / 标签，只要 ID 唯一、外键对得上即可 |
| **新增接口** | ✅ 允许 | 在本文 3.x 追加一节 + 第 2 节表格加一行，属向后兼容 |
| **给现有接口加可选参数** | ✅ 允许 | 例如分页 `page` / `pageSize`，在「请求参数」表加一行即可 |
| **改名已有字段** | ❌ 禁止 | 如 `price` → `sellPrice`，前端取值变 `undefined`，页面直接空白 |
| **删除已有字段** | ❌ 禁止 | 暂时用不上也请保留，无值传 `null` / `[]` / `0` |
| **改变字段类型** | ❌ 禁止 | 如 `price` 由 number 变 string，金额计算与格式化都会出错 |
| **主键类型混用** | ❌ 禁止 | `goodsId` / `spotId` / `tagId` 统一用**字符串** |

**「我后面想加 XX」对应影响表**

| 你想加的东西 | 影响本文档吗 | 需要做什么 |
| --- | --- | --- |
| 新商品 / 新点位 / 新 NFC 标签 | ❌ 不影响 | 只改 `mock/`，结构不变 |
| 换图片、音频地址 | ❌ 不影响 | 字段仍是 string，只换值 |
| 改价格、文案、故事内容 | ❌ 不影响 | 只改值 |
| 新增一个页面（不调新接口） | ❌ 不影响 | 纯前端改动 |
| 新增一个接口 | ✅ 影响 | 3.x 追加接口详情 + 第 2 节表格加一行 |
| 现有接口加分页等可选参数 | ⚠️ 轻微 | 对应接口的「请求参数」表加一行 |
| 新增字段（如商品加 `stock`） | ⚠️ 轻微 | 对应接口的「字段说明」表加一行，后端可直接先加 |
| 改字段名 / 改结构 | 🚨 破坏性 | **必须提前通知后端并同步改本文档** |

> 给后端同学的一句话：**新增都是兼容的，只有改名、删字段、改类型才需要提前对齐。**



