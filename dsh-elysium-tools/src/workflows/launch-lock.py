"""Hold a local advisory lock until the launching process closes stdin.

The kernel releases it on exit, including crashes; never unlink this file.
"""
import fcntl
import sys

with open(sys.argv[1], "a") as lock:
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    print("locked", flush=True)
    sys.stdin.buffer.read()
