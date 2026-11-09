# 配置说明（`.env` 逐项）

服务启动时从 **`server/.env`** 读取配置（路径按代码位置算，和你在哪个目录启动无关）。
全部配置项都在 `app/config.py`，`.env.example` 是完整模板。

---

## 0. 先搞清 5 条规则

1. **优先级**：环境变量 > `server/.env` > 代码里的默认值。
   临时改一个值：`HOST=127.0.0.1 PORT=8000 uv run python run.py`（Linux）/ `$env:HOST='127.0.0.1'`（Windows）。
2. **`.env` 可以不存在**：不存在就用全套默认值，本机开发直接能跑。上线再 `cp .env.example .env`。
3. **改完必须重启**：配置在启动时读一次并缓存，热改文件不生效。
   `sudo systemctl restart xiangyu-api` / Windows 下 `.\stop.ps1; .\start.ps1 -Background`。
4. **格式**：一行一个 `KEY=VALUE`，`#` 开头是注释。布尔写 `true` / `false`。
   值里含空格（如 `APP_NAME=乡语新叙 API`）不用加引号；**不要**写 `export`。
5. **`.env` 不提交 git**（已在 `.gitignore`），含密钥时 `chmod 600`。

---

## 1. 基础

| 变量 | 默认 | 作用 | 什么时候要改 |
| --- | --- | --- | --- |
| `APP_NAME` | `乡语新叙 API` | 服务名，出现在 `/docs` 标题、`/healthz` 的 `service` 字段、启动日志 | 一般不改 |
| `HOST` | `0.0.0.0` | 监听地址。`0.0.0.0` = 所有网卡；`127.0.0.1` = 只允许本机 | **反代和应用同机 → 改 `127.0.0.1`**（更安全）；反代在别的机器 / 容器里 → 保持 `0.0.0.0` |
| `PORT` | `8000` | 唯一对外端口 | 端口冲突时改；改完**代理的 upstream 要同步改** |
| `FORWARDED_ALLOW_IPS` | `*` | 信任哪些来源的 `X-Forwarded-*`（uvicorn 的 `forwarded_allow_ips`，可写逗号分隔的 IP） | 同机代理改成 `127.0.0.1`；多级代理写代理的 IP。太宽会让客户端可以伪造 IP |
| `API_PREFIX` | `/api` | 接口前缀。服务同时把路由挂在根路径，所以剥不剥前缀都能用 | **必须和小程序 `utils/api.js` 的 `BASE_URL` 结尾一致**（默认都是 `/api`）。改成空串则只有根路径 |
| `ROOT_PATH` | 空 | 服务挂在域名子路径时的外部前缀（如 `/xiangyu`），只影响 `/docs`、OpenAPI 里生成的地址 | 反代把 `https://域名/xiangyu/api/...` 转成 `/api/...` 时填 |
| `LOG_LEVEL` | `INFO` | 日志级别 | 排查问题用 `DEBUG`；想安静用 `WARNING`（会把每请求一条的访问日志也静音）；生产建议 `INFO` |
| `TIMEZONE` | `Asia/Shanghai` | 所有接口时间字符串（`YYYY-MM-DD HH:mm:ss`）和订单号里的日期 | 部署到海外服务器时改。**不依赖系统时区**，但日志时间戳用系统时区 |
| `DOCS_ENABLED` | `true` | 是否暴露 `/docs`、`/redoc`、`/openapi.json` | 生产环境建议 `false` |
| `CORS_ORIGINS` | `*` | 允许跨域的来源，逗号分隔 | 小程序不走浏览器，**不需要 CORS**；留着只为浏览器调试。要收紧就写具体域名 |

> `HOST` / `PORT` 改错最典型的症状：本机 `curl` 通、域名 502（或反过来）。

---

## 2. 存储

| 变量 | 默认 | 作用 | 什么时候要改 |
| --- | --- | --- | --- |
| `DATA_DIR` | `./data` | 数据目录，相对路径以 `server/` 为基准 | 想放到别的磁盘时改；必须是运行用户可写 |
| `DB_PATH` | 空 | 指定 SQLite 文件路径，留空 = `{DATA_DIR}/app.db` | Docker/K8s 挂 volume 时用绝对路径，例如 `/var/lib/xiangyu/app.db` |
| `SEED_ON_STARTUP` | `true` | 每次启动都补种子数据（`INSERT OR IGNORE`，不会覆盖已有行） | 生产可以留 `true`，无害；想完全不动数据就 `false` |
| `SEED_DEMO_DATA` | `true` | 是否插入 3 条演示订单（`ORD-20250315-0001` 等） | 真实运营前想干净些就 `false`（**已插入的不会自动删除**，要清就 `uv run python -m app.seed --force --orders`） |

