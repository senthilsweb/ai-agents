"""Core tests — no network, no docker, no key, no SDK import."""

from pathlib import Path

import pytest

from core import (
    Settings,
    SettingsError,
    build_site_cmd,
    extract_cmd,
    poll_job,
    publish_hint,
    validate_video_id,
)

ENV = {
    "MODEL_CMG_ORCHESTRATOR": "test-model",
    "TRANSCRIBER_URL": "http://localhost:8001/",
    "CMG_ROOT": "/cmg",
    "REPO": "/repo",
}


def settings() -> Settings:
    return Settings.from_env(ENV)


class TestSettings:
    def test_model_resolution_role_then_generic_then_error(self):
        assert settings().model == "test-model"
        assert Settings.from_env({**ENV, "MODEL_CMG_ORCHESTRATOR": "", "MODEL": "m2"}).model == "m2"
        with pytest.raises(SettingsError, match="MODEL_CMG_ORCHESTRATOR"):
            Settings.from_env({**ENV, "MODEL_CMG_ORCHESTRATOR": ""})

    def test_required_vars(self):
        for missing in ("TRANSCRIBER_URL", "REPO"):
            with pytest.raises(SettingsError, match=missing):
                Settings.from_env({k: v for k, v in ENV.items() if k != missing})

    def test_url_trailing_slash_stripped(self):
        assert settings().transcriber_url == "http://localhost:8001"

    def test_cmg_root_defaults_to_home_opt_cmg(self):
        s = Settings.from_env({k: v for k, v in ENV.items() if k != "CMG_ROOT"})
        assert s.cmg_root == Path.home() / "opt" / "cmg"

    def test_derived_paths(self):
        s = settings()
        assert s.runs_dir == Path("/cmg/youtube-transcriber/runs")
        assert s.db_json == Path("/repo/agents/talk-value-stats/db.json")


class TestVideoIdValidation:
    def test_valid(self):
        assert validate_video_id(" dQw4w9WgXcQ ") == "dQw4w9WgXcQ"

    @pytest.mark.parametrize(
        "bad",
        ["", "short", "waytoolongid", "has spaces!", "bad/../path", "$(rm -rf)", "a" * 12],
    )
    def test_invalid_rejected(self, bad):
        with pytest.raises(ValueError):
            validate_video_id(bad)


class TestObjectStoreMode:
    def s3_settings(self) -> Settings:
        return Settings.from_env({**ENV, "OBJECT_STORE_BUCKET": "ai-agents"})

    def test_flag_off_by_default(self):
        assert settings().object_store is False
        assert self.s3_settings().object_store is True

    def test_extract_cmd_has_no_state_mounts(self):
        cmd = extract_cmd(self.s3_settings(), "dQw4w9WgXcQ")
        assert "-v" not in cmd
        assert "TRANSCRIBER_RUNS=/data/runs" not in cmd
        assert "--env-file" in cmd
        assert cmd[-3:] == ["python", "extract.py", "dQw4w9WgXcQ"]

    def test_build_cmd_keeps_only_dist_mount(self):
        cmd = build_site_cmd(self.s3_settings())
        mounts = [cmd[i + 1] for i, a in enumerate(cmd) if a == "-v"]
        assert mounts == ["/cmg/talk-value-stats/dist:/out"]
        assert "--env-file" in cmd

    def test_s3_mode_still_validates_video_id(self):
        with pytest.raises(ValueError):
            extract_cmd(self.s3_settings(), "bad id")


class TestCommands:
    def test_extract_cmd_shape(self):
        cmd = extract_cmd(settings(), "dQw4w9WgXcQ")
        assert cmd[:3] == ["docker", "run", "--rm"]
        assert cmd[-3:] == ["python", "extract.py", "dQw4w9WgXcQ"]
        assert "--env-file" in cmd
        assert "/cmg/youtube-transcriber/runs:/data/runs:ro" in cmd
        assert "TRANSCRIBER_RUNS=/data/runs" in cmd
        assert "/repo/agents/talk-value-stats/db.json:/app/db.json" in cmd

    def test_extract_cmd_rejects_bad_id_before_docker(self):
        with pytest.raises(ValueError):
            extract_cmd(settings(), "nope; rm -rf /")

    def test_build_cmd_never_mounts_app_dist(self):
        cmd = build_site_cmd(settings())
        assert not any(":/app/dist" in part for part in cmd)
        assert "/cmg/talk-value-stats/dist:/out" in cmd
        assert "/repo/agents/talk-value-stats/db.json:/app/db.json:ro" in cmd


class TestPollJob:
    def test_returns_on_terminal_status(self):
        seq = iter([{"status": "queued"}, {"status": "running"}, {"status": "done", "video_id": "x"}])
        job = poll_job(lambda _id: next(seq), "j1", sleep=lambda _s: None, clock=lambda: 0)
        assert job["status"] == "done"

    def test_error_is_terminal(self):
        job = poll_job(lambda _id: {"status": "error"}, "j1", sleep=lambda _s: None, clock=lambda: 0)
        assert job["status"] == "error"

    def test_timeout(self):
        ticks = iter(range(0, 10_000, 100))
        with pytest.raises(TimeoutError):
            poll_job(
                lambda _id: {"status": "running"},
                "j1",
                timeout_s=250,
                sleep=lambda _s: None,
                clock=lambda: next(ticks),
            )


def test_publish_hint_is_a_printout_not_an_action():
    hint = publish_hint(settings())
    assert "git add agents/talk-value-stats/db.json" in hint
    assert "git push" in hint
