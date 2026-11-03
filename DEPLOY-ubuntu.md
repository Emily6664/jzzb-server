# 部署到 Ubuntu 22.04

本文按「一台干净的 Ubuntu 22.04 + 反向代理 + HTTPS」写完整流程，全部命令可直接复制。
Windows 本地打包上传，服务器上解包运行，不依赖 git。

- 应用目录：`/opt/xiangyu/server`
- 运行用户：`xiangyu`（专用、无 sudo）
- 监听：`127.0.0.1:8000`（同机 Nginx 反代；代理在别的机器才改 `0.0.0.0`）
- 数据库：`/opt/xiangyu/server/data/app.db`（SQLite，首次启动自动建表 + 种数据）

> 下文用 `HOST` 表示服务器 IP/域名，`$DOMAIN` 表示对外域名（例如 `ecg.proxy.lc.cygnomatic.net`）。

---

## 0. 一次性准备（服务器）

```bash
sudo apt update
sudo apt install -y nginx sqlite3 curl

# 专用用户
sudo useradd -m -s /bin/bash xiangyu
sudo mkdir -p /opt/xiangyu/server
sudo chown -R xiangyu:xiangyu /opt/xiangyu

# 用这个用户装 uv（装到 ~/.local/bin/uv，不需要 root）
sudo -iu xiangyu
curl -LsSf https://astral.sh/uv/install.sh | sh
source ~/.bashrc
uv --version
exit
```

Ubuntu 22.04 自带 Python 3.10，满足 `requires-python >= 3.10`，不用另装。
（想要 3.12：`uv python install 3.12`，之后 `uv sync --python 3.12`。）

---

## 1. 本地打包并 scp 上传

在 Windows PowerShell 里（`scp` 是 Win10+ 自带的 OpenSSH）：

```powershell
cd D:\Code\jzzb

# 打包：排除 .venv / logs / data / 缓存。venv 必须排除——它里面是全平台绝对路径，
# 拷过去也用不了；data 排除是为了以后更新时不会覆盖线上数据库。
tar -czf server.tgz `
  --exclude=.venv `
  --exclude=logs `
  --exclude=data `
  --exclude=__pycache__ `
  --exclude=.pytest_cache `
  --exclude=.env `
  server

scp server.tgz xiangyu@HOST:/tmp/
```

服务器上解包：

```bash
cd /opt/xiangyu
tar -xzf /tmp/server.tgz          # 展开成 /opt/xiangyu/server/...
rm /tmp/server.tgz
ls server                          # app  tests  pyproject.toml  uv.lock  run.py  README.md  start.ps1 ...
```

> 也可以用 `scp -r` 直接拷目录，但**目标目录已存在时会嵌套**（`server/app/app`），
> 所以推荐打包这一种。真想 `scp -r`，先删掉目标目录再拷：
> `ssh xiangyu@HOST 'rm -rf /opt/xiangyu/server && mkdir -p /opt/xiangyu/server'` 之后再 `scp -r .\server\* xiangyu@HOST:/opt/xiangyu/server/`。

---

## 2. 首次启动

```bash
sudo -iu xiangyu
cd /opt/xiangyu/server

# 按 uv.lock 还原虚拟环境，不装开发依赖（pytest）
uv sync --frozen --no-dev

