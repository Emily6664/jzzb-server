# 乡语新叙 · 后端服务（server）

为微信小程序 `weapp-xiangyu-xinxu` 提供 API 的独立后端。**一个进程、一个端口、一套 SQLite**，
除了你自己选用的反向代理之外，不需要 Redis / MySQL 之类的额外中间件。

接口契约以小程序仓库根目录的 `API_DOC.md` 为准，本服务把文档里的 15 个接口全部实现，
并补了 4 个文档「5.3 待补充」里列出的接口。

| 项 | 选择 | 说明 |
| --- | --- | --- |
| Web 框架 | FastAPI | 自带 `/docs` 交互式文档，参数校验由 Pydantic 完成 |
| ASGI 服务器 | uvicorn | 单进程即可，`--workers` 想加也支持 |
| 存储 | SQLite（标准库 `sqlite3`） | 零外部依赖；开启 WAL，单人维护场景够用 |
| 配置 | pydantic-settings | 环境变量 / `.env` 二选一 |
| 包管理 | **uv** | `uv sync` 一条命令建环境装依赖 |
| 运行环境 | Python ≥ 3.10，Linux / Windows 均可 | 代码里没有平台相关逻辑 |


---

## 1. 目录结构

```
server/
├─ app/
│  ├─ main.py            # FastAPI 应用装配：中间件、异常处理、路由挂载
│  ├─ config.py          # 全部配置项（环境变量 / .env）
│  ├─ db.py              # SQLite 连接、建表、事务
│  ├─ seed.py            # 种子数据导入 + 命令行入口
│  ├─ seed_data.py       # 初始数据（与小程序 mock/ 逐字段一致）
│  ├─ errors.py          # 状态码常量 + BizError
│  ├─ envelope.py        # { code, msg, data } 信封
│  ├─ media.py           # 图片 / 音频域名替换
│  ├─ schemas.py         # 请求体模型
│  ├─ serializers.py     # 数据库行 → 接口字段
│  ├─ security.py        # 用户、token、登录依赖
│  ├─ utils.py           # 时间 / 金额 / ID / 文本工具
│  ├─ routers/
│  │  ├─ user.py         # 3.14 / 3.15
│  │  ├─ collage.py      # 3.1 ~ 3.4
│  │  ├─ nfc.py          # 3.5 / 3.6
│  │  ├─ maps.py         # 3.7 / 3.8
│  │  ├─ goods.py        # 3.9 ~ 3.13
│  │  ├─ notify.py       # 微信支付回调
│  │  └─ health.py       # 健康检查
│  └─ services/
│     ├─ wechat.py       # code2session / 手机号换取
│     └─ pay.py          # 微信支付 v3 签名 + 回调解密（默认关闭）
├─ tests/
│  ├─ conftest.py
│  └─ test_api.py        # 接口契约冒烟测试
├─ run.py                # 启动脚本
├─ pyproject.toml
├─ .env.example
└─ data/app.db           # 首次启动自动生成，已被 .gitignore 忽略
```


---

## 2. 快速开始

