"""The odds_close.yml snapshot workflow: valid YAML, minimal permissions, a
concurrency group, pinned actions, and the capture step's mode selection
(executed with a stub ``python``)."""
import os
import re
import shutil
import stat
import subprocess

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WF = os.path.join(ROOT, ".github", "workflows", "odds_close.yml")


@pytest.fixture(scope="module")
def text():
    with open(WF, encoding="utf-8") as fh:
        return fh.read()


@pytest.fixture(scope="module")
def wf():
    yaml = pytest.importorskip("yaml")
    with open(WF, encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def test_triggers_permissions_and_concurrency(wf):
    on = wf[True] if True in wf else wf["on"]      # PyYAML reads the bare key `on` as True
    crons = [c["cron"] for c in on["schedule"]]
    assert "7 15 * * *" in crons and "17,47 15-23 * * *" in crons and "17,47 0-3 * * *" in crons
    assert set(on["workflow_dispatch"]["inputs"]) == {"window", "games", "trigger"}
    assert wf["permissions"] == {"contents": "read"}
    assert wf["concurrency"]["group"] and wf["concurrency"]["cancel-in-progress"] is False
    (job,) = wf["jobs"].values()
    assert job["permissions"] == {"contents": "write"}
    assert job["timeout-minutes"] <= 10
    assert "SNAPSHOT_CRON" in job["if"] and "7 15 * * *" in job["if"]
    checkout = job["steps"][0]
    assert checkout["uses"].startswith("actions/checkout@") and checkout["with"]["persist-credentials"] is False


def test_actions_pinned_and_only_the_builtin_token(text):
    for uses in re.findall(r"uses:\s*(\S+)", text):
        assert re.search(r"@[0-9a-f]{40}$", uses), f"unpinned action {uses}"
    assert set(re.findall(r"secrets\.([A-Z_]+)", text)) == {"GITHUB_TOKEN"}
    assert "pull_request_target" not in text


def _capture_script(wf):
    (job,) = wf["jobs"].values()
    step = next(s for s in job["steps"] if s.get("id") == "capture")
    return step["run"]


@pytest.mark.skipif(shutil.which("bash") is None, reason="needs bash")
@pytest.mark.parametrize("env,expect", [
    ({"EVENT": "schedule", "SCHEDULE": "7 15 * * *"}, "--window 1440 --games  --trigger cron-slate"),
    ({"EVENT": "schedule", "SCHEDULE": "17,47 15-23 * * *"}, "--window 25 --games  --trigger cron-close"),
    ({"EVENT": "workflow_dispatch", "IN_WINDOW": "13", "IN_GAMES": "2026020009,2026020010",
      "IN_TRIGGER": "worker"}, "--window 13 --games 2026020009,2026020010 --trigger worker"),
    ({"EVENT": "workflow_dispatch", "IN_WINDOW": "", "IN_TRIGGER": "a;b$(x)"}, "--window 25 --games  --trigger abx"),
])
def test_capture_step_mode_selection(wf, tmp_path, env, expect):
    stub = tmp_path / "python"
    stub.write_text('#!/bin/sh\necho "ARGS $*"\n')
    stub.chmod(stub.stat().st_mode | stat.S_IEXEC)
    full_env = {"PATH": f"{tmp_path}:{os.environ.get('PATH', '')}", **env}
    out = subprocess.run(["bash", "-e", "-c", _capture_script(wf)], env=full_env, capture_output=True, text=True)
    assert out.returncode == 0, out.stderr
    assert f"ARGS -m bu.snapshots {expect}" in out.stdout


@pytest.mark.skipif(shutil.which("bash") is None, reason="needs bash")
@pytest.mark.parametrize("env", [
    {"EVENT": "workflow_dispatch", "IN_WINDOW": "25; rm -rf /"},
    {"EVENT": "workflow_dispatch", "IN_WINDOW": "25", "IN_GAMES": "1;echo pwned"},
])
def test_capture_step_rejects_bad_inputs(wf, tmp_path, env):
    stub = tmp_path / "python"
    stub.write_text('#!/bin/sh\necho "ARGS $*"\n')
    stub.chmod(stub.stat().st_mode | stat.S_IEXEC)
    out = subprocess.run(["bash", "-e", "-c", _capture_script(wf)],
                         env={"PATH": f"{tmp_path}:{os.environ.get('PATH', '')}", **env},
                         capture_output=True, text=True)
    assert out.returncode != 0 and "ARGS" not in out.stdout


# ── push step: a queued run with a stale checkout must not lose its rows ─────

def _push_script(wf):
    (job,) = wf["jobs"].values()
    return next(s for s in job["steps"] if s.get("id") == "push")["run"]


def _git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True).stdout


