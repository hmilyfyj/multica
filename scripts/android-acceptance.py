#!/usr/bin/env python3
"""Run archived Android acceptance groups with bounded, observable supervision."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import urllib.request


def write_json(path, value):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.replace(path)


def evidence_passed(record):
    """A checkpoint is reusable only while its recorded evidence still exists unchanged."""
    if record.get("status") != "passed" or not record.get("evidence_sha256"):
        return False
    result = Path(record["evidence"]) / "results.tsv"
    return result.is_file() and hashlib.sha256(result.read_bytes()).hexdigest() == record["evidence_sha256"]


def supervise(command, out, env, health, idle=120, limit=1200, interval=5):
    """Own exactly one process group; result growth, not noisy logs, is progress."""
    out.mkdir(parents=True, exist_ok=False)
    state = {"status": "blocked", "pid": None, "reason": None}
    process = None
    old_handlers = {}
    started = time.monotonic()
    last_progress = started
    size = 0
    try:
        health()
        with (out / "runner.log").open("wb") as log:
            process = subprocess.Popen(command, env={**env, "OUT": str(out)}, stdout=log,
                                       stderr=subprocess.STDOUT, start_new_session=True)
            state.update(pid=process.pid, status="running")
            def interrupted(signum, _frame):
                raise InterruptedError(f"signal {signum}")
            for sig in (signal.SIGINT, signal.SIGTERM):
                old_handlers[sig] = signal.signal(sig, interrupted)
            while process.poll() is None:
                now = time.monotonic()
                result = out / "results.tsv"
                current = result.stat().st_size if result.exists() else 0
                if current != size:
                    size, last_progress = current, now
                state.update(elapsed=round(now - started, 2), idle=round(now - last_progress, 2))
                write_json(out / "supervisor.json", state)
                health()
                if now - started >= limit:
                    raise TimeoutError("group timeout")
                if now - last_progress >= idle:
                    raise TimeoutError("no new result; inspect runner.log and device before retrying")
                print(f"pid={process.pid} elapsed={state['elapsed']}s idle={state['idle']}s", flush=True)
                time.sleep(interval)
            state["exit_code"] = process.returncode
            result = out / "results.tsv"
            rows = [row.split("\t") for row in result.read_text().splitlines()] if result.exists() else []
            state["status"] = "passed" if process.returncode == 0 and rows and all(len(row) >= 3 and row[1] == "pass" for row in rows) else "failed"
    except (OSError, RuntimeError, TimeoutError, InterruptedError, subprocess.TimeoutExpired) as error:
        state.update(status="blocked", reason=str(error))
    finally:
        # Only the child group created above is ours; never target a daemon by name.
        if process:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()
        for sig, handler in old_handlers.items():
            signal.signal(sig, handler)
        state["elapsed"] = round(time.monotonic() - started, 2)
        write_json(out / "supervisor.json", state)
    return state


def probe(adb, serial, metro):
    """Do not let a disconnected emulator consume a whole retry budget."""
    result = subprocess.run([adb, "-s", serial, "get-state"], capture_output=True, text=True, timeout=10)
    if result.returncode or result.stdout.strip() != "device":
        raise RuntimeError("Android device is unavailable")
    with urllib.request.urlopen(metro.rstrip("/") + "/status", timeout=5) as response:
        if b"packager-status:running" not in response.read():
            raise RuntimeError("Metro is not ready")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runner", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--serial", required=True)
    parser.add_argument("--package", required=True)
    parser.add_argument("--groups", required=True, help="Explicit ordered groups, e.g. b,v,e")
    parser.add_argument("--input-key", required=True, help="Installed build + fixture/environment version")
    parser.add_argument("--ready-command", required=True, help="Executable path for login/page/fixture readiness; no shell or arguments")
    parser.add_argument("--adb", default="adb")
    parser.add_argument("--metro", default="http://127.0.0.1:8081")
    parser.add_argument("--idle-seconds", type=float, default=120)
    parser.add_argument("--group-seconds", type=float, default=1200)
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()
    if os.name != "posix":
        parser.error("POSIX process groups are required")
    groups = args.groups.split(",")
    allowed = {"core", "b", "v", "e", "m", "d", "c11", "smoke", *[f"c{i}" for i in range(1, 11)]}
    if not groups or len(set(groups)) != len(groups) or any(g not in allowed for g in groups):
        parser.error("groups must be unique known acceptance groups")
    if args.idle_seconds <= 0 or args.group_seconds <= 0:
        parser.error("timeouts must be positive")
    runner = args.runner.resolve(strict=True)
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    # Lock the evidence directory so two invocations cannot overwrite checkpoints.
    import fcntl
    with (out / ".lock").open("w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            parser.error("another supervisor owns this output directory")
        fingerprint = hashlib.sha256(json.dumps({
            "key": args.input_key, "serial": args.serial, "package": args.package,
            "metro": args.metro, "groups": groups, "ready": args.ready_command,
            "runner": str(runner), "idle": args.idle_seconds, "limit": args.group_seconds,
        }, sort_keys=True).encode())
        # All adjacent scripts participate in the archived runner contract.
        for source in sorted(p for p in runner.parent.iterdir() if p.suffix in {".sh", ".py", ".sql"} and p.is_file()):
            fingerprint.update(source.name.encode())
            fingerprint.update(source.read_bytes())
        key = fingerprint.hexdigest()
        checkpoint = out / "checkpoint.json"
        record = json.loads(checkpoint.read_text()) if checkpoint.exists() else {"key": key, "groups": {}}
        if checkpoint.exists() and (not args.resume or record["key"] != key):
            parser.error("use a new output directory, or --resume with identical inputs")
        for group in groups:
            if evidence_passed(record["groups"].get(group, {})):
                continue
            env = {**os.environ, "ADB": args.adb, "ANDROID_SERIAL": args.serial,
                   "PKG": args.package, "ACCEPT_GROUPS": group}
            # Preflight is once per group; continuous health checks do not interfere with UI automation.
            def health():
                probe(args.adb, args.serial, args.metro)
            attempt = out / f"{group}-{time.time_ns()}"
            ready_output = b""
            try:
                health()
                ready = subprocess.run([args.ready_command], env=env, capture_output=True, timeout=30)
                ready_output = ready.stdout + ready.stderr
                if ready.returncode:
                    raise RuntimeError("login/page/fixture readiness failed")
                result = supervise(["bash", str(runner)], attempt, env, health,
                                   idle=args.idle_seconds, limit=args.group_seconds)
            except (OSError, RuntimeError, subprocess.TimeoutExpired) as error:
                attempt.mkdir(exist_ok=True)
                result = {"status": "blocked", "reason": str(error)}
                write_json(attempt / "supervisor.json", result)
            (attempt / "preflight.log").write_bytes(ready_output)
            evidence = attempt / "results.tsv"
            if result["status"] == "passed":
                result["evidence_sha256"] = hashlib.sha256(evidence.read_bytes()).hexdigest()
            record["groups"][group] = {**result, "evidence": str(attempt)}
            write_json(checkpoint, record)
            if result["status"] == "blocked":
                break
        return 0 if all(evidence_passed(record["groups"].get(g, {})) for g in groups) else 1


if __name__ == "__main__":
    sys.exit(main())