前置：装好 [uv](https://docs.astral.sh/uv/)（Windows 下 `winget install astral-sh.uv` 或 `pip install uv`）。

```bash
cd server

uv sync                        # 建 .venv 并安装依赖（含 dev 组的 pytest）
copy .env.example .env         # Windows；Linux/macOS 用 cp

uv run python run.py           # 监听 0.0.0.0:8000
```

> 只是本地调试这样跑就行；**要长期运行请用 `.\start.ps1 -Background`**——自带看门狗（崩了 3 秒自动拉起）、
> 日志落盘、重复启动保护，见 [8.2 Windows](#82-windows)。

启动后（本机）：

- 根路径：<http://127.0.0.1:8000/> 只显示一个 `OK`
- 接口根地址：<http://127.0.0.1:8000/api>
- 交互式文档：<http://127.0.0.1:8000/docs>（生产环境记得把 `DOCS_ENABLED` 改成 `false`）
- 健康检查：<http://127.0.0.1:8000/healthz>

配好反向代理后，对外域名是 **<https://ecg.proxy.lc.cygnomatic.net/>**：

- 首页 <https://ecg.proxy.lc.cygnomatic.net/> → `OK`
- 接口 <https://ecg.proxy.lc.cygnomatic.net/api/goods/list>
- 文档 <https://ecg.proxy.lc.cygnomatic.net/docs>

```bash
curl http://127.0.0.1:8000/healthz
curl "http://127.0.0.1:8000/api/goods/list"
curl "https://ecg.proxy.lc.cygnomatic.net/api/nfc/trace?tagId=NFC-TAG-0001"
```

> 首次启动会自动建表并导入种子数据（2 套模板、8 个素材、5 个点位、4 个 NFC 标签、5 个商品、3 条演示订单）。

其他启动方式：

```bash
uv run python run.py --reload        # 开发模式，改代码自动重启
uv run python run.py --port 9000     # 临时换端口
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000   # 直接用 uvicorn
```


---

## 3. 配置

全部配置都在 `app/config.py`，可用**同名环境变量**覆盖，也可写进 `server/.env`（参考 `.env.example`）。
环境变量优先级高于 `.env`，改完需要重启才生效。

> **每个变量的作用、默认值、什么时候改、配错了会看到什么 → 见 [`ENV.md`](ENV.md)（逐项说明）。**
> 下面只是最常见的那几个。

只有这几项通常需要动：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | 监听所有网卡（当前配置，配合反向代理）。只想让本机代理转发可改回 `127.0.0.1` |
| `PORT` | `8000` | **唯一占用的端口**，改这个即可 |
| `FORWARDED_ALLOW_IPS` | `*` | 信任哪些来源的 `X-Forwarded-*`；代理和服务同机时建议改成 `127.0.0.1` |
| `API_PREFIX` | `/api` | 必须和小程序 `BASE_URL` 的结尾一致 |
| `ROOT_PATH` | 空 | 反代把服务挂在子路径（如 `/xiangyu`）时填，影响 `/docs` 与 OpenAPI 的地址 |
| `AUTH_REQUIRED` | `false` | 是否强制带 token（原因见第 5 节） |
| `MEDIA_BASE_URL` | 空 | 把占位域名 `cdn.example.com/...` 换成真实前缀；不用 CDN 就填 `https://你的域名/media`（见 6.5） |
| `WECHAT_APPID` / `WECHAT_SECRET` | 空 | 不配就走进「演示登录」 |
| `WECHAT_PAY_ENABLED` | `false` | 微信支付总开关 |
| `MOCK_PAY_AUTO_CONFIRM` | `true` | 未开支付时，调 `/pay` 直接把订单置为已付款 |
| `NOT_FOUND_AS_NULL` | `true` | 详情查询没命中时返回 `code 0 + data null`（页面走空态）；设 `false` 则按文档返回 `40400` |
| `DOCS_ENABLED` | `true` | 生产环境建议 `false` |

完整列表见 [`.env.example`](.env.example)。相对路径（`DATA_DIR`、`DB_PATH`）都以 `server/` 为基准，不受启动目录影响。


---

## 4. 接口清单

请求地址 = `BASE_URL` + 路径，对外是 `https://ecg.proxy.lc.cygnomatic.net/api/...`（本机是 `http://127.0.0.1:8000/api/...`）。
**注意：服务同时把接口挂在根路径上**（`/goods/list` 也能命中），所以反向代理保留或剥掉 `/api` 前缀都不会 404。

| # | 方法 | 路径 | 说明 | 文档 |
| --- | --- | --- | --- | --- |
| 1 | GET | `/collage/templates` | 拼贴模板列表 | 3.1 ✅ |
| 2 | GET | `/collage/materials?templateId=` | 拼贴素材列表 | 3.2 ✅ |
| 3 | POST | `/collage/compose` | 提交拼贴合成 | 3.3 ✅ |
| 4 | POST | `/collage/works` | 保存拼贴作品 | 3.4 ✅ |
| 5 | GET | `/nfc/trace?tagId=` | NFC 溯源详情 | 3.5 ✅ |
| 6 | POST | `/nfc/scan-log` | NFC 扫码上报 | 3.6 ✅ |
| 7 | GET | `/map/spots?spotIds=` | 手绘地图点位列表 | 3.7 ✅ |
| 8 | GET | `/map/spots/{spotId}` | 手绘地图点位详情 | 3.8 ✅ |
| 9 | GET | `/goods/list?spotId=` | 文创商品列表 | 3.9 ✅ |
| 10 | GET | `/goods/detail?goodsId=` | 文创商品详情 | 3.10 ✅ |
| 11 | GET | `/goods/orders?status=` | 我的订单列表 | 3.11 ✅ |
| 12 | POST | `/goods/orders` | 创建订单（金额后端计算） | 3.12 ✅ |
| 13 | POST | `/goods/orders/{orderId}/pay` | 获取支付参数 | 3.13 ✅ |
| 14 | POST | `/user/login` | 微信手机号登录 | 3.14 ✅ |
| 15 | GET | `/user/profile` | 用户资料 | 3.15 ✅ |
| 16 | GET | `/collage/works` | 我的作品列表 | 5.3 扩展 |
| 17 | DELETE | `/collage/works/{workId}` | 删除作品 | 5.3 扩展 |
| 18 | POST | `/goods/orders/{orderId}/cancel` | 取消待付款订单 | 5.3 扩展 |
| 19 | POST | `/notify/wechat-pay` | 微信支付回调（服务端到服务端） | 5.3 扩展 |
| 20 | POST | `/user/logout` | 退出登录（作废 token） | 扩展 |
| 21 | GET | `/health` | 健康检查 | 扩展 |

**返回约定**（与文档 1.1 一致）

- 成功：`HTTP 200` + `{"code": 0, "msg": "ok", "data": ...}`
- 业务失败：**`HTTP 200`** + `{"code": 40001, "msg": "可直接展示给用户的中文", "data": null}`
  —— 这样小程序 `utils/api.js` 才能把 `msg` toast 出来（它对非 2xx 只显示通用错误）
- 链路级故障：`HTTP 500` / `404`，同样是信封结构
- 状态码：`40001` 参数非法、`40100` 未登录、`40300` 无权限、`40400` 资源不存在、`50000` 服务异常
- 例外：`/nfc/trace`、`/goods/detail`、`/map/spots/{id}` 这类「按 ID 取详情」的接口，
  默认返回 `code 0 + data null` 而不是 `40400`，原因见 5.4 第 3 条

**扩展字段**（文档 5.4 允许新增，前端不用也不影响）：

- `GET /goods/detail` 多返回 `stock`
- `GET /goods/orders` 多返回 `receiver` / `receiverPhone` / `addressText` / `workImage` / `payMode` / `paidAt`
- 订单状态多一个枚举值 `canceled`


---

## 5. 和小程序联调（重要）

### 5.1 只需要改三处

1. **`utils/api.js`**
   ```js
   const USE_MOCK = false;
   const BASE_URL = 'https://ecg.proxy.lc.cygnomatic.net/api';   // 结尾必须和 API_PREFIX 一致
   ```
2. **小程序后台 → 开发设置 → 服务器域名**：把 `https://ecg.proxy.lc.cygnomatic.net` 加进 **request 合法域名**
   （必须是 https、已备案域名，不能带端口和路径）
3. **图片 / 音频**：把 `MEDIA_BASE_URL` 配成真实 CDN 前缀（或直接改 `app/seed_data.py` 后重新导入），
   再把该域名加进 **downloadFile 合法域名**，否则真机不显示图、不播放音频。

> 改完怎么确认真的连上了？见 [5.6](#56-怎么确认真的连到后端了)。

### 5.2 信封解包不用改

`utils/api.js` 里 `UNWRAP_ENVELOPE = true` 的实现已经就位（`SUCCESS_CODES = [0, 200]`），
`API_DOC.md` 1.1 里「联调时再补」那段代码**已经不需要再补**，直接连就行。

### 5.3 关于登录态：为什么要 `AUTH_REQUIRED=false`

小程序的 `utils/api.js` 目前**不会**给请求加 `Authorization` 头（`header` 里只有 `content-type`），
而登录接口又是「用户点按钮才触发」。如果后端强制校验 token，未登录用户连商品列表都拉不到。

所以默认策略是：

- 带了合法 token → 用 token 对应的用户；
- 没带 / token 失效 → 回落到**演示用户**（`user-0001`），接口照常返回；
- 把 `AUTH_REQUIRED=true` → 没有 token 直接返回 `40100`。

想开启强校验，在 `utils/api.js` 的 `networkRequest()` 里补一行（token 已存在 storage 里）：

```js
const token = wx.getStorageSync('USER_INFO') && wx.getStorageSync('USER_INFO').token;
header: Object.assign(
  { 'content-type': 'application/json' },
  token ? { Authorization: 'Bearer ' + token } : {},
  options.header || {}
),
```

> `USER_INFO` 是 `pages/mine/mine.js` 里存的键名，实际以你的代码为准。

### 5.4 三个与前端行为对齐的约定

1. **「我的订单」会出现重复行**：`pages/my-order/my-order.js` 把本地 `MY_ORDERS` 和接口返回的订单
   直接 `concat` 后排序，不做 `orderId` 去重。一旦 `USE_MOCK=false`，你刚下的单会同时出现在两处。
   建议在 `mergeOrders()` 里按 `orderId` 去重，或在联调阶段不再写本地 `MY_ORDERS`。
2. **模拟支付**：`PAY_ENABLE=false` 时前端拿到 `payParams: null` 会自己判定「支付成功」。
   后端为了让两端状态一致，默认 `MOCK_PAY_AUTO_CONFIRM=true`：调 `/goods/orders/{id}/pay` 即把订单置为 `paid`。
   想保留「待付款」等着接真支付，把它设成 `false`。
3. **查不到时的返回值**：`API_DOC.md` 约定 `40400`，但页面代码是
   `getDetail().then(detail => { if (!detail) 显示空态 })`，走 `reject` 反而会弹「加载失败」。
   所以默认 `NOT_FOUND_AS_NULL=true`，返回 `{code: 0, data: null}`，和小程序 mock 的行为完全一致。
   如果你更希望严格按文档报错，设成 `false`，同时在页面 `catch` 里判断 `err.code === 40400` 做空态。

### 5.5 `spotIds` 数组参数

`wx.request` 对 GET 数组参数的序列化方式随基础库版本有差异，服务端四种写法都兼容：
`spotIds=a&spotIds=b`、`spotIds[]=a`、`spotIds=a,b`、`spotIds[0]=a`。

### 5.6 怎么确认「真的连到后端了」

种子数据与 `mock/` 是同一份，所以列表页**看起来一模一样是正常的**，不能用「内容变了」来判断。
按下面任意一条确认：

**① 开发者工具 → Network（最直接）**

| | `USE_MOCK=true` | `USE_MOCK=false` |
| --- | --- | --- |
| Network 面板 | **一条请求都没有** | 出现 `https://ecg.proxy.lc.cygnomatic.net/api/goods/list` 等，状态 200 |
| 响应体 | 看不到（没请求） | `{"code":0,"msg":"ok","data":[...]}` 信封结构 |
| 耗时 | 0ms 立刻返回 | 有网络延迟，页面出现 loading 态 |

**② 登录 token（内容上的铁证）**

在控制台执行：

```js
wx.getStorageSync('USER_INFO')
```

- mock：`token === 'mock-token-0001'`，`userId === 'user-0001'`
- 真实：`token` 是服务端随机串（`secrets.token_urlsafe(32)`，约 43 位），每次登录都不同

**③ 服务端日志 / 数据库（最终裁决）**

服务端控制台每收到一个请求就打印一行（mock 模式下后台全程静默）：

```
GET /api/goods/list -> 200 3.2ms rid=6f1c2a9b4e7d
```

扫码页碰一次标签，库里就多一条记录：

```bash
# Windows
sqlite3.exe data\app.db "SELECT COUNT(*) FROM nfc_scan_logs;"
# Linux / macOS
sqlite3 data/app.db "SELECT COUNT(*) FROM nfc_scan_logs;"
```

同理：登录一次 `auth_tokens` 多一行、下一单 `orders` 多一行、拼贴保存 `collage_works` 多一行——
这些行 mock 永远不会产生。

**几个容易误判的点**

- 商品/模板/点位**内容与 mock 完全一致**（我故意用同一份种子数据），不能当判据；
- 拼贴合成：mock 固定返回 `work-demo-0001`，真实每次是新的 `work-<时间戳>-<4位随机>`；
- 商品详情响应比 mock **多一个 `stock` 字段**，Network 里能直接看到；
- 真机若域名没进 request 合法域名，会 `request:fail`、页面提示「加载失败」——这本身也证明它在发真请求；
- 开发者工具里要临时勾上「不校验合法域名」，否则本地/未备案域名一律被拦。


---

## 6. 反向代理（软件不限）

服务只监听一个端口（默认 `8000`），对外统一走 **<https://ecg.proxy.lc.cygnomatic.net/>**；
TLS、证书、限流都在代理层做，**不要把这个端口直接暴露到公网**。

Ubuntu 上的接入步骤、校验命令、502 排查表见 [`DEPLOY-ubuntu.md` 第 4 节](DEPLOY-ubuntu.md)。
本节只列代理必须满足的条件，不绑定具体软件。

### 6.1 代理必须满足的六条

| # | 要求 | 不满足会怎样 |
| --- | --- | --- |
| 1 | 上游指向 `http://127.0.0.1:8000`（同机）或后端的内网 `IP:8000` | 502 / 连不上 |
| 2 | 路径**原样转发**（保留 `/api`）；或整体剥掉 `/api`——二选一，不要混用 | 404（JSON 信封 `code: 40400`） |
| 3 | 透传 `Host`、`X-Forwarded-For`、`X-Forwarded-Proto` | 扫码上报的客户端 IP 变成代理 IP；`/docs` 里的地址不对 |
| 4 | `GET /`、`/media/*` 也转发到后端 | 根路径看到代理默认页；图片、音频全部 404 |
| 5 | 读超时 ≥ 30s，请求体上限 ≥ 10MB | 偶发 504；以后传作品图会 413 |
| 6 | HTTPS 终结在代理 | 小程序真机直接拒绝（只允许 https） |

关于第 2 条：后端**同时**注册了 `/api/...` 和根路径两套路由，所以保留或剥掉前缀都能用。
只要保证 `API_PREFIX`（默认 `/api`）和小程序 `BASE_URL` 的结尾一致即可。

### 6.2 示例（任选一种，不用都配）

Caddy——自动 HTTPS、自动带 `X-Forwarded-*`：

```caddyfile
ecg.proxy.lc.cygnomatic.net {
    reverse_proxy 127.0.0.1:8000
}
```

Traefik（docker labels）：

```yaml
labels:
  - traefik.enable=true
  - traefik.http.routers.xiangyu.rule=Host(`ecg.proxy.lc.cygnomatic.net`)
  - traefik.http.routers.xiangyu.entrypoints=websecure
  - traefik.http.routers.xiangyu.tls.certresolver=letsencrypt
  - traefik.http.services.xiangyu.loadbalancer.server.port=8000
```

UI 类（1Panel / 宝塔 / 其他带面板的反代工具）：新建反向代理 → 域名 `ecg.proxy.lc.cygnomatic.net` →
目标 `http://127.0.0.1:8000` → **不要**开「去掉 /api 前缀」之类的 rewrite → 申请 Let's Encrypt 证书。

### 6.3 挂在域名子路径下

想让接口地址是 `https://ecg.proxy.lc.cygnomatic.net/xiangyu/api/...`：

1. 代理把 `/xiangyu/api/...` 转成 `/api/...` 发给后端（剥掉 `/xiangyu`）；
2. 服务端设 `ROOT_PATH=/xiangyu`（只影响 `/docs`、OpenAPI 里生成的地址）；
3. 小程序 `BASE_URL` 用 `https://ecg.proxy.lc.cygnomatic.net/xiangyu/api`。

### 6.4 反代后面要注意的几点

- `X-Forwarded-For` 必须透传，扫码上报里的 `client_ip` 才准；
- 服务端开了 `proxy_headers=True` 信任 `X-Forwarded-*`，所以**别让别人直连 8000**：
  同机代理时 `HOST=127.0.0.1`，或防火墙只放行本机，或把 `FORWARDED_ALLOW_IPS` 设成代理的 IP；
- 代理跑在容器/另一台机器里时，`127.0.0.1` 指的是它自己——要写宿主 IP 或同网络的服务名；
- 小程序要求 https + 备案域名 + 不带端口，本地调试时在开发者工具里勾「不校验合法域名」；
- 502 的含义永远是「代理连不上后端」，先 `curl http://127.0.0.1:8000/healthz`，再看代理的 upstream 配置。

### 6.5 图片 / 音频：不需要 CDN

图片、音频可以直接由这个服务发出去，**和接口共用同一个域名、同一个端口**。原理是把 `MEDIA_DIR`
挂到了 `/media`：

```
接口返回   https://你的域名/media/goods/1-1.png
磁盘文件   server/media/goods/1-1.png
```

配置只需要一行，然后把文件按目录放进去：

```ini
MEDIA_BASE_URL=https://你的域名/media
```

```
server/media/
├─ goods/      商品图：{n}-1 封面，{n}-2 / {n}-3 详情    1-1.png … 5-3.png
├─ spot/       手绘地图点位配图      spot-01.png …
├─ template/   拼贴模板封面          tpl-childlike-cover.png …
├─ material/   拼贴素材（透明底 PNG）mat-childlike-01.png …
├─ audio/      普通话 / 客家话音频     mat-childlike-01-mandarin.mp3 …
├─ nfc/        史料图片              NFC-TAG-0001-history-01.jpg …
└─ work/       拼贴成图              work-20251103210512-4821.png
```

商品图按「商品序号-图序号」命名：`n-1` 封面，`n-2`、`n-3` 详情长图（按数组顺序纵向渲染）。
**商品序号和 goodsId 不是一回事**，映射写在 `app/seed_data.py` 顶部，同时决定列表展示顺序：

| 素材编号 | 商品 | goodsId | 列表位置 |
| --- | --- | --- | --- |
| 1 | 客家围屋冰箱贴 | `goods-01` | 第 1 个 |
| 2 | 擂茶礼盒 | `goods-03` | 第 2 个 |
| 3 | 童趣拼贴明信片套装 | `goods-02` | 第 3 个 |
| 4 | 土楼手绘帆布袋 | `goods-04` | 第 4 个 |
| 5 | 客家花灯书签 | `goods-05` | 第 5 个 |

加第 6 个商品：文件放成 `6-1.png`、`6-2.png`…，在 `seed_data.py` 里补一条
`"coverUrl": _goods_cover(6), "detailImageUrls": _goods_details(6), "sortOrder": 6`；
详情图不是两张时用 `_goods_details(6, count=3)`。

改完种子要重新导入（`INSERT OR IGNORE` 不会覆盖已有行）：

```bash
.venv/bin/python -m app.seed --force      # Windows: .venv\Scripts\python.exe -m app.seed --force
```

验证：

```bash
curl -I https://你的域名/media/goods/1-1.png    # 200 + image/png
curl -s https://你的域名/api/goods/list | head -c 120   # coverUrl 已是新域名
```

`/media` 由 FastAPI 的 `StaticFiles` 提供，支持 `Range` 请求，音频可以边下边播。

**什么时候才值得上 CDN / 对象存储**：素材体积大、并发高、需要就近加速或省服务器带宽。
现在这个体量（几十张图、几段音频）服务直出完全够用；将来换 CDN 只需要改 `MEDIA_BASE_URL`，
代码和数据库都不用动。

提醒两点：

- 反代要一起转发 `/media/*`（见 6.1 第 4 条），否则图片 404；
- 小程序后台把该域名同时加进 **request** 与 **downloadFile** 合法域名。


---

## 7. 数据

- 默认库文件：`server/data/app.db`（WAL 模式，会额外出现 `app.db-wal` / `app.db-shm`）。
- 表：`users` / `auth_tokens` / `collage_templates` / `collage_materials` / `map_spots` / `nfc_tags` /
  `nfc_scan_logs` / `goods` / `orders` / `collage_works`。
- 金额在库里存 **分**（`price_cents` / `total_cents`），出接口时转成「元」；整数金额返回 `39` 而不是 `39.0`。

**备份**（WAL 模式建议用 `.backup`，不要直接 copy 正在写的文件）：

```bash
sqlite3 data/app.db ".backup 'backup/app-$(date +%F).db'"
```

Windows：`sqlite3.exe data\app.db ".backup 'backup\app.db'"`，或直接停服后复制整个 `data/` 目录。

**修改商品 / 点位 / 标签 / 素材**：改 `app/seed_data.py` 后执行

```bash
uv run python -m app.seed --force            # 重建参考数据（不动用户和订单）
uv run python -m app.seed --force --orders   # 连三条演示订单一起重建
```

种子导入是幂等的（`INSERT OR IGNORE`），不带 `--force` 不会覆盖你手工改过的数据。
也可以直接用 `sqlite3` 改单条记录，重启不需要。


---

## 8. 部署

> Ubuntu 22.04 的完整流程（scp 上传、Git 部署、首次启动、systemd、反向代理/HTTPS、后续更新、注意事项）
> 单独写在了 **[`DEPLOY-ubuntu.md`](DEPLOY-ubuntu.md)**，照着做即可；下面只留要点。

### 8.1 Linux（systemd）

```ini
# /etc/systemd/system/xiangyu-api.service
[Unit]
Description=xiangyu-xinxu API
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/xiangyu/server
EnvironmentFile=/opt/xiangyu/server/.env
ExecStart=/opt/xiangyu/server/.venv/bin/python run.py
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
cd /opt/xiangyu/server
uv sync                     # 有 uv.lock 时可加 --frozen；没有 lock 文件就别加
sudo systemctl daemon-reload
sudo systemctl enable --now xiangyu-api
sudo systemctl status xiangyu-api && journalctl -u xiangyu-api -f
```

### 8.2 Windows

推荐用仓库自带的两个脚本（无第三方依赖，自带看门狗）：

```powershell
cd D:\Code\jzzb\server

.\start.ps1                 # 前台跑，Ctrl+C 停（调试用）
.\start.ps1 -Background     # 后台跑，关掉终端也不影响；退出后 3 秒自动拉起
.\start.ps1 -Port 8010      # 换端口

.\stop.ps1                  # 停掉看门狗 + 服务（先停看门狗，否则它会把服务拉起来）
```

后台模式的产物都在 `logs\`：

| 文件 | 内容 |
| --- | --- |
| `logs\server.log` | uvicorn 日志（UTF-8，超过 5MB 自动轮转为 `server.log.1`） |
| `logs\watchdog.log` | 每次进程退出记一行：时间、退出码、运行时长 —— **排查「服务为什么停了」先看这个** |
| `logs\watchdog.pid` | 看门狗进程号 |

> 看日志注意编码：PowerShell 5.1 的 `Get-Content` 默认按 ANSI 读，中文会花。
> 用 `Get-Content -Encoding UTF8 .\logs\server.log -Tail 20 -Wait`，或者用 VS Code 打开。

**开机自启（任务计划程序，可选）**

```powershell
schtasks /Create /TN "xiangyu-api" /SC ONSTART /RU SYSTEM /RL HIGHEST /F `
  /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File D:\Code\jzzb\server\start.ps1 -WatchDog"
```

**注册成 Windows 服务（NSSM，可选）**

```powershell
nssm install xiangyu-api "D:\Code\jzzb\server\.venv\Scripts\python.exe" "D:\Code\jzzb\server\run.py"
nssm set xiangyu-api AppDirectory "D:\Code\jzzb\server"
nssm start xiangyu-api
```

Windows 上反向代理可以用 IIS + URL Rewrite / ARR，也可以把服务放到 WSL / 另一台机器上，
由你惯用的反代软件转发。

防火墙只需放行 80 / 443；`PORT` 那个端口只给本机代理访问，不要对外开放。

### 8.3 服务跑一段时间就停了？按这个顺序查

先看 `logs\watchdog.log`，它会告诉你进程是**怎么退出的**：

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 反向代理返回 **502**，页面拿到一段 HTML 错误页 | 后端没在监听（进程停了 / 端口不对 / 只绑了 127.0.0.1 而代理在别的机器） | `.\start.ps1 -Background`，再 `curl http://127.0.0.1:8000/healthz` 确认 |
| 日志里有 `exited code=-1` / `code=1`，运行时长很短 | 启动就失败（端口被占、DB 被占、配置错） | 看 `logs\server.log` 里第一段 traceback |
| 日志里有 `exited code=0`，时长也不短 | 被别人正常停掉了（Ctrl+C、任务管理器结束进程、终端里 `Ctrl+Break`） | 用 `.\start.ps1 -Background` 跑，脱离终端 |
| `watchdog.log` 里**没有**退出记录，进程却没了 | 看门狗本身被杀了（关终端、结束进程树） | 同上，后台模式；或注册成服务 |
| 终端里看起来「卡住不动」 | Windows 控制台的快速编辑模式：鼠标在窗口里选中了文本，输出被暂停 | 在窗口里按 Esc 或按一下回车；长期运行别用前台模式 |

**另外两个坑：**

- **不要在服务运行期间执行 `uv sync` / `uv add`**。uv 会重建 `.venv`，正在运行的进程加载的 DLL 被替换/删除，服务可能直接崩掉。要装依赖先 `.\stop.ps1`。
- **别用 `uv run` 常驻**。`uv run python run.py` 多一层父进程，uv 自身退出或重新同步环境都会牵连服务；`start.ps1` 直接调用 `.venv\Scripts\python.exe`，链路更短。


---

## 9. 微信登录与支付

### 9.1 登录

| 配置 | 行为 |
| --- | --- |
| `WECHAT_APPID` / `WECHAT_SECRET` 为空（默认） | **演示登录**：不调微信接口，固定返回演示用户 `user-0001` / `13800138000`，方便本地联调 |
| 两者都配了 | 真实流程：`loginCode` → `jscode2session` 换 `openid`；`phoneCode` → `phonenumber.getPhoneNumber` 换手机号；按 `openid` 建号并签发 token |

- `loginCode` 必传，缺失返回 `40001`；`phoneCode` 可缺（拿不到手机号时 `phone` 为 `null`，前端会当作未登录）。
- 真实模式要求小程序是**已认证主体**，且在后台「用户隐私保护指引」里声明了手机号用途。
- token 是服务端随机串，存 `auth_tokens` 表，默认 30 天（`TOKEN_TTL_SECONDS`）。

### 9.2 支付

默认 `WECHAT_PAY_ENABLED=false`：`createOrder` 与 `/pay` 都返回 `payParams: null`，小程序自动走模拟支付。
个人主体小程序**无法**开通微信支付，这个默认值就是给它准备的。

要接真支付：

```bash
uv sync --extra pay          # 装 cryptography（RSA 签名 + AES-GCM 解密）
```

然后配齐 `WECHAT_PAY_APPID`、`WECHAT_PAY_MCHID`、`WECHAT_PAY_SERIAL_NO`、
`WECHAT_PAY_PRIVATE_KEY_PATH`（商户 API 私钥 pem）、`WECHAT_PAY_API_V3_KEY`（32 字节）、
`WECHAT_PAY_NOTIFY_URL`（公网 https，指向 `/api/notify/wechat-pay`），把 `WECHAT_PAY_ENABLED` 设为 `true`。

> ⚠️ `app/services/pay.py` 的签名逻辑按微信支付 v3 文档实现，但**没有真实商户号无法验证**。
> 上线前必须用商户沙箱或 1 分钱实测：统一下单、`wx.requestPayment`、回调验签、重复回调幂等。
> 另外强烈建议配 `WECHAT_PAY_PLATFORM_CERT_PATH`（平台证书 pem），否则回调**不验签**，任何人都能伪造「支付成功」。


---

## 10. 测试

```bash
cd server
uv run pytest
```

`tests/test_api.py` 覆盖文档里 15 个接口的**字段结构**和主要异常分支（用临时 SQLite，不碰 `data/app.db`）。
跑完输出类似：

```
19 passed
```

手工核对某一条也可以直接 curl：

```bash
curl -X POST http://127.0.0.1:8000/api/goods/orders \
  -H 'Content-Type: application/json' \
  -d '{"goodsId":"goods-01","count":2,"addressId":"addr-1",
       "address":{"name":"张三","phone":"13800138000",
                  "region":["江西省","赣州市","龙南县"],"detail":"围屋村 1 号"}}'
```


---

## 11. 已知限制 / 可以继续做的

| 项 | 现状 | 后续 |
| --- | --- | --- |
| 拼贴合成（3.3） | 只记录排版并返回占位地址 `/work/{workId}.png`，不做像素合成 | 接 Pillow / 独立渲染服务，替换 `image_url` 来源即可，接口结构不用动 |
| 媒体文件 | 图片音频仍由 CDN / 反向代理提供，本服务不托管 | 也可以挂 `StaticFiles` 到 `/media`，再把 `MEDIA_BASE_URL` 指过来 |
| 并发与扩展 | 单进程 + SQLite，适合一台机器的小程序 | 多实例部署要换 PostgreSQL，并把 `db.py` 换成 SQLAlchemy / asyncpg |
| 管理后台 | 没有 | 商品 / 点位 / 标签目前改 `seed_data.py` 或直接改库 |
| 分页 | 没实现，数据量小 | 按文档 5.4 加可选 `page` / `pageSize` 即可 |
| 支付 | 代码就绪但未实测 | 见 9.2 |
| 用户地址 | 仍存小程序本地 storage（文档 1.5 的约定） | 要同步多端再开接口 |
