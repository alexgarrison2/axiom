#!/usr/bin/env python3
"""Check that the shell commands documented in README.md and CLAUDE.md still
point at things that exist.

For every line in a ```bash code block it follows `cd`, and checks that:
  - `npm run <script>` names a script in package.json
  - `npx <bin>` resolves to node_modules/.bin/<bin> (or a declared dependency
    when node_modules is not installed)
  - `python3 <file>` / `python <file>` and `pip install -r <file>` name files
    that exist relative to the current directory of the block
  - any other program is on PATH
It does not execute the commands (several rewrite committed data files).

Usage (from the repo root):
    python3 scripts/check_doc_commands.py [extra.md ...]
Exits non-zero if any command is broken.
"""
import json
import os
import re
import shlex
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_DOCS = ["README.md", "CLAUDE.md"]
FENCE = re.compile(r"^```(\w*)\s*$")


def code_blocks(text):
    lang, buf = None, []
    for line in text.splitlines():
        m = FENCE.match(line.strip())
        if m and lang is None:
            lang, buf = (m.group(1) or "text"), []
        elif line.strip() == "```" and lang is not None:
            yield lang, buf
            lang = None
        elif lang is not None:
            buf.append(line)


def strip_comment(line):
    out, quote = [], None
    for i, ch in enumerate(line):
        if quote:
            if ch == quote:
                quote = None
        elif ch in "'\"":
            quote = ch
        elif ch == "#" and (i == 0 or line[i - 1].isspace()):
            break
        out.append(ch)
    return "".join(out).strip()


def load_package():
    with open(os.path.join(ROOT, "package.json")) as f:
        pkg = json.load(f)
    deps = set(pkg.get("dependencies", {})) | set(pkg.get("devDependencies", {}))
    return pkg.get("scripts", {}), deps


NPX_PACKAGES = {"tsc": "typescript", "next": "next", "eslint": "eslint", "playwright": "@playwright/test"}


def check_command(argv, cwd, scripts, deps):
    """Return (new_cwd, error or None)."""
    prog, args = argv[0], argv[1:]
    if prog == "cd":
        target = os.path.normpath(os.path.join(cwd, args[0] if args else ROOT))
        if not os.path.isdir(target):
            return cwd, f"cd target does not exist: {args[0]}"
        return target, None
    if prog in ("export", "set", "source"):
        return cwd, None
    if prog == "npm":
        if not args:
            return cwd, "bare npm"
        if args[0] in ("ci", "install", "i"):
            if not os.path.exists(os.path.join(ROOT, "package-lock.json")):
                return cwd, "npm ci without package-lock.json"
            return cwd, None
        if args[0] == "run":
            if len(args) < 2 or args[1] not in scripts:
                return cwd, f"npm script not in package.json: {' '.join(args[1:2])}"
            return cwd, None
        if args[0] in ("start", "test") and args[0] in scripts:
            return cwd, None
        return cwd, f"unrecognised npm subcommand: {args[0]}"
    if prog == "npx":
        name = args[0] if args else ""
        if os.path.exists(os.path.join(ROOT, "node_modules", ".bin", name)):
            return cwd, None
        if NPX_PACKAGES.get(name) in deps or name in deps:
            return cwd, None
        return cwd, f"npx binary not provided by package.json: {name}"
    if prog in ("python", "python3"):
        if not args or args[0] in ("-c", "-m"):
            return cwd, None
        script = args[0]
        if not os.path.exists(os.path.join(cwd, script)):
            return cwd, f"python script not found: {os.path.relpath(os.path.join(cwd, script), ROOT)}"
        return cwd, None
    if prog in ("pip", "pip3"):
        if "-r" in args:
            req = args[args.index("-r") + 1]
            if not os.path.exists(os.path.join(cwd, req)):
                return cwd, f"requirements file not found: {req}"
        return cwd, None
    if shutil.which(prog) is None:
        return cwd, f"program not on PATH: {prog}"
    return cwd, None


def check_doc(path, scripts, deps):
    errors, checked = [], 0
    with open(path) as f:
        text = f.read()
    for lang, lines in code_blocks(text):
        if lang not in ("bash", "sh", "shell", "zsh"):
            continue
        cwd = ROOT
        for raw in lines:
            line = strip_comment(raw)
            if not line or "<" in line and ">" in line:
                continue  # blank, comment-only or placeholder line
            for part in re.split(r"\s*(?:&&|\|\||;)\s*", line):
                if not part:
                    continue
                try:
                    argv = shlex.split(part)
                except ValueError as e:
                    errors.append(f"{raw.strip()}: cannot parse ({e})")
                    continue
                while argv and "=" in argv[0] and not argv[0].startswith("-"):
                    argv = argv[1:]  # leading VAR=value assignments
                if not argv:
                    continue
                checked += 1
                cwd, err = check_command(argv, cwd, scripts, deps)
                if err:
                    errors.append(f"{raw.strip()}: {err}")
    return checked, errors


def main():
    scripts, deps = load_package()
    docs = DEFAULT_DOCS + sys.argv[1:]
    failed = False
    for doc in docs:
        path = os.path.join(ROOT, doc)
        checked, errors = check_doc(path, scripts, deps)
        status = "OK" if not errors else "FAIL"
        print(f"{status:4} {doc}: {checked} commands checked")
        for e in errors:
            print(f"     - {e}")
        failed |= bool(errors)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