数据目录里会有三个文件：`app.db`、`app.db-wal`、`app.db-shm`（WAL 模式），备份要一起考虑，
推荐 `sqlite3 data/app.db ".backup 'backup/app-$(date +%F).db'"`。

---

## 3. 登录态与订单行为

| 变量 | 默认 | 作用 | 什么时候要改 |
| --- | --- | --- | --- |
| `AUTH_REQUIRED` | `false` | 是否强制校验 token | **默认 false 是因为小程序目前不发 `Authorization` 头**（`utils/api.js` 只带 `content-type`）。等前端补上 token 注入后改 `true`，否则未登录用户连商品列表都拉不到 |
| `TOKEN_TTL_SECONDS` | `2592000`（30 天） | 登录 token 有效期 | 想快点过期就调小；过期后前端需重新点一次「手机号登录」 |
| `DEMO_USER_ID` | `user-0001` | 演示用户 ID | 一般不改 |
| `DEMO_USER_PHONE` | `13800138000` | 演示用户手机号（前端「我的」页显示这个） | 可改成你的测试号 |
| `DEMO_USER_NICKNAME` | `围山访客` | 演示用户昵称 | 可改 |
| `MOCK_PAY_AUTO_CONFIRM` | `true` | 未开启微信支付时，调 `/goods/orders/{id}/pay` 是否直接把订单置为 `paid` | 默认 `true`：小程序拿到 `payParams: null` 会自己判定「支付成功」，服务端跟着置为已付款，两端状态一致。**想保留"待付款"等以后接真支付，就设 `false`** |
| `NOT_FOUND_AS_NULL` | `true` | 按 ID 查详情没命中时（标签/商品/点位）返回什么 | `true` → `{code:0, data:null}`，页面走空态（和小程序 mock 行为一致）；`false` → 按 `API_DOC.md` 返回 `40400` |

> `AUTH_REQUIRED=false` 时，**所有没有 token 的写操作都记在演示用户名下**（下单、拼贴、扫码上报）。
> 这是为了让 demo 能跑通；上线前要么配微信登录 + 前端注入 token 并打开强校验，要么接受这一点。

---

## 4. 静态资源（图片 / 音频）

| 变量 | 默认 | 作用 | 什么时候要改 |
| --- | --- | --- | --- |
| `MEDIA_SOURCE_BASE` | `https://cdn.example.com/xiangyu-xinxu` | 种子数据里的占位域名前缀 | 一般不改。除非你直接改 `app/seed_data.py` 里的地址 |
| `MEDIA_BASE_URL` | 空 | 对外暴露的真实前缀。配了以后，所有响应里以 `MEDIA_SOURCE_BASE` 开头的 URL 自动替换成它 | **上线必配**。不用 CDN 就填 `https://你的域名/media`；用对象存储/CDN 就填那个前缀。改完重启生效，**不用重新导入种子数据** |
| `MEDIA_DIR` | `./media` | 媒体文件根目录（相对路径以 `server/` 为基准）。服务启动时创建并挂到 `/media` | 想把素材放别的磁盘时改；必须是运行用户可写 |
| `MEDIA_CACHE_SECONDS` | `0` | 媒体缓存策略。`0` = 禁用缓存，每次 200 + 完整内容、**不返回 304**；`>0` = 允许客户端缓存 N 秒并走 304 协商 | 默认 0 是为了避开微信开发者工具对图片 304 处理不一致的问题。生产环境想省流量可设 `86400` |

**这个项目不需要 CDN。** 图片和音频可以直接由这个服务发出去，和接口共用同一个域名、同一个端口：

```
接口返回的地址   https://你的域名/media/goods/1-1.png
实际读取的文件   {MEDIA_DIR}/goods/1-1.png
```

