#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
PORT="${PORT:-8931}"
echo "启动 缠论炒股工作站 → http://127.0.0.1:${PORT}/"
exec env PORT="$PORT" node server/index.js
