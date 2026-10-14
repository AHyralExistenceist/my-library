#!/bin/zsh
cd -- "$(dirname -- "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  echo 'Node.js를 먼저 설치해 주세요: https://nodejs.org/'
  read -r '?Enter 키를 눌러 닫기'
  exit 1
fi
echo 'My Library: http://127.0.0.1:4173'
echo 'Safari 또는 Chrome에서 위 주소를 여세요. 종료하려면 Control+C를 누르세요.'
node server.cjs