也就是说 `MEDIA_BASE_URL=https://你的域名/media`，然后把文件按种子数据里的目录丢进
`server/media/{goods,spot,audio,template,material,nfc,work}/` 即可，文件名要和 `seed_data.py` 里的一致。

**商品图命名**：`{商品序号}-{图序号}.png` —— `n-1` 是封面，`n-2` / `n-3` 是详情长图。
序号 1..5 和 goodsId 的对应关系写在 `app/seed_data.py` 顶部
（1=goods-01 围屋冰箱贴、2=goods-03 擂茶礼盒、3=goods-02 明信片、4=goods-04 帆布袋、5=goods-05 书签），
列表顺序由同一个文件里的 `sortOrder` 控制。改完要 `python -m app.seed --force` 才会写进库。

什么时候才值得上 CDN / 对象存储：图片音频体积大、访问量大、需要就近加速或省服务器带宽。
小程序阶段一个人测试，服务直出完全够用。

配完之后别忘了在小程序后台把该域名同时加进 **request** 和 **downloadFile** 合法域名，
否则真机不加载图、不播放音频。留空 `MEDIA_BASE_URL` 则原样返回占位域名 `cdn.example.com`，图片必然裂。

---

## 5. 微信小程序登录

| 变量 | 默认 | 作用 | 什么时候要改 |
| --- | --- | --- | --- |
| `WECHAT_APPID` | 空 | 小程序 AppID | 要真实登录才配 |
| `WECHAT_SECRET` | 空 | 小程序 AppSecret（**机密**） | 同上 |
| `WECHAT_API_BASE` | `https://api.weixin.qq.com` | 微信开放接口域名 | 一般不改；调试打桩/走代理时才改 |

**判定规则**：`WECHAT_APPID` 和 `WECHAT_SECRET` **任一为空** → 演示登录（不联网，固定返回演示用户）；
两者都配了 → 真实流程：`loginCode` 换 `openid`、`phoneCode` 换手机号。

真实登录的前置条件（文档 3.14 有详述）：小程序已认证主体、后台「用户隐私保护指引」声明手机号用途。
个人主体拿不到手机号。

---

## 6. 微信支付 v3

默认全关。个人主体小程序无法开通微信支付，这一组留着即可。
开启前先装可选依赖：`uv sync --frozen --extra pay`（装 `cryptography`）。

| 变量 | 默认 | 作用 | 注意 |
| --- | --- | --- | --- |
| `WECHAT_PAY_ENABLED` | `false` | 支付总开关 | `false` 时 `/pay` 返回 `payParams: null`，前端走模拟支付 |
| `WECHAT_PAY_APPID` | 空 | 支付用 AppID | 留空则回落到 `WECHAT_APPID` |
| `WECHAT_PAY_MCHID` | 空 | 商户号 | 与小程序 AppID 需完成绑定 |
| `WECHAT_PAY_SERIAL_NO` | 空 | 商户 API 证书序列号 | 在商户平台「API 安全」里查 |
| `WECHAT_PAY_PRIVATE_KEY_PATH` | 空 | 商户 API 私钥 `apiclient_key.pem` 的**绝对路径** | 文件放服务器上，`chmod 600`，**不要提交 git** |
| `WECHAT_PAY_API_V3_KEY` | 空 | APIv3 密钥（32 字节） | 回调解密用；必须正好 32 字节，否则回调解密报错 |
| `WECHAT_PAY_NOTIFY_URL` | 空 | 支付结果回调地址 | **公网可访问的 https**，指向 `https://域名/api/notify/wechat-pay`；必须是 https 且不带端口 |
| `WECHAT_PAY_PLATFORM_CERT_PATH` | 空 | 微信支付平台证书 `pem` 路径 | 配了才校验回调签名。**不配会跳过验签**，任何人都能伪造「支付成功」 |
| `WECHAT_PAY_DESCRIPTION_PREFIX` | `乡语新叙文创` | 订单商品描述前缀 | 最终形如 `乡语新叙文创-客家围屋冰箱贴`；微信限制 127 字节 |

支付这段代码按 v3 文档实现，但**没有真实商户号无法验证**。上线前务必用沙箱或 1 分钱实测：
统一下单 → `wx.requestPayment` → 回调验签 → 重复回调幂等。

---

## 7. 一份可用的生产配置

