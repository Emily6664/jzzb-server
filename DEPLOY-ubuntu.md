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

> 如果你打算用 Git 管理（推荐长期维护），可以**跳过 1~5 节的 scp 流程**，直接看 [第 9 节](#9-用-git-部署推荐)。
> 本节保留给「没有代码托管、就想拷文件上去」的场景。

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

---

## 9. 用 Git 部署（推荐）

仓库已经在 `D:\Code\jzzb\server` 初始化好了（分支 `main`，首次提交 `init: 乡语新叙后端服务…`，
`.venv` / `data` / `logs` / `.env` 已被 `.gitignore` 排除）。你只需要加一个远端。

### 9.1 本地：加远端并推第一次

```powershell
cd D:\Code\jzzb\server

# GitHub / Gitee / 自建 GitLab 都行（私有仓库建议用 SSH）
git remote add origin git@github.com:你的账号/xiangyu-server.git
git push -u origin main
```

还没建远端仓库？先在网页上建一个**空的**私有仓库（不要勾 README / .gitignore），再执行上面的命令。

> 如果不想用第三方托管，也可以直接推到服务器（见 9.5 的裸仓库方式），跳过 9.1 的 `origin`。

### 9.2 服务器：clone 下来

```bash
sudo -iu xiangyu
cd /opt/xiangyu

# 私有仓库：先给这个用户配只读部署密钥
ssh-keygen -t ed25519 -C "deploy@xiangyu" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
#   ↑ 把公钥加到 GitHub 仓库 Settings → Deploy keys（勾 Read only），不要加账号级 SSH key
ssh-keyscan github.com >> ~/.ssh/known_hosts      # 避免首次连接卡在 yes/no

git clone git@github.com:你的账号/xiangyu-server.git server
cd server
uv sync --frozen --no-dev
cp .env.example .env && chmod 600 .env && nano .env
```

之后照 [第 3 节](#3-注册-systemd-服务) 注册 systemd 服务即可。

> 用 HTTPS 拉取的话：`git clone https://github.com/你的账号/xiangyu-server.git server`，
> 私有仓库需要 Personal Access Token，且 token 会留在 `.git/config` 里——更推荐部署密钥。
>
> 用 `sudo git clone` 会把文件变成 root 所有，后面一律 `sudo chown -R xiangyu:xiangyu /opt/xiangyu/server`。

### 9.3 日常更新（pull 流程）

```bash
cd /opt/xiangyu/server
git pull --ff-only
sudo systemctl restart xiangyu-api
curl -s http://127.0.0.1:8000/healthz
```

偷懒的话把这三步存成 `/opt/xiangyu/server/deploy.sh`（**这个文件别提交进仓库**，服务器本地放就行）：

```bash
#!/usr/bin/env bash
set -euo pipefail
cd /opt/xiangyu/server

git pull --ff-only

# 依赖变了才需要重建环境；重建必须先停服务，否则运行中的进程会被换掉 .so
if ! git diff --quiet ORIG_HEAD -- pyproject.toml uv.lock 2>/dev/null; then
  echo "dependency files changed -> syncing venv"
  sudo systemctl stop xiangyu-api
  uv sync --frozen --no-dev
fi

sudo systemctl restart xiangyu-api
sleep 1
curl -fsS http://127.0.0.1:8000/healthz && echo " OK"
```

```bash
chmod +x deploy.sh
./deploy.sh
```

> `ORIG_HEAD` 是 `git pull` 之前的位置，用它判断这次拉取有没有动依赖文件，比"每次都 sync"安全得多。
> 如果 `uv` 不在 PATH（`sudo` / cron 环境常见），把 `uv` 写成绝对路径 `~/.local/bin/uv`。

### 9.4 依赖变更的完整流程

```bash
cd /opt/xiangyu/server
sudo systemctl stop xiangyu-api
git pull --ff-only
uv sync --frozen --no-dev
sudo systemctl start xiangyu-api
journalctl -u xiangyu-api -n 20 --no-pager
```

记住：**`git pull` 本身没有风险，`uv sync` 有**——它会重建 `.venv`。所以顺序永远是「停 → 拉 → sync → 起」。

### 9.5 不用第三方托管：裸仓库 + push 即部署

适合内网、或者不想把代码放到 GitHub 的情况。

服务器上建裸仓库和钩子：

```bash
sudo -iu xiangyu
mkdir -p ~/repos && cd ~/repos
git init --bare xiangyu-server.git

cat > xiangyu-server.git/hooks/post-receive <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
TARGET=/opt/xiangyu/server
while read -r oldrev newrev ref; do
  if [ "$ref" = "refs/heads/main" ]; then
    echo "deploying $newrev -> $TARGET"
    git --work-tree="$TARGET" --git-dir="$HOME/repos/xiangyu-server.git" checkout -f main
    sudo systemctl restart xiangyu-api
    curl -fsS http://127.0.0.1:8000/healthz && echo " OK" || echo "health check failed"
  fi
done
EOF
chmod +x xiangyu-server.git/hooks/post-receive
```

`xiangyu` 需要能免密重启这一个服务（只授权这一条命令，不给通用 sudo）：

```bash
echo 'xiangyu ALL=(root) NOPASSWD: /usr/bin/systemctl restart xiangyu-api' | sudo tee /etc/sudoers.d/xiangyu-api
sudo chmod 440 /etc/sudoers.d/xiangyu-api
sudo -u xiangyu sudo -n systemctl restart xiangyu-api     # 验证能免密执行
```

本地加远端并推：

```powershell
cd D:\Code\jzzb\server
git remote add deploy xiangyu@HOST:repos/xiangyu-server.git
git push deploy main
```

`/opt/xiangyu/server` 目录要先存在（`mkdir -p` 并 `chown xiangyu`）。钩子用的是 `checkout -f`，
**只覆盖仓库里的文件**，`data/`、`.env`、`logs/` 这些未跟踪文件不受影响。

> 这个钩子不会自动 `uv sync`——依赖变更时按 9.4 手动停服同步一次。这样最稳。

### 9.6 回滚

```bash
cd /opt/xiangyu/server
git log --oneline -10            # 找目标提交
git checkout <sha>               # 或者 git reset --hard <sha>（会丢掉本地改动）
sudo systemctl restart xiangyu-api
```

出问题先回滚再排查，比在线上 `debug` 快。回滚后想回到最新：`git checkout main && git pull --ff-only`。

### 9.7 Git 相关注意事项

| 事项 | 说明 |
| --- | --- |
| `.env` 不入库 | `.gitignore` 已排除；里面是密钥类配置。服务器上第一次手动 `cp .env.example .env`，以后 `git pull` 不会动它 |
| `uv.lock` 必须入库 | 它已经在仓库里；`uv sync --frozen` 靠它保证两边依赖一致。别把它加进 `.gitignore` |
| `data/` 不入库 | 线上数据库只存在于服务器，`git pull` / `checkout -f` 都不会碰它 |
| `logs/` 不入库 | Windows 下 `start.ps1` 写的日志目录 |
| 换行符 | 仓库里有 `.gitattributes`（`* text=auto eol=lf`），提交进库的是 LF。**不要**手动把 `.py` 改成 CRLF，否则 Linux 上 Python 虽然能跑，但 `start.ps1` 之外的脚本容易出诡异问题 |
| 文件属主 | 用 `git clone`（不是 `sudo git clone`）就没问题；不确定时 `sudo chown -R xiangyu:xiangyu /opt/xiangyu/server` |
| 别提交 `server/.env` 之外的东西 | 例如 `data/backup/*.db`、`logs/server.log`——都被 ignore 了，但注意别用 `git add -f` 硬加进去 |
| 敏感信息 | 支付私钥（`*.pem`）、`WECHAT_SECRET`、`WECHAT_PAY_API_V3_KEY` 只放服务器 `.env`，永不入库 |
| 分支 | `main` 即生产。想更稳可以加 `dev` 分支 + 一个 `release` 标签，服务器只跟标签（`git checkout <tag>`） |

---

## 10. 三种部署方式怎么选

| 方式 | 适合 | 更新命令 | 缺点 |
| --- | --- | --- | --- |
| **scp 打包**（第 1~5 节） | 一次性部署、服务器不能连外网 | 打包 → scp → 解包 → restart | 没有版本历史，容易传漏文件 |
| **Git pull**（9.1~9.4） | 日常迭代，推荐 | `./deploy.sh` | 服务器要能访问代码托管 |
| **裸仓库 push**（9.5） | 内网、不想用托管 | `git push deploy main` | 钩子要自己维护，多一台服务器的账号要配 |
