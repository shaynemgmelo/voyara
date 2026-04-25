"""Pytest fixtures + safety nets for the orchestrator test suite.

Goal: every helper-level test runs deterministically, with no live
calls to Anthropic, Tavily, Google Places, Rails, or yt-dlp. If a test
ever does try to reach the network, it should fail loudly so we catch
it instead of silently spending tokens or flaking on CI.
"""
from __future__ import annotations

import os
import socket
import pytest


# Block real outbound TCP during tests. Loopback (127.0.0.1) is allowed
# so a test that explicitly stands up a fake local server still works.
_real_socket = socket.socket


class _BlockedSocket(_real_socket):
    def connect(self, address):  # type: ignore[override]
        host = address[0] if isinstance(address, tuple) else address
        if host not in ("127.0.0.1", "::1", "localhost"):
            raise RuntimeError(
                f"Test attempted live network call to {address!r}. "
                "Mock external dependencies — tests must be deterministic."
            )
        return super().connect(address)


@pytest.fixture(autouse=True)
def _block_network(monkeypatch):
    monkeypatch.setattr(socket, "socket", _BlockedSocket)
    # Also stub the env vars so any code that reads settings during
    # import doesn't get None and surprise-fail.
    for k, v in (
        ("ANTHROPIC_API_KEY", "test-key"),
        ("GOOGLE_PLACES_API_KEY", "test-key"),
        ("TAVILY_API_KEY", "test-key"),
        ("RAILS_API_URL", "http://127.0.0.1:9999"),
        ("SERVICE_API_KEY", "test-key"),
    ):
        if not os.environ.get(k):
            monkeypatch.setenv(k, v)
    yield
