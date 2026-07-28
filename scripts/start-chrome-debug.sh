#!/bin/bash
# 以调试模式启动一个独立的 Chrome 实例，供 Playwright 通过 CDP 接管。
# 关键：必须使用「独立 profile 目录」，不能用默认 profile
# （Chrome 136+ 会在默认 profile 下静默忽略 --remote-debugging-port）。
#
# 用法：
#   1) 先克隆一次已登录的 profile（保留登录态，仅首次需要）：
#      cp -Rc "$HOME/Library/Application Support/Google/Chrome" \
#              "$HOME/Library/Application Support/Google/Chrome-Debug"
#   2) 在终端执行本脚本：
#      bash start-chrome-debug.sh
#   3) 在打开的 Chrome 中登录 agency / 打开 ipgs+（保持香港 VPN）
#
# 调试端口：9223  用户数据目录：~/Library/Application Support/Google/Chrome-Debug
# 验证端口已监听： curl --noproxy '*' http://127.0.0.1:9223/json/version

PORT=9223
PROFILE="$HOME/Library/Application Support/Google/Chrome-Debug"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

if [ ! -d "$PROFILE" ]; then
  echo "⚠️  未找到调试 profile：$PROFILE"
  echo "    请先克隆已登录的 Chrome profile："
  echo "    cp -Rc \"$HOME/Library/Application Support/Google/Chrome\" \"$PROFILE\""
  exit 1
fi

# 若已存在同端口进程，先提示（不强制 kill，避免误杀用户正常 Chrome）
if curl -s --noproxy '*' "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then
  echo "ℹ️  端口 $PORT 已在监听，可能已有调试实例在运行。"
  exit 0
fi

open -a "$CHROME" --args --remote-debugging-port=$PORT --user-data-dir="$PROFILE" --no-first-run
echo "🚀 已尝试启动调试 Chrome（端口 $PORT）。请用香港 VPN 登录 ipgs+ 后运行生成脚本。"
