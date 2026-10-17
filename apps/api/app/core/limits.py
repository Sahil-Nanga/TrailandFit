"""Request size limits and a simple per-user rate limiter."""

import time
from collections import defaultdict, deque
from threading import Lock

from starlette.types import ASGIApp, Receive, Scope, Send

from app.core.errors import ErrorDetail, ErrorResponse


class BodySizeLimitMiddleware:
    """Reject oversized uploads before the multipart parser buffers them.

    Applies to paths under `path_prefix`. Requests must declare Content-Length (browsers do
    for file uploads), so the check happens before any body bytes are read.
    """

    def __init__(self, app: ASGIApp, *, path_prefix: str, max_bytes: int) -> None:
        self.app = app
        self.path_prefix = path_prefix
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not scope["path"].startswith(self.path_prefix):
            await self.app(scope, receive, send)
            return
        headers = dict(scope["headers"])
        length = headers.get(b"content-length")
        if scope["method"] == "POST" and length is None:
            await self._reject(send, 411, "length_required", "Upload size must be declared.")
            return
        if length is not None and (not length.isdigit() or int(length) > self.max_bytes):
            await self._reject(send, 413, "too_large", "Photos must be 10 MB or smaller.")
            return
        await self.app(scope, receive, send)

    @staticmethod
    async def _reject(send: Send, status: int, code: str, message: str) -> None:
        body = ErrorResponse(error=ErrorDetail(code=code, message=message)).model_dump_json(
            exclude_none=True
        )
        await send(
            {
                "type": "http.response.start",
                "status": status,
                "headers": [(b"content-type", b"application/json")],
            }
        )
        await send({"type": "http.response.body", "body": body.encode()})


class RateLimiter:
    """Sliding-window limit per key, in process memory.

    Good enough for a single API instance. With several instances, move this to Redis.
    """

    def __init__(self, limit: int, window_seconds: float) -> None:
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def check(self, key: str) -> float | None:
        """Record a hit. Returns None if allowed, else seconds until the next allowed hit."""
        now = time.monotonic()
        with self._lock:
            hits = self._hits[key]
            while hits and now - hits[0] >= self.window:
                hits.popleft()
            if len(hits) >= self.limit:
                return self.window - (now - hits[0])
            hits.append(now)
            return None
