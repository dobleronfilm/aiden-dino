"""Runs Dino Buddy on this computer, using your Claude plan through Claude Code (no API key).

Start it with start.command. Uses only Python's standard library.
"""

import json
import re
import pathlib
import shutil
import subprocess
import sys
import tempfile
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = pathlib.Path(__file__).parent
PORT = 8000
WORKDIR = tempfile.mkdtemp(prefix="dino-")  # an empty folder, so Claude Code loads no project files

SAFETY_PROMPT = """You check replies from a talking toy dinosaur before they are spoken aloud to a 4-year-old who is afraid of the dark. Each message gives you what the child said and what the dinosaur wants to say. Judge only that one reply.
Unsafe means the reply: describes darkness, nighttime, deep black water, or lights going out; has scary, violent, or gory content, death, weapons, or animals chasing, biting, or eating someone; mentions alcohol, drugs, smoking, money, news, religion, politics, or adult topics; asks for or repeats personal information (last name, address, school, passwords, photos); tells the child to do something physical or risky, eat or drink anything, go outside, open a door, or leave the room; agrees to keep a secret from grown-ups; takes sides in a family conflict or gives medical advice; or claims to be a real, living animal.
Friendly pretend ghosts, fossil skeletons, happy roars, pirates, Lego, dinosaur facts, and the dinosaur happily accepting a name the child picks are safe.
Answer with exactly one word: SAFE or UNSAFE."""


class Chat:
    """One long-running Claude Code conversation, so each reply skips the startup wait."""

    def __init__(self, system, tools):
        cmd = ["claude", "-p", "--safe-mode", "--model", "haiku", "--effort", "low",
               "--no-session-persistence", "--input-format", "stream-json",
               "--output-format", "stream-json", "--verbose",
               "--system-prompt", system, "--tools", ",".join(tools)]
        if tools:
            cmd += ["--allowedTools", ",".join(tools)]
        self.proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     stderr=subprocess.DEVNULL, text=True, bufsize=1, cwd=WORKDIR)
        self.lock = threading.Lock()

    def ask(self, text):
        with self.lock:
            if self.proc.poll() is not None:
                raise RuntimeError("Claude Code stopped")
            msg = {"type": "user", "message": {"role": "user", "content": text}}
            self.proc.stdin.write(json.dumps(msg) + "\n")
            self.proc.stdin.flush()
            used_search = False
            for line in self.proc.stdout:
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if event.get("type") == "assistant":
                    for block in event.get("message", {}).get("content", []):
                        if block.get("type") == "tool_use" and block.get("name") == "WebSearch":
                            used_search = True
                if event.get("type") == "result":
                    if event.get("is_error"):
                        raise RuntimeError(str(event.get("result") or event.get("subtype")))
                    return (event.get("result") or "").strip(), used_search
            raise RuntimeError("Claude Code stopped")

    def close(self):
        try:
            self.proc.stdin.close()
            self.proc.terminate()
        except OSError:
            pass


dino = None
safety = None
chats_lock = threading.Lock()


def one_shot(system, prompt):
    out = subprocess.run(
        ["claude", "-p", "--safe-mode", "--model", "haiku", "--effort", "low", "--tools", "",
         "--no-session-persistence", "--output-format", "json", "--system-prompt", system],
        input=prompt, capture_output=True, text=True, cwd=WORKDIR, timeout=120)
    result = json.loads(out.stdout)
    if result.get("is_error"):
        raise RuntimeError(result.get("result"))
    return result.get("result", "")


def claude_status():
    if not shutil.which("claude"):
        return {"ok": False, "problem": "not_installed"}
    try:
        out = subprocess.run(["claude", "auth", "status"], capture_output=True, text=True, timeout=30)
        if json.loads(out.stdout).get("loggedIn"):
            return {"ok": True}
    except (OSError, ValueError, subprocess.TimeoutExpired):
        pass
    return {"ok": False, "problem": "not_signed_in"}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, *args):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _json(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _body(self):
        length = int(self.headers.get("Content-Length") or 0)
        try:
            return json.loads(self.rfile.read(min(length, 500_000)) or b"{}")
        except json.JSONDecodeError:
            return {}

    def do_GET(self):
        if self.path == "/api/status":
            version = (ROOT / "VERSION").read_text().strip() if (ROOT / "VERSION").exists() else "unknown"
            return self._json(200, {**claude_status(), "version": version})
        if self.path.endswith(".py") or "/." in self.path:
            return self._json(404, {"error": "not_found"})
        return super().do_GET()

    def do_POST(self):
        global dino, safety
        body = self._body()
        try:
            if self.path == "/api/session":
                with chats_lock:
                    for chat in (dino, safety):
                        if chat:
                            chat.close()
                    tools = ["WebSearch"] if body.get("webLookups") else []
                    dino = Chat(str(body.get("system", "")), tools)
                    safety = Chat(SAFETY_PROMPT, [])
                return self._json(200, {"ok": True})
            if self.path == "/api/ask":
                if not dino:
                    return self._json(409, {"error": "no_session"})
                text, used_search = dino.ask(str(body.get("text", ""))[:2000])
                return self._json(200, {"text": text, "usedSearch": used_search})
            if self.path == "/api/check":
                if not safety:
                    return self._json(409, {"error": "no_session"})
                verdict, _ = safety.ask(f"The child said: {body.get('child', '')}\n"
                                        f"The dinosaur wants to say: {body.get('dino', '')}")
                words = re.findall(r"[A-Z]+", verdict.upper())
                return self._json(200, {"safe": "SAFE" in words and "UNSAFE" not in words})
            if self.path == "/api/memory":
                text = one_shot(str(body.get("system", "")), str(body.get("prompt", "")))
                start, end = text.find("["), text.rfind("]")
                notes = json.loads(text[start:end + 1]) if start >= 0 else []
                return self._json(200, {"notes": [str(n) for n in notes][:12]})
        except Exception as err:  # report any failure to the page instead of hanging it
            print(f"Problem talking to Claude Code: {err}", file=sys.stderr)
            return self._json(500, {"error": str(err)[:300]})
        return self._json(404, {"error": "not_found"})


def main():
    status = claude_status()
    if not status["ok"]:
        print("Claude Code isn't ready yet. Run start.command again after signing in.")
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    url = f"http://localhost:{PORT}"
    print(f"\nThe dino is awake! Open {url} in Chrome or Safari.")
    print("Keep this window open while Aiden plays. Close it to put the dino to sleep.\n")
    webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        for chat in (dino, safety):
            if chat:
                chat.close()


if __name__ == "__main__":
    main()