# 配置（.env 已被打包排除，这里从模板生成）
cp .env.example .env
chmod 600 .env
nano .env
```

`.env` 至少要改这几行（同机反代时 `HOST` 用 `127.0.0.1` 更安全）：

```ini
HOST=127.0.0.1
PORT=8000
API_PREFIX=/api
DOCS_ENABLED=false
AUTH_REQUIRED=false
MEDIA_BASE_URL=https://cdn.你的域名.com/xiangyu
```

先前台跑一遍，确认真能起来：

```bash
cd /opt/xiangyu/server
.venv/bin/python run.py
# 另开一个终端：
#   curl http://127.0.0.1:8000/healthz
#   curl http://127.0.0.1:8000/api/goods/list
# 看到 {"code":0,...,"status":"ok"} 就 Ctrl+C
```

首次启动会打印 `种子数据就绪：{...}`，并在 `data/` 下生成 `app.db`。

---

## 3. 注册 systemd 服务

```bash
sudo tee /etc/systemd/system/xiangyu-api.service > /dev/null <<'EOF'
[Unit]
Description=xiangyu-xinxu API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=xiangyu
Group=xiangyu
WorkingDirectory=/opt/xiangyu/server
Environment=PYTHONUNBUFFERED=1
ExecStart=/opt/xiangyu/server/.venv/bin/python run.py
Restart=always
RestartSec=3
KillSignal=SIGINT
TimeoutStopSec=20

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now xiangyu-api
sudo systemctl status xiangyu-api --no-pager
journalctl -u xiangyu-api -f        # 实时日志
```

要点：

- `ExecStart` 直接用 `.venv/bin/python`，**不要写成 `uv run ...`**——uv 会多一层父进程，且可能重同步环境，长期运行不稳。
- `.env` 由应用自己从 `server/.env` 读取（路径按代码位置计算，和 `WorkingDirectory` 无关），所以不需要 systemd 的 `EnvironmentFile`。
- `Restart=always` 已经覆盖了 Windows 那个看门狗的作用；`logs/` 目录在这里用不到。

---

## 4. Nginx 反向代理 + HTTPS

```bash
sudo tee /etc/nginx/sites-available/xiangyu <<'EOF'
server {
    listen 80;
    server_name $DOMAIN;

    client_max_body_size 10m;

    # 根路径：返回后端那个只写着 OK 的页面
    location = / {
        proxy_pass http://127.0.0.1:8000;
        access_log off;
    }

    location /api/ {
        # 结尾不带 / → 原样转发 /api/...，和 BASE_URL=https://$DOMAIN/api 对应
        proxy_pass http://127.0.0.1:8000;

        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host  $host;

        proxy_connect_timeout 5s;
        proxy_read_timeout   30s;
    }

    # 健康检查（可选对外）
    location = /healthz {
        proxy_pass http://127.0.0.1:8000/healthz;
        access_log off;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/xiangyu /etc/nginx/sites-enabled/xiangyu
sudo nginx -t && sudo systemctl reload nginx

sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d $DOMAIN
```

验证：

```bash
curl -i http://127.0.0.1:8000/healthz          # 后端本身
curl -i https://$DOMAIN/                        # 应返回只显示 OK 的 HTML
curl -s https://$DOMAIN/api/goods/list | head -c 200
```

---

## 5. 后续更新

代码改完后（Windows 本地），重新打包上传、解包、重启即可。`data/` 和 `.env` 都不会被覆盖：

```powershell
cd D:\Code\jzzb
tar -czf server.tgz --exclude=.venv --exclude=logs --exclude=data --exclude=__pycache__ --exclude=.pytest_cache --exclude=.env server
scp server.tgz xiangyu@HOST:/tmp/
```

```bash
ssh xiangyu@HOST
cd /opt/xiangyu
tar -xzf /tmp/server.tgz && rm /tmp/server.tgz
sudo systemctl restart xiangyu-api
systemctl status xiangyu-api --no-pager
curl -s http://127.0.0.1:8000/healthz
```

几点：

- **只改了代码，没改 `pyproject.toml` / `uv.lock`** → 不用 `uv sync`，重启即可。
- **改了依赖** → 先在服务器上 `uv sync --frozen --no-dev`（或本地 `uv lock` 后把新的 `uv.lock` 一起传上去），再 `systemctl restart`。依赖变更时先停服务再 sync，避免运行中的进程被换掉 venv。
- **只改了一两个文件**，懒得打包：
  ```powershell
  scp .\server\app\routers\goods.py xiangyu@HOST:/opt/xiangyu/server/app/routers/
  ```
  ```bash
  ssh xiangyu@HOST 'sudo systemctl restart xiangyu-api'
  ```
- **同步整个目录、只要增量**（推荐，需要 rsync）：
  ```bash
  # 在 WSL / Git Bash 里执行
  rsync -avz --delete \
    --exclude .venv --exclude logs --exclude data --exclude __pycache__ --exclude .env \
    ./server/ xiangyu@HOST:/opt/xiangyu/server/
  ```
  `--delete` 会删掉服务器上多余的文件，但被 exclude 的三项不受影响。
- **改了 `app/seed_data.py`**（商品/点位/标签文案）：重启不会自动覆盖已有数据（种子是 `INSERT OR IGNORE`）。
  要强制重建参考数据：
  ```bash
  cd /opt/xiangyu/server
  .venv/bin/python -m app.seed --force        # 不动用户和订单
  # 连演示订单一起重建：--force --orders
  ```

---

## 6. 注意事项（踩过的坑）

### 6.1 权限

`data/` 必须归运行用户所有，否则下单、扫码上报写入失败（表现为 500 `服务异常`）：

```bash
sudo chown -R xiangyu:xiangyu /opt/xiangyu/server/data
ls -ld /opt/xiangyu/server/data       # drwxr-xr-x xiangyu xiangyu
```

`scp` 上去的文件默认是 `xiangyu` 自己的，一般没问题；但用 `sudo scp` / root 解包就会变成 root 所有，一定要 `chown`。

### 6.2 端口与防火墙

```bash
sudo ufw allow 'Nginx Full'      # 80 + 443
sudo ufw deny 8000               # 8000 只给本机代理用
sudo ufw enable
```

- 同机 Nginx：`HOST=127.0.0.1`（推荐，最省心）。
- 代理在另一台机器 / 容器里：`HOST=0.0.0.0`，同时用安全组只放行代理的 IP。

### 6.3 不要在服务运行时 `uv sync`

uv 会重建 `.venv`，正在运行的进程加载的 `.so` 被替换，服务会崩：

```bash
sudo systemctl stop xiangyu-api
uv sync --frozen --no-dev
sudo systemctl start xiangyu-api
```

### 6.4 数据库

- 三个文件：`data/app.db`、`data/app.db-wal`、`data/app.db-shm`。备份**不要**只拷 `app.db`（WAL 里可能还有未合并的数据）：
  ```bash
  cd /opt/xiangyu/server
  mkdir -p backup
  sqlite3 data/app.db ".backup 'backup/app-$(date +%F-%H%M).db'"
  ```
  或者先 `systemctl stop` 再整体拷贝 `data/`。
- 单写者模型：够这个项目用，但不要指望高并发；要扩多实例就换 PostgreSQL。
- 恢复：停服务 → 用备份覆盖 `data/app.db` → 删掉 `app.db-wal` / `app.db-shm` → 启动。

### 6.5 时区与时间

- 接口里的时间字符串由 `TIMEZONE`（默认 `Asia/Shanghai`）决定，**不依赖系统时区**。
- 但日志时间戳用系统时区，建议对齐：
  ```bash
  sudo timedatectl set-timezone Asia/Shanghai
  date
  ```

### 6.6 国内网络装依赖慢

```bash
export UV_DEFAULT_INDEX=https://pypi.tuna.tsinghua.edu.cn/simple
uv sync --frozen --no-dev
```

（旧版 uv 用 `UV_INDEX_URL`，两个都设上也无害。）

### 6.7 Nginx 细节

- `location = /` 一定要有，否则访问域名根路径不会到后端（会看到 Nginx 默认页）。
- `proxy_pass http://127.0.0.1:8000;` **结尾不要加 `/`**，否则 `/api` 前缀会被剥掉（后端虽然两种都支持，但保持一种）
- 二维码/图片走 CDN 的话，`MEDIA_BASE_URL` 要配成真实前缀，并在小程序后台加 downloadFile 合法域名。

### 6.8 小程序侧

`utils/api.js`：

```js
const USE_MOCK = false;
const BASE_URL = 'https://$DOMAIN/api';
```

小程序后台把 `https://$DOMAIN` 加进 **request 合法域名**（必须 HTTPS、已备案域名、不带端口和路径）。
怎么确认真的连到后端：见 `README.md` 5.6。

### 6.9 微信支付

默认关闭。要开启：`uv sync --frozen --extra pay`（装 cryptography），配齐 `WECHAT_PAY_*`，把 `WECHAT_PAY_NOTIFY_URL` 指到 `https://$DOMAIN/api/notify/wechat-pay`。详见 `README.md` 第 9 节。

---

## 7. 常用运维命令

```bash
sudo systemctl status xiangyu-api --no-pager    # 状态
sudo systemctl restart xiangyu-api              # 重启（改代码后必做）
sudo systemctl stop xiangyu-api                 # 停止
journalctl -u xiangyu-api -n 100 --no-pager     # 最近 100 行日志
journalctl -u xiangyu-api -f                    # 实时跟随
sudo systemctl disable --now xiangyu-api        # 取消开机自启

curl -s http://127.0.0.1:8000/healthz           # 后端存活
curl -s https://$DOMAIN/api/goods/list          # 反代链路
ss -ltnp | grep 8000                            # 谁在监听 8000
sqlite3 /opt/xiangyu/server/data/app.db "SELECT COUNT(*) FROM orders;"
```

---

## 8. 上线检查清单

- [ ] `systemctl status` 是 `active (running)`，且 `Restart=always` 生效
- [ ] `curl http://127.0.0.1:8000/healthz` 返回 `code: 0`
- [ ] `curl https://$DOMAIN/` 返回只显示 `OK` 的 HTML
- [ ] `curl https://$DOMAIN/api/goods/list` 返回 5 件商品
- [ ] `data/` 属主是 `xiangyu`，下单能成功（不是 500）
- [ ] `ufw` 只放行 80/443，8000 不对外
- [ ] `DOCS_ENABLED=false`（不想公开 `/docs` 就不配 Nginx 的 `/docs`）
- [ ] 小程序 `USE_MOCK=false`、`BASE_URL` 指向 `https://$DOMAIN/api`，域名已进合法域名
- [ ] 备份任务（cron 或手动 `sqlite3 .backup`）已安排
