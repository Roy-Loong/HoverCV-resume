#!/bin/bash
cd -- "$(dirname -- "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' '请先从 https://nodejs.org/zh-cn/download 安装 Node.js 24 或更新版本，然后重新打开本文件。'
  read -r -p '按回车关闭窗口…'
  exit 1
fi
node scripts/local-preview.mjs
result=$?
if [ "$result" -ne 0 ]; then
  printf '%s\n' '请保留上方报错，方便排查。'
  read -r -p '按回车关闭窗口…'
fi
exit "$result"
