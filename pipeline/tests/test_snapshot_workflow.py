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
