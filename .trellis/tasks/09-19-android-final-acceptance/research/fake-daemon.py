#!/usr/bin/env python3
"""FEATURE-558 · 假 runtime daemon（阶段 5 收尾验收用）

让本地后端（compose 项目 multica-probe542, http://127.0.0.1:8090）相信
`probe550-daemon` 这台机器在线，并为夹具 agent「Probe550 Agent」把聊天任务
真的跑完一轮 —— 「发消息 → 排队 → 运行中 → 助手回复」在设备上能真实发生。

只依赖 Python 3 标准库（urllib + threading）。用法见同目录 fake-daemon.md。

模式（每轮 claim 前重读一次模式文件，因此可以不重启进程切换）：
  success  起任务 → 发 2 批 task:message（tool_use / tool_result / thinking）→ 等几秒 → /complete
  fail     起任务 → /fail（failure_reason 默认 runtime_offline）
  pending  起任务 → 只发一条 tool_use 步骤，保持「运行中」不完成；模式切走后再收尾
  slow     同 success，但 /start 之前先等 15s（方便肉眼观察 pill）

模式来源：模式文件（默认 <本脚本目录>/.fake-mode，内容 success|fail|pending|slow）
优先；文件不存在 / 内容非法时回退到环境变量 FAKE_MODE（默认 success）。
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent

# ── 夹具默认值（与 seed-fixtures.sql / 探针夹具对齐）────────────────────────
DEF_BASE_URL = "http://127.0.0.1:8090"
DEF_EMAIL = "probe551@example.com"
DEF_CODE = "888888"
DEF_WORKSPACE_ID = "ab9300f7-4890-4bf7-b514-d56cb4f29d7c"  # workspace probe550
DEF_DAEMON_ID = "probe550-daemon"
DEF_RUNTIME_NAME = "Probe550 Runtime"
DEF_RUNTIME_TYPE = "claude-code"
DEF_CHAT_SESSION_ID = "55100000-0000-4000-8000-000000000061"  # Android 回归会话
DEF_OUTPUT = "FEATURE-558 流式夹具：助手回复已到达。"
DEF_FAIL_REASON = "runtime_offline"  # apps/mobile/lib/failure-reason-label.ts → "Daemon offline"
DEF_FAIL_ERROR = "fake-daemon: simulated runtime failure (FAKE_MODE=fail)."

MODES = ("success", "fail", "pending", "slow")

# 步骤消息的 type 必须落在客户端的 {thinking, tool_use, tool_result, error} 里才会
# 渲染成可见步骤行（apps/mobile/components/chat/chat-timeline.tsx StepRow 的
# default 分支返回 null），并且只有 tool_use 的 tool 名会变成 pill 文案
# （apps/mobile/components/chat/status-pill.tsx TOOL_LABELS：Read → "Reading files"，
# Bash/exec → "Running command"）。type == "text" 的行会被 chat-timeline 直接丢掉 ——
# 助手正文只在 chat:done 时以整条气泡出现。
STEP_MESSAGES: list[dict[str, Any]] = [
    {
        "seq": 1,
        "type": "tool_use",
        "tool": "Read",
        "input": {"file_path": "apps/mobile/components/chat/status-pill.tsx"},
    },
    {"seq": 2, "type": "tool_result", "tool": "Read", "output": "< 214 lines>"},
    {"seq": 3, "type": "thinking", "content": "夹具回复：整理一下要发出去的内容。"},
    {"seq": 4, "type": "tool_use", "tool": "Bash", "input": {"command": "echo fixture-ok"}},
    {"seq": 5, "type": "tool_result", "tool": "Bash", "output": "fixture-ok"},
]


def env(name: str, default: str) -> str:
    value = os.environ.get(name)
    return default if value is None or value == "" else value


def env_float(name: str, default: float) -> float:
    try:
        return float(env(name, str(default)))
    except ValueError:
        return default


def now_iso() -> str:
    t = datetime.now(timezone.utc)
    return t.strftime("%Y-%m-%dT%H:%M:%S.") + f"{t.microsecond // 1000:03d}Z"


def short(value: Any, limit: int = 4000) -> str:
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    return text if len(text) <= limit else text[:limit] + f"…(+{len(text) - limit}B)"


class Logger:
    """每次请求一行，stdout + 日志文件各写一份，便于验收取证。"""

    def __init__(self, path: Path | None) -> None:
        self._lock = threading.Lock()
        self._fp = None
        if path is not None:
            path.parent.mkdir(parents=True, exist_ok=True)
            self._fp = path.open("a", encoding="utf-8")

    def __call__(self, tag: str, message: str) -> None:
        line = f"{now_iso()} [{tag}] {message}"
        with self._lock:
            print(line, flush=True)
            if self._fp is not None:
                self._fp.write(line + "\n")
                self._fp.flush()

    def close(self) -> None:
        if self._fp is not None:
            self._fp.close()
            self._fp = None


class ApiError(RuntimeError):
    def __init__(self, method: str, path: str, status: int, body: str) -> None:
        super().__init__(f"{method} {path} -> HTTP {status}: {short(body, 400)}")
        self.status = status
        self.body = body


class Api:
    """极简 HTTP 客户端：urllib + JSON。每个调用都记一行日志。"""

    def __init__(self, base_url: str, log: Logger, workspace_id: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.log = log
        self.workspace_id = workspace_id
        self.token: str | None = None

    def request(
        self,
        method: str,
        path: str,
        body: Any | None = None,
        *,
        auth: bool = True,
        tag: str | None = None,
    ) -> tuple[int, Any, str]:
        url = self.base_url + path
        data = None if body is None else json.dumps(body, ensure_ascii=False).encode()
        req = urllib.request.Request(url, data=data, method=method)
        if data is not None:
            req.add_header("Content-Type", "application/json")
        if self.workspace_id:
            req.add_header("X-Workspace-ID", self.workspace_id)
        if auth and self.token:
            req.add_header("Authorization", "Bearer " + self.token)
        label = tag or path.rsplit("/", 1)[-1]
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                status, raw = resp.status, resp.read().decode()
        except urllib.error.HTTPError as exc:  # 4xx/5xx 也当普通响应返回，交给调用方
            status, raw = exc.code, exc.read().decode()
        except urllib.error.URLError as exc:
            self.log(label, f"{method} {path} -> transport error: {exc}")
            raise
        try:
            parsed: Any = json.loads(raw) if raw else None
        except json.JSONDecodeError:
            parsed = None
        self.log(
            label,
            f"{method} {path} -> HTTP {status}"
            + (f" body={short(parsed if parsed is not None else raw)}" if raw else ""),
        )
        return status, parsed, raw

    def json(
        self,
        method: str,
        path: str,
        body: Any | None = None,
        *,
        auth: bool = True,
        tag: str | None = None,
        ok: tuple[int, ...] = (200, 201),
    ) -> Any:
        status, parsed, raw = self.request(method, path, body, auth=auth, tag=tag)
        if status not in ok:
            raise ApiError(method, path, status, raw)
        return parsed


class FakeDaemon:
    def __init__(self, args: argparse.Namespace) -> None:
        self.args = args
        self.base_url = args.base_url
        self.email = args.email
        self.code = args.code
        self.workspace_id = args.workspace_id
        self.daemon_id = args.daemon_id
        self.runtime_name = args.runtime_name
        self.runtime_type = args.runtime_type
        self.chat_session_id = args.chat_session_id
        self.output = args.output
        self.fail_reason = args.fail_reason
        self.fail_error = args.fail_error
        self.env_mode = env("FAKE_MODE", "success").strip().lower()
        self.mode_file = Path(args.mode_file) if args.mode_file else SCRIPT_DIR / ".fake-mode"
        self.state_file = Path(args.state_file) if args.state_file else SCRIPT_DIR / ".fake-inflight.json"
        self.token_file = Path(args.token_file) if args.token_file else SCRIPT_DIR / ".fake-token"
        self.claim_interval = args.claim_interval
        self.heartbeat_interval = args.heartbeat_interval
        self.success_delay = args.success_delay
        self.slow_delay = args.slow_delay
        self.once = args.once
        self.send_texts: list[str] = args.send or []

        self.log = Logger(Path(args.log) if args.log else SCRIPT_DIR / "fake-daemon.log")
        self.api = Api(self.base_url, self.log, self.workspace_id)
        self.runtime_id: str | None = args.runtime_id or None
        self.extra_runtime_ids = [x.strip() for x in env("FAKE_RUNTIME_IDS", "").split(",") if x.strip()]
        self.stop = threading.Event()
        self.inflight: dict[str, Any] | None = None

    # ── 登录 / 注册 ────────────────────────────────────────────────────────
    def login(self) -> None:
        token = env("FAKE_TOKEN", "")
        if token:
            self.api.token = token
            self.log("auth", "使用 FAKE_TOKEN（跳过 /auth/verify-code）")
            return
        # 复用缓存 token：/auth/send-code 限流 5/min，验收要跑好几轮，
        # 每轮都重新登录会在第 6 轮开始卡 15s×n。DaemonAuth 收用户 JWT。
        cached = self.read_cached_token()
        if cached and self.probe_token(cached):
            self.api.token = cached
            self.log("auth", f"复用缓存 token（{self.token_file}）")
            return

        payload = {"email": self.email, "code": self.code}
        # 开发码 888888 走 isDevVerificationCode 分支（server/internal/handler/auth.go:409），
        # 但仍要求库里存在一条「未使用」的 verification_code —— 它是消费型的。
        # 所以先试 verify（可能已有未消费的码），失败再 send-code。
        status, body, _ = self.api.request("POST", "/auth/verify-code", payload, auth=False, tag="auth")
        if status != 200:
            for attempt in range(1, 5):
                s2, _, _ = self.api.request(
                    "POST", "/auth/send-code", {"email": self.email}, auth=False, tag="auth"
                )
                if s2 == 200:
                    break
                if s2 != 429:
                    raise RuntimeError(f"/auth/send-code 失败：HTTP {s2}")
                self.log("auth", f"/auth/send-code 429（限流 5/min），第 {attempt} 次等待 15s 后重试")
                time.sleep(15)
            status, body, _ = self.api.request("POST", "/auth/verify-code", payload, auth=False, tag="auth")
        if status != 200 or not isinstance(body, dict) or "token" not in body:
            raise RuntimeError(f"/auth/verify-code 失败：HTTP {status} {short(body, 300)}")
        self.api.token = body["token"]
        self.write_cached_token(self.api.token)
        user = (body.get("user") or {}).get("id")
        self.log("auth", f"登录成功 user={user} token_len={len(self.api.token)}")

    def read_cached_token(self) -> str:
        try:
            return self.token_file.read_text(encoding="utf-8").strip()
        except OSError:
            return ""

    def write_cached_token(self, token: str) -> None:
        try:
            self.token_file.write_text(token, encoding="utf-8")
        except OSError as exc:
            self.log("auth", f"写 token 缓存失败（忽略）：{exc}")

    def probe_token(self, token: str) -> bool:
        """用一次便宜的 daemon 读接口确认缓存 token 还有效。"""
        self.api.token = token
        status, _, _ = self.api.request("GET", "/api/daemon/workspaces", tag="auth-probe")
        if status == 200:
            return True
        self.log("auth", f"缓存 token 失效（HTTP {status}），重新登录")
        if status == 401:
            try:
                self.token_file.unlink()
            except OSError:
                pass
        self.api.token = None
        return False

    def register(self) -> None:
        if self.args.skip_register:
            if not self.runtime_id:
                raise RuntimeError("--skip-register 需要 FAKE_RUNTIME_ID / --runtime-id")
            self.log("register", f"跳过注册，使用既有 runtime_id={self.runtime_id}")
            return
        body = {
            "workspace_id": self.workspace_id,
            "daemon_id": self.daemon_id,
            "device_name": "fake-daemon-probe",
            "cli_version": "fake-0.1.0",
            "launched_by": "fake-daemon",
            "runtimes": [{"name": self.runtime_name, "type": self.runtime_type, "status": "online"}],
        }
        resp = self.api.json("POST", "/api/daemon/register", body, tag="register")
        runtimes = (resp or {}).get("runtimes") or []
        if not runtimes:
            raise RuntimeError(f"/api/daemon/register 未返回 runtime：{short(resp, 400)}")
        rt = runtimes[0]
        self.runtime_id = rt["id"]
        self.log(
            "register",
            f"runtime_id={rt['id']} status={rt.get('status')} owner_id={rt.get('owner_id')} "
            f"visibility={rt.get('visibility')} provider={rt.get('provider')}",
        )

    def claim_runtime_ids(self) -> list[str]:
        ids = [self.runtime_id] if self.runtime_id else []
        for rid in self.extra_runtime_ids:
            if rid not in ids:
                ids.append(rid)
        return ids

    # ── 心跳 ──────────────────────────────────────────────────────────────
    def heartbeat_loop(self) -> None:
        while not self.stop.is_set():
            try:
                self.api.request(
                    "POST", "/api/daemon/heartbeat", {"runtime_id": self.runtime_id}, tag="heartbeat"
                )
            except Exception as exc:  # 心跳失败不致命，下一轮再试
                self.log("heartbeat", f"心跳异常（忽略）：{exc}")
            self.stop.wait(self.heartbeat_interval)

    # ── 模式 ──────────────────────────────────────────────────────────────
    def read_mode(self) -> str:
        try:
            raw = self.mode_file.read_text(encoding="utf-8")
        except FileNotFoundError:
            return self.env_mode
        except OSError as exc:
            self.log("mode", f"读取 {self.mode_file} 失败（回退 {self.env_mode}）：{exc}")
            return self.env_mode
        for line in raw.splitlines():  # 容忍空行 / # 注释
            line = line.strip().lower()
            if not line or line.startswith("#"):
                continue
            if line in MODES:
                return line
            self.log("mode", f"{self.mode_file} 内容非法（{line!r}），回退 FAKE_MODE={self.env_mode}")
            return self.env_mode
        return self.env_mode

    # ── 任务处理 ──────────────────────────────────────────────────────────
    def claim(self) -> dict[str, Any] | None:
        body = {"daemon_id": self.daemon_id, "runtime_ids": self.claim_runtime_ids(), "max_tasks": 1}
        resp = self.api.json("POST", "/api/daemon/tasks/claim", body, tag="claim")
        tasks = (resp or {}).get("tasks") or []
        if not tasks:
            return None
        task = tasks[0]
        self.log(
            "task",
            f"claimed id={task.get('id')} status={task.get('status')} "
            f"runtime_id={task.get('runtime_id')} agent_id={task.get('agent_id')} "
            f"chat_session_id={task.get('chat_session_id')}",
        )
        return task

    def task_status(self, task_id: str) -> str | None:
        try:
            resp = self.api.json("GET", f"/api/daemon/tasks/{task_id}/status", tag="status")
        except ApiError as exc:
            self.log("status", f"查询任务状态失败：{exc}")
            return None
        return (resp or {}).get("status")

    def send_messages(self, task_id: str, messages: list[dict[str, Any]]) -> None:
        if not messages:
            return
        self.api.json(
            "POST", f"/api/daemon/tasks/{task_id}/messages", {"messages": messages}, tag="messages"
        )

    def complete(self, task_id: str) -> None:
        self.api.json(
            "POST",
            f"/api/daemon/tasks/{task_id}/complete",
            {"output": self.output, "session_id": "fake-daemon-session", "work_dir": "/tmp/fake-daemon-work"},
            tag="complete",
        )
        self.log("task", f"completed id={task_id} output={self.output!r}")

    def fail(self, task_id: str) -> None:
        self.api.json(
            "POST",
            f"/api/daemon/tasks/{task_id}/fail",
            {
                "error": self.fail_error,
                "failure_reason": self.fail_reason,
                "session_id": "fake-daemon-session",
                "work_dir": "/tmp/fake-daemon-work",
            },
            tag="fail",
        )
        self.log("task", f"failed id={task_id} failure_reason={self.fail_reason}")

    def start_task(self, task_id: str) -> None:
        self.api.json("POST", f"/api/daemon/tasks/{task_id}/start", {}, tag="start")

    # ── inflight 状态（跨进程重启可续）─────────────────────────────────────
    def write_state(self) -> None:
        if self.inflight is None:
            try:
                self.state_file.unlink()
            except FileNotFoundError:
                pass
            return
        self.state_file.write_text(json.dumps(self.inflight, ensure_ascii=False), encoding="utf-8")

    def load_state(self) -> dict[str, Any] | None:
        try:
            data = json.loads(self.state_file.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError):
            return None
        return data if isinstance(data, dict) and data.get("task_id") else None

    def clear_inflight(self) -> None:
        self.inflight = None
        self.write_state()

    def send_step(self, task_id: str, count: int) -> None:
        """发 STEP_MESSAGES 里接下来的 count 条，并推进 inflight.sent。"""
        assert self.inflight is not None
        sent = int(self.inflight.get("sent") or 0)
        batch = STEP_MESSAGES[sent : sent + count]
        self.send_messages(task_id, batch)
        self.inflight["sent"] = sent + len(batch)
        self.write_state()

    def send_remaining(self, task_id: str) -> None:
        assert self.inflight is not None
        sent = int(self.inflight.get("sent") or 0)
        if sent < len(STEP_MESSAGES):
            self.send_step(task_id, len(STEP_MESSAGES) - sent)

    # ── 一轮任务 ──────────────────────────────────────────────────────────
    def handle(self, task: dict[str, Any], mode: str) -> None:
        """按 mode 跑一轮。pending 会把任务挂在 inflight 上保持 running。"""
        task_id = str(task["id"])
        if mode == "slow":
            self.log("task", f"slow 模式：{self.slow_delay}s 后再 /start（用来观察 Queued / Starting up pill）")
            if self.stop.wait(self.slow_delay):
                return
            mode = "success"

        if (task.get("status") or "").lower() != "running":
            self.start_task(task_id)

        if mode == "fail":
            self.fail(task_id)
            return

        # pending 只发一条 tool_use 步骤；success/slow 先发前两条
        self.inflight = {"task_id": task_id, "sent": 0, "held": mode == "pending"}
        self.write_state()
        self.send_step(task_id, 1 if mode == "pending" else 2)

        if mode == "pending":
            self.log(
                "pending",
                f"task={task_id} 保持在 running（不 /complete）；把 {self.mode_file} 改成 "
                f"success/fail 后本进程会继续收尾",
            )
            return

        if self.stop.wait(self.success_delay / 2):
            return  # 进程被停：state 已写盘，下次启动会续跑
        self.send_remaining(task_id)
        if self.stop.wait(self.success_delay / 2):
            return
        self.complete(task_id)
        self.clear_inflight()

    def resume(self, mode: str) -> None:
        """收尾一个已经 /start 过的 inflight 任务（pending 保持中，或上次进程留下的）。"""
        assert self.inflight is not None
        task_id = str(self.inflight["task_id"])
        sent = int(self.inflight.get("sent") or 0)
        if mode == "pending":
            # 任务已经 /start，pending 只对新任务成立 —— 这里按 success 收尾。
            self.log("resume", f"task={task_id} 已在运行，pending 语义不适用，按 success 收尾")
            mode = "success"
        self.log("resume", f"task={task_id} 模式={mode} 已发 {sent} 条步骤，收尾")
        if mode == "fail":
            self.fail(task_id)
            self.clear_inflight()
            return
        self.send_remaining(task_id)
        if self.stop.wait(self.success_delay / 2):
            return  # 停进程：保留 state
        self.complete(task_id)
        self.clear_inflight()

    # ── 主循环 ────────────────────────────────────────────────────────────
    def send_chat_messages(self) -> None:
        for text in self.send_texts:
            resp = self.api.json(
                "POST",
                f"/api/chat/sessions/{self.chat_session_id}/messages",
                {"content": text},
                tag="chat-send",
                ok=(200, 201),
            )
            self.log(
                "chat-send",
                f"content={text!r} -> message_id={resp.get('message_id')} task_id={resp.get('task_id')} "
                f"queued={resp.get('queued')}",
            )

    def restore_state(self) -> bool:
        """上次进程留下的未完成任务：能续就续。返回是否已到达终态。"""
        saved = self.load_state()
        if not saved:
            return False
        self.inflight = saved
        task_id = str(saved["task_id"])
        status = self.task_status(task_id)
        mode = self.read_mode()
        if status not in ("running", "dispatched"):
            self.log("state", f"丢弃过期 state（task={task_id} status={status}）")
            self.clear_inflight()
            return False
        if saved.get("held") and mode == "pending":
            self.log("state", f"恢复 pending 中的 task={task_id}（服务端 status={status}）")
            return False
        self.log("state", f"恢复未完成任务 task={task_id}（服务端 status={status}）")
        self.resume(mode)
        return self.inflight is None

    def run(self) -> int:
        self.log(
            "boot",
            f"base={self.base_url} workspace={self.workspace_id} daemon_id={self.daemon_id} "
            f"mode_file={self.mode_file} env_mode={self.env_mode} once={self.once}",
        )
        self.login()
        self.register()
        if self.restore_state() and self.once:
            self.log("boot", "退出（--once：恢复出来的任务已收尾）")
            self.log.close()
            return 0

        self.send_chat_messages()

        hb = threading.Thread(target=self.heartbeat_loop, name="heartbeat", daemon=True)
        hb.start()
        handled = 0
        try:
            while not self.stop.is_set():
                mode = self.read_mode()
                if self.inflight is not None:
                    if self.inflight.get("held") and mode == "pending":
                        self.log("pending", f"持有 task={self.inflight['task_id']}，等待模式变化…")
                    else:
                        self.resume(mode)
                        handled += 1
                    if self.once and self.inflight is None:
                        return 0
                    self.stop.wait(self.claim_interval)
                    continue

                task = self.claim()
                if task is None:
                    if self.once and handled:
                        return 0
                    self.stop.wait(self.claim_interval)
                    continue
                self.handle(task, mode)
                if self.inflight is None:
                    handled += 1
                    if self.once:
                        return 0
        finally:
            self.stop.set()
            hb.join(timeout=1)
            self.log("boot", "退出")
            self.log.close()
        return 0


def build_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="FEATURE-558 假 runtime daemon：为 Probe550 Agent 真跑聊天任务",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    p.add_argument("--base-url", default=env("FAKE_BASE_URL", DEF_BASE_URL))
    p.add_argument("--email", default=env("FAKE_EMAIL", DEF_EMAIL))
    p.add_argument("--code", default=env("FAKE_CODE", DEF_CODE))
    p.add_argument("--workspace-id", default=env("FAKE_WORKSPACE_ID", DEF_WORKSPACE_ID))
    p.add_argument("--daemon-id", default=env("FAKE_DAEMON_ID", DEF_DAEMON_ID))
    p.add_argument("--runtime-name", default=env("FAKE_RUNTIME_NAME", DEF_RUNTIME_NAME))
    p.add_argument("--runtime-type", default=env("FAKE_RUNTIME_TYPE", DEF_RUNTIME_TYPE))
    p.add_argument(
        "--runtime-id", default=env("FAKE_RUNTIME_ID", ""), help="复用既有 runtime（配合 --skip-register）"
    )
    p.add_argument("--skip-register", action="store_true", default=env("FAKE_SKIP_REGISTER", "") == "1")
    p.add_argument("--chat-session-id", default=env("FAKE_CHAT_SESSION_ID", DEF_CHAT_SESSION_ID))
    p.add_argument("--output", default=env("FAKE_OUTPUT", DEF_OUTPUT), help="/complete 的助手正文")
    p.add_argument("--fail-reason", default=env("FAKE_FAIL_REASON", DEF_FAIL_REASON))
    p.add_argument("--fail-error", default=env("FAKE_FAIL_ERROR", DEF_FAIL_ERROR))
    p.add_argument("--mode-file", default=env("FAKE_MODE_FILE", ""), help="默认 <脚本目录>/.fake-mode")
    p.add_argument("--state-file", default=env("FAKE_STATE_FILE", ""), help="默认 <脚本目录>/.fake-inflight.json")
    p.add_argument("--token-file", default=env("FAKE_TOKEN_FILE", ""), help="默认 <脚本目录>/.fake-token")
    p.add_argument("--log", default=env("FAKE_LOG", ""), help="默认 <脚本目录>/fake-daemon.log")
    p.add_argument("--claim-interval", type=float, default=env_float("FAKE_CLAIM_INTERVAL", 1.0))
    p.add_argument("--heartbeat-interval", type=float, default=env_float("FAKE_HEARTBEAT_INTERVAL", 20.0))
    p.add_argument("--success-delay", type=float, default=env_float("FAKE_SUCCESS_DELAY", 4.0))
    p.add_argument("--slow-delay", type=float, default=env_float("FAKE_SLOW_DELAY", 15.0))
    p.add_argument(
        "--send",
        action="append",
        metavar="TEXT",
        help="启动后先以登录用户身份向 --chat-session-id 发一条聊天消息（可重复）",
    )
    p.add_argument("--once", action="store_true", help="处理完一个任务（到达终态）后退出")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = build_args(argv)
    daemon = FakeDaemon(args)

    def on_signal(signum: int, _frame: Any) -> None:
        daemon.log("boot", f"收到信号 {signum}，准备退出")
        daemon.stop.set()

    signal.signal(signal.SIGINT, on_signal)
    signal.signal(signal.SIGTERM, on_signal)
    try:
        return daemon.run()
    except KeyboardInterrupt:
        daemon.stop.set()
        return 130
    except ApiError as exc:
        daemon.log("error", str(exc))
        return 1


if __name__ == "__main__":
    sys.exit(main())
