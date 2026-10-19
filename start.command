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

# Grab the newest version of the dino from GitHub, so updates arrive by themselves.
# Asking for the exact latest version skips GitHub's few-minute cache.
SHA=$(curl -fsSL --max-time 15 https://api.github.com/repos/dobleronfilm/aiden-dino/commits/main 2>/dev/null \
  | grep -m1 '"sha"' | sed -E 's/.*"sha": *"([0-9a-f]+)".*/\1/')
REF=${SHA:-main}
REPO="https://raw.githubusercontent.com/dobleronfilm/aiden-dino/$REF"
updated=0
for f in index.html style.css app.js tts-worker.js server.py start.command roar.mp3; do
  if curl -fsSL --max-time 20 "$REPO/$f" -o "$f.new" 2>/dev/null; then mv "$f.new" "$f"; updated=$((updated + 1)); else rm -f "$f.new"; fi
done
chmod +x start.command 2>/dev/null
[ -f dino.png ] || curl -fsSL --max-time 60 "$REPO/dino.png" -o dino.png 2>/dev/null
if [ "$updated" -gt 0 ] && [ -n "$SHA" ]; then
  echo "${SHA:0:7}" > VERSION
  echo "Dino is up to date (version ${SHA:0:7})."
else
  echo "Couldn't check for updates, so the dino is using the version already on this Mac."
fi

if ! python3 -c 'import sys' >/dev/null 2>&1; then
  echo
  echo "Your Mac needs its free developer tools first."
  echo "Click Install in the pop-up window, wait for it to finish, then double-click start.command again."
  read -r -p "Press Return to close."
  exit 1
fi

python3 server.py
