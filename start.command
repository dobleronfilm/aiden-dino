#!/bin/bash
# Double-click to wake up the dino. It uses your Claude plan through Claude Code; no API key needed.
cd "$(dirname "$0")" || exit 1
export PATH="$HOME/.local/bin:$PATH"
echo "Waking up the dino..."

if ! command -v claude >/dev/null 2>&1; then
  echo
  echo "First time only: installing Claude Code, the dino's brain."
  curl -fsSL https://claude.ai/install.sh | bash
  export PATH="$HOME/.local/bin:$PATH"
fi

if ! claude auth status 2>/dev/null | grep -q '"loggedIn": true'; then
  echo
  echo "First time only: sign in with your Claude account in the browser window that opens."
  claude auth login
fi

if ! python3 -c 'import sys' >/dev/null 2>&1; then
  echo
  echo "Your Mac needs its free developer tools first."
  echo "Click Install in the pop-up window, wait for it to finish, then double-click start.command again."
  read -r -p "Press Return to close."
  exit 1
fi

python3 server.py
