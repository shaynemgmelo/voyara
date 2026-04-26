"""AST-based linter that flags silent exception handlers — `except`
blocks whose body has no logging, no raise, and no other meaningful
work (just `pass`, `continue`, or the equivalent).

Why: trip 41 + trip 43 both had production bugs that took hours to
debug because the actual error was swallowed by `except Exception:
pass`. This linter catches the pattern at commit time.

Usage:
    python scripts/lint_silent_excepts.py app/

Exit code 0 = clean. Exit code 1 = findings.
"""
from __future__ import annotations

import ast
import sys
from dataclasses import dataclass
from pathlib import Path


@dataclass
class Finding:
    file: str
    line: int
    message: str


def _is_silent(handler: ast.ExceptHandler) -> bool:
    """A handler is "silent" if its body does nothing meaningful — only
    pass, continue, break, or a bare `...` Ellipsis."""
    body = handler.body
    if not body:
        return True
    # Strip trailing comments — already not in AST. Examine each stmt.
    silent_stmts = (ast.Pass, ast.Continue, ast.Break)
    for stmt in body:
        if isinstance(stmt, silent_stmts):
            continue
        if isinstance(stmt, ast.Expr) and isinstance(stmt.value, ast.Constant):
            # `...` or a docstring.
            continue
        return False
    return True


def _catches_broad(handler: ast.ExceptHandler) -> bool:
    """True for `except:` (bare) or `except Exception:` / `except
    BaseException:`. Narrower handlers (e.g. `except KeyError:`) are
    intentional and not flagged."""
    if handler.type is None:
        return True
    if isinstance(handler.type, ast.Name):
        return handler.type.id in ("Exception", "BaseException")
    if isinstance(handler.type, ast.Tuple):
        return any(
            isinstance(e, ast.Name) and e.id in ("Exception", "BaseException")
            for e in handler.type.elts
        )
    return False


def find_silent_excepts(source: str, filename: str = "<source>") -> list[Finding]:
    """Parse `source` and return findings for every silent broad
    except handler. Used by the test suite + the CLI."""
    try:
        tree = ast.parse(source, filename=filename)
    except SyntaxError:
        return []  # don't fail on syntactically broken files
    findings: list[Finding] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ExceptHandler) and _catches_broad(node) and _is_silent(node):
            findings.append(Finding(
                file=filename, line=node.lineno,
                message="broad except with no logging or re-raise",
            ))
    return findings


def lint_path(path: Path) -> list[Finding]:
    findings: list[Finding] = []
    for f in path.rglob("*.py"):
        if "/.venv/" in str(f) or "/build/" in str(f):
            continue
        findings.extend(find_silent_excepts(f.read_text(), filename=str(f)))
    return findings


def main(argv: list[str]) -> int:
    if not argv:
        print("usage: lint_silent_excepts.py <path> [<path>...]", file=sys.stderr)
        return 2
    findings: list[Finding] = []
    for arg in argv:
        findings.extend(lint_path(Path(arg)))
    for f in findings:
        print(f"{f.file}:{f.line}: {f.message}")
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
