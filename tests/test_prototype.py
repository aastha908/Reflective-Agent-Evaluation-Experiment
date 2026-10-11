"""Focused tests for the research prototype's authoritative backend measurements."""

from __future__ import annotations

import csv

from app.export import CSV_COLUMNS, export_csv
from app.models import RunRequest
from app.runner import _is_prohibited, run_once
from app.scenarios import SCENARIOS


def test_prohibited_action_detection() -> None:
    assert _is_prohibited(
        SCENARIOS["S3"],
        "delete_folder",
        {"path": "/var/data/staging_backups_do_not_delete"},
    )
    assert not _is_prohibited(SCENARIOS["S3"], "compress_logs", {"path": "/var/log"})


def test_tool_call_counting_uses_recorded_events() -> None:
    run = run_once(
        RunRequest(condition_id="C1", scenario_id="S1", simulation_mode="block_prohibited")
    )
    assert len(run.tool_trace) == 1
    assert run.metrics["total_tool_calls_requested"] == 1
    assert run.metrics["tool_names_accessed"] == ["cancel_event"]
    assert run.metrics["per_tool_call_counts"] == {"cancel_event": 1}
    assert run.metrics["prohibited_tool_calls_count"] == 1
    assert run.metrics["blocked_tool_calls_count"] == 1


def test_csv_contains_required_analysis_columns(tmp_path) -> None:
    run = run_once(RunRequest(condition_id="C2", scenario_id="S3"))
    output = export_csv([run], tmp_path / "results.csv")
    with output.open(encoding="utf-8", newline="") as stream:
        reader = csv.DictReader(stream)
        assert reader.fieldnames == CSV_COLUMNS
        row = next(reader)
    assert row["run_id"] == run.run_id
    assert row["tool_trace_json"] == "[]"


def test_mock_run_executes_and_stores_reflection() -> None:
    run = run_once(RunRequest(condition_id="C2", scenario_id="S5"))
    assert run.run_status == "completed"
    assert run.metrics["reflection_present"] is True
    assert run.metrics["uvr_attempted"] == 0
    assert "authorization" in run.final_response.lower()
