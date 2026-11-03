"""启动脚本。

用法（在 server/ 目录下）：

    uv run python run.py                 # 用 .env / 环境变量里的 HOST、PORT 启动
    uv run python run.py --port 9000     # 临时换端口
    uv run python run.py --reload        # 开发模式，改代码自动重启

等价写法：uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

import argparse

import uvicorn

from app.config import get_settings


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="启动乡语新叙后端服务")
    parser.add_argument("--host", default=None, help="监听地址，默认取 HOST（0.0.0.0）")
    parser.add_argument("--port", type=int, default=None, help="监听端口，默认取 PORT（8000）")
    parser.add_argument("--reload", action="store_true", help="开发模式：代码变更自动重载")
    return parser.parse_args()


def main() -> None:
    settings = get_settings()
    args = parse_args()

    host = args.host or settings.host
    port = args.port or settings.port

    print(f"listening on http://{host}:{port}{settings.api_prefix or '/'}  (docs: /docs)")

    uvicorn.run(
        "app.main:app",
        host=host,
        port=port,
        reload=args.reload,
        root_path=settings.root_path or "",
        log_level=settings.log_level.lower(),
        # 反向代理后面才需要读 X-Forwarded-*；信任来源由 FORWARDED_ALLOW_IPS 控制
        proxy_headers=True,
        forwarded_allow_ips=settings.forwarded_allow_ips,
        timeout_keep_alive=30,
    )


if __name__ == "__main__":
    main()
