"""Tests for the silent-except linter. The pattern we forbid:

    try:
        risky()
    except Exception:
        pass

This buries real errors. Allowed patterns:

    try:
        risky()
    except Exception:
        logger.exception("clear context")  # logged

    try:
        risky()
    except Exception as e:
        raise CustomError(...) from e  # re-raised

Trip 41/43 spent hours debugging issues that turned out to be silent
excepts swallowing prod errors."""
from __future__ import annotations

import textwrap
from pathlib import Path

import pytest


def _lint(source: str):
    from scripts.lint_silent_excepts import find_silent_excepts
    return find_silent_excepts(source, filename="test.py")


def test_pass_only_except_is_flagged():
    src = textwrap.dedent("""
        def f():
            try:
                x = 1
            except Exception:
                pass
    """)
    findings = _lint(src)
    assert len(findings) == 1
    assert findings[0].line >= 4


def test_logged_except_is_ok():
    src = textwrap.dedent("""
        import logging
        logger = logging.getLogger(__name__)

        def f():
            try:
                x = 1
            except Exception:
                logger.exception("oops")
    """)
    assert _lint(src) == []


def test_reraised_except_is_ok():
    src = textwrap.dedent("""
        def f():
            try:
                x = 1
            except Exception as e:
                raise RuntimeError("boom") from e
    """)
    assert _lint(src) == []


def test_bare_except_pass_also_flagged():
    src = textwrap.dedent("""
        def f():
            try:
                x = 1
            except:
                pass
    """)
    findings = _lint(src)
    assert len(findings) == 1


def test_continue_only_except_is_flagged():
    """A loop body that swallows exceptions silently is the same bug."""
    src = textwrap.dedent("""
        def f(items):
            for x in items:
                try:
                    process(x)
                except Exception:
                    continue
    """)
    findings = _lint(src)
    assert len(findings) == 1