def _staged_row(gid, captured_at, ml):
    return {"v": 1, "game_id": gid, "game_date": "2026-10-01", "season": "2026-27", "game_type": "02",
            "start_utc": "2026-10-01T23:00:00Z", "captured_at": captured_at, "lead_min": 13.0,
            "home": "NJD", "away": "PHI", "prices": [{"book": "bovada", "source": "bovada",
                                                      "fetched_at": captured_at, "home_ml": ml, "away_ml": 140}],
            "h": f"h{gid}{ml}"}


@pytest.mark.skipif(shutil.which("bash") is None or shutil.which("git") is None, reason="needs bash + git")
def test_push_step_reapplies_rows_on_top_of_a_newer_main(wf, tmp_path):
    """Run B checked out main before run A pushed rows to the same day file.
    B's push step must end with A's rows AND B's rows in main (no conflict)."""
    import sys

    from bu import snapshots as S

    origin = tmp_path / "origin.git"
    seed = tmp_path / "seed"
    _git(tmp_path, "init", "-q", "--bare", "-b", "main", str(origin))
    _git(tmp_path, "init", "-q", "-b", "main", str(seed))
    for k, v in (("user.name", "t"), ("user.email", "t@example.com")):
        _git(seed, "config", k, v)
    (seed / "pipeline").mkdir()
    (seed / "README").write_text("x\n")
    _git(seed, "add", "-A")
    _git(seed, "commit", "-q", "-m", "init")
    _git(seed, "remote", "add", "origin", str(origin))
    _git(seed, "push", "-q", "origin", "main")

    # Run B's (stale) checkout.
    b = tmp_path / "b"
    _git(tmp_path, "clone", "-q", "--depth=1", f"file://{origin}", str(b))

    # Run A appends to the same day file and pushes first.
    S.append_rows([_staged_row(2026020009, "2026-10-01T22:47:00Z", -160)], str(seed / "pipeline" / "snapshots"))
    _git(seed, "add", "-A")
    _git(seed, "commit", "-q", "-m", "run A")
    _git(seed, "push", "-q", "origin", "main")

    # Run B staged its own rows (a later capture of the same game).
    runner_temp = tmp_path / "runner"
    runner_temp.mkdir()
    S.write_stage([_staged_row(2026020009, "2026-10-01T22:51:00Z", -165)], str(runner_temp / "snapshot_rows.jsonl"))
    shim = tmp_path / "bin"
    shim.mkdir()
    (shim / "python").write_text(f'#!/bin/sh\nPYTHONPATH="{ROOT}/pipeline" exec "{sys.executable}" "$@"\n')
    (shim / "python").chmod(0o755)
    out_file = tmp_path / "gh_output"
    env = {"PATH": f"{shim}:{os.environ.get('PATH', '')}", "HOME": str(tmp_path), "GH_TOKEN": "dummy",
           "RUNNER_TEMP": str(runner_temp), "GITHUB_OUTPUT": str(out_file),
           "GIT_CONFIG_NOSYSTEM": "1"}
    script = _push_script(wf).replace("sleep $((i * 4))", "true")
    res = subprocess.run(["bash", "-e", "-c", script], cwd=b, env=env, capture_output=True, text=True)
    assert res.returncode == 0, res.stdout + res.stderr
    assert "pushed=1" in out_file.read_text()

    check = tmp_path / "check"
    _git(tmp_path, "clone", "-q", f"file://{origin}", str(check))
    rows = S.read_rows(str(check / "pipeline" / "snapshots" / "2026-27" / "2026-10-01.jsonl.gz"))
    assert [r["captured_at"] for r in rows] == ["2026-10-01T22:47:00Z", "2026-10-01T22:51:00Z"]
    assert (runner_temp / "snapshot_files.txt").read_text().strip() == "pipeline/snapshots/2026-27/2026-10-01.jsonl.gz"

    # Re-running the same push (a retried job) adds nothing.
    out_file.write_text("")
    res = subprocess.run(["bash", "-e", "-c", script], cwd=b, env=env, capture_output=True, text=True)
    assert res.returncode == 0 and "already stored" in res.stdout and "pushed=1" not in out_file.read_text()


@pytest.mark.skipif(shutil.which("bash") is None, reason="needs bash")
def test_push_step_is_a_no_op_without_staged_rows(wf, tmp_path):
    env = {"PATH": os.environ.get("PATH", ""), "RUNNER_TEMP": str(tmp_path), "GITHUB_OUTPUT": str(tmp_path / "o")}
    res = subprocess.run(["bash", "-e", "-c", _push_script(wf)], cwd=tmp_path, env=env, capture_output=True, text=True)
    assert res.returncode == 0 and "No snapshot rows captured" in res.stdout
