"""Atomic, validated writes plus the freshness manifest.

A failed fetch must never replace good data with an empty or partial file.
Every site-facing writer goes through ``atomic_write_json`` /
``atomic_write_csv``: the payload is serialised to a temp file in the same
directory, checked (``min_items`` and an optional ``validator``), and only then
``os.replace``d over the target.  When a check fails the previous file is kept
and the reason is recorded under ``stale`` in public/data/manifest.json so the
site, the freshness workflow and humans can see it.
"""
from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime, timezone

from paths import MANIFEST_FILE


class GuardError(Exception):
    """A write was refused by a guard (min_items / validator)."""


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _count(data) -> int:
    if isinstance(data, dict):
        return sum(1 for k in data if not str(k).startswith("_"))
    try:
        return len(data)
    except TypeError:
        return 1


def _check(path: str, data, min_items, validator, count=None):
    n = _count(data) if count is None else count
    if min_items is not None and n < min_items:
        return f"{n} items < min {min_items}"
    if validator is not None:
        try:
            res = validator(data)
        except Exception as e:  # validator raised => reject
            return f"validator error: {e}"
        if res is False:
            return "validator rejected payload"
        if isinstance(res, str) and res:
            return res
    return None


def _replace_from_tmp(path: str, write_fn):
    d = os.path.dirname(os.path.abspath(path)) or "."
    os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".tmp_", suffix=os.path.splitext(path)[1], dir=d)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as f:
            write_fn(f)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def atomic_write_json(path: str, data, *, min_items: int | None = None, validator=None,
                      label: str | None = None, indent=2, raise_on_fail: bool = False,
                      **dump_kw) -> bool:
    """Validate then atomically write JSON. Returns True if written.

    On a failed guard the old file is untouched, ``manifest.stale[label]`` is
    set, and False is returned (or GuardError raised if ``raise_on_fail``).
    """
    label = label or os.path.basename(path)
    reason = _check(path, data, min_items, validator)
    if reason:
        msg = f"[GUARD] Refusing to write {label}: {reason} — keeping previous file"
        print(msg)
        mark_stale(label, reason)
        if raise_on_fail:
            raise GuardError(msg)
        return False
    _replace_from_tmp(path, lambda f: json.dump(data, f, indent=indent, **dump_kw))
    clear_stale(label)
    return True


def atomic_write_csv(path: str, df, *, min_rows: int | None = None, validator=None,
                     label: str | None = None, raise_on_fail: bool = False, **to_csv_kw) -> bool:
    """Validate then atomically write a pandas DataFrame as CSV."""
    label = label or os.path.basename(path)
    reason = _check(path, df, min_rows, validator, count=len(df))
    if reason:
        msg = f"[GUARD] Refusing to write {label}: {reason} — keeping previous file"
        print(msg)
        mark_stale(label, reason)
        if raise_on_fail:
            raise GuardError(msg)
        return False
    to_csv_kw.setdefault("index", False)
    _replace_from_tmp(path, lambda f: df.to_csv(f, **to_csv_kw))
    clear_stale(label)
    return True


def atomic_write_text(path: str, text: str) -> None:
    _replace_from_tmp(path, lambda f: f.write(text))


def read_json(path: str, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


# ── Manifest ──────────────────────────────────────────────────────────────────
# public/data/manifest.json is shared state across separate pipeline processes
# (lite runs call scripts one by one).  Each helper does a read-modify-write.

def manifest_path(path: str | None = None) -> str:
    return path or os.environ.get("PONYXG_MANIFEST_FILE") or MANIFEST_FILE


def load_manifest(path: str | None = None) -> dict:
    m = read_json(manifest_path(path), {})
    return m if isinstance(m, dict) else {}


def update_manifest(mutator, path: str | None = None) -> dict:
    m = load_manifest(path)
    mutator(m)
    _replace_from_tmp(manifest_path(path), lambda f: json.dump(m, f, indent=2, sort_keys=False))
    return m


def mark_stale(name: str, reason: str, path: str | None = None) -> None:
    def _mut(m):
        m.setdefault("stale", {})[name] = reason
        m.setdefault("stale_since", {}).setdefault(name, utc_now_iso())
    try:
        update_manifest(_mut, path)
    except Exception as e:  # manifest problems must never break a data write
        print(f"  [WARN] could not record stale flag for {name}: {e}")


def clear_stale(name: str, path: str | None = None) -> None:
    try:
        m = load_manifest(path)
        if name in (m.get("stale") or {}) or name in (m.get("stale_since") or {}):
            def _mut(mm):
                mm.get("stale", {}).pop(name, None)
                mm.get("stale_since", {}).pop(name, None)
            update_manifest(_mut, path)
    except Exception as e:
        print(f"  [WARN] could not clear stale flag for {name}: {e}")


def record_source(name: str, path: str | None = None, **fields) -> None:
    """Store per-source metadata (e.g. fetched_at) under manifest.sources[name]."""
    fields.setdefault("fetched_at", utc_now_iso())
    try:
        update_manifest(lambda m: m.setdefault("sources", {}).setdefault(name, {}).update(fields), path)
    except Exception as e:
        print(f"  [WARN] could not record source {name}: {e}")


def source_age_hours(name: str, path: str | None = None) -> float | None:
    src = (load_manifest(path).get("sources") or {}).get(name) or {}
    ts = src.get("fetched_at")
    if not ts:
        return None
    try:
        dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        return None
    return (datetime.now(timezone.utc) - dt).total_seconds() / 3600
