#!/usr/bin/env python3
"""Simple PTY relay: runs a command under a pseudo-terminal and bridges stdin/stdout."""

import os
import pty
import signal
import sys
import threading
import fcntl
import termios
import struct


def exit_code_from_status(status: int) -> int:
    if os.WIFEXITED(status):
        return os.WEXITSTATUS(status)
    if os.WIFSIGNALED(status):
        return 128 + os.WTERMSIG(status)
    return 1


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: pty_agent.py <cmd> [args...]", file=sys.stderr)
        return 2

    command = sys.argv[1:]

    child_pid, master_fd = pty.fork()
    if child_pid == 0:
        os.execvp(command[0], command)
        return 127

    def set_winsize(rows: int, cols: int) -> None:
        rows = rows if rows > 0 else 40
        cols = cols if cols > 0 else 120
        try:
            winsize = struct.pack("HHHH", rows, cols, 0, 0)
            fcntl.ioctl(master_fd, termios.TIOCSWINSZ, winsize)
        except OSError:
            # Best-effort: keep running even if winsize ioctl is unavailable.
            pass

    # Some PTY consumers (including rich TUIs) exit immediately if the
    # terminal starts at 0x0. Ensure a sane default size.
    try:
        rows = int(os.environ.get("PROMPTPACK_TERM_ROWS", "40"))
    except ValueError:
        rows = 40
    try:
        cols = int(os.environ.get("PROMPTPACK_TERM_COLS", "120"))
    except ValueError:
        cols = 120

    rows = rows if rows > 0 else 40
    cols = cols if cols > 0 else 120

    set_winsize(rows, cols)

    stdout_fd = sys.stdout.fileno()

    def forward_signal(sig, _frame):
        try:
            os.kill(child_pid, sig)
        except OSError:
            pass

    signal.signal(signal.SIGTERM, forward_signal)
    signal.signal(signal.SIGINT, forward_signal)

    stdin_fd = sys.stdin.fileno()

    def pump_stdin() -> None:
        while True:
            try:
                data = os.read(stdin_fd, 4096)
            except OSError:
                break

            if not data:
                break

            try:
                os.write(master_fd, data)
            except OSError:
                break

    threading.Thread(target=pump_stdin, daemon=True).start()

    control_fd = 3

    def pump_control() -> None:
        try:
            os.set_blocking(control_fd, True)
        except OSError:
            return

        buffer = ""
        while True:
            try:
                chunk = os.read(control_fd, 1024)
            except OSError:
                break

            if not chunk:
                break

            buffer += chunk.decode("utf-8", errors="ignore")
            while "\n" in buffer:
                line, buffer = buffer.split("\n", 1)
                line = line.strip()
                if not line:
                    continue

                if not line.startswith("RESIZE "):
                    continue

                parts = line.split()
                if len(parts) != 3:
                    continue

                try:
                    next_cols = int(parts[1])
                    next_rows = int(parts[2])
                except ValueError:
                    continue

                set_winsize(next_rows, next_cols)

    threading.Thread(target=pump_control, daemon=True).start()

    while True:
        try:
            data = os.read(master_fd, 4096)
        except OSError:
            data = b""

        if not data:
            _, status = os.waitpid(child_pid, 0)
            return exit_code_from_status(status)

        os.write(stdout_fd, data)


if __name__ == "__main__":
    raise SystemExit(main())