同机反向代理 + 不接支付 + 演示登录（当前阶段最省事）：

```ini
# 基础
HOST=127.0.0.1
PORT=8000
API_PREFIX=/api
FORWARDED_ALLOW_IPS=127.0.0.1
ROOT_PATH=
LOG_LEVEL=INFO
TIMEZONE=Asia/Shanghai
DOCS_ENABLED=false
CORS_ORIGINS=*

# 存储
DATA_DIR=./data
SEED_ON_STARTUP=true
SEED_DEMO_DATA=true

# 登录与行为
AUTH_REQUIRED=false
MOCK_PAY_AUTO_CONFIRM=true
NOT_FOUND_AS_NULL=true
TOKEN_TTL_SECONDS=2592000

# 静态资源
MEDIA_BASE_URL=https://cdn.你的域名.com/xiangyu

# 微信（不配就是演示登录）
WECHAT_APPID=
WECHAT_SECRET=

# 微信支付（暂时关闭）
WECHAT_PAY_ENABLED=false
```

---

## 8. 配错了会看到什么

| 现象 | 大概率是 |
| --- | --- |
| 所有接口 404，返回 JSON `{"code":40400}` | `API_PREFIX` 和小程序 `BASE_URL` 结尾不一致，或代理多剥/没剥 `/api` |
| 502 / 503，页面是代理自己的错误页 | 后端没起来（`curl 127.0.0.1:8000/healthz`）、`PORT` 不一致、代理容器里 `127.0.0.1` 指向自己 |
| 图片、音频全部不显示 | `MEDIA_BASE_URL` 没配（或配错），或小程序后台没加 downloadFile 合法域名 |
| 下单/上报返回 500，日志有 `readonly database` | `data/` 属主不是运行用户：`sudo chown -R xiangyu:xiangyu /opt/xiangyu/server/data` |
| 登录成功但「我的」页仍显示未登录 | 真实登录模式下没传 `phoneCode`，`phone` 为 `null`，前端据此判定未登录 |
| `/docs` 打不开 | `DOCS_ENABLED=false` |
| 接口时间差 8 小时 | `TIMEZONE` 写错，或前端自己用本地时间拼了字符串 |
| 改了 `seed_data.py` 里的文案，重启没变化 | 种子是 `INSERT OR IGNORE`；执行 `uv run python -m app.seed --force` |
| 扫码上报的 `client_ip` 全是代理 IP | 代理没透传 `X-Forwarded-For`，或 `FORWARDED_ALLOW_IPS` 没包含代理 |
| 支付回调一直重推 | `/api/notify/wechat-pay` 返回的不是 `{"code":"SUCCESS"}`，或 `WECHAT_PAY_API_V3_KEY` 不是 32 字节 |
| 「AI 生成家庭插画」报 `插画生成失败` | `media/material/` 里的插画素材被删了（本地合成要用）；看日志里 `家庭插画合成失败` 的 traceback |
| 点了「AI 生成」一直转圈 | 外部图生图（配了 `IMAGE_API_KEY`）超时；前端超时 115s，上游超时会回落本地合成 |

---

## 9. AI 生图（可选）

四个变量，全部可以留空——**留空就是本地合成，不联网、不花钱**。

| 变量 | 默认 | 作用 |
| --- | --- | --- |
| `IMAGE_API_BASE` | `https://aiapi.shiwuyan.cn/v1` | 外部图生图服务地址（OpenAI 兼容），只有配了 key 才会用到 |
| `IMAGE_API_KEY` | 空 | **留空 = 本地合成**（Pillow + `media/material/1..4.jpg`）；填了才调外部服务，失败自动回落本地 |
| `IMAGE_MODEL` | `gpt-image-2` | 以 `gpt-image-` 开头走 `/images/edits`，否则走 `/chat/completions` 多模态 |
| `IMAGE_TIMEOUT_SECONDS` | `100` | 等上游的超时；小程序侧请求超时是 115 秒，别配得比它大 |

本地合成的输出：1080×1440 JPEG，约 100–300KB，耗时 <1s，落在 `media/work/`。
童趣模板取 `1.jpg`/`2.jpg`（彩稿）做模糊底纹，复古模板取 `3.jpg`/`4.jpg`（线稿），
每次随机挑一张，所以同一张拼贴多生成几次底纹会略有不同。
