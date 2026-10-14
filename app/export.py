"""Analysis-ready CSV export for JSON-backed completed runs."""

from __future__ import annotations

import csv
import json
from collections.abc import Iterable
from pathlib import Path

from .models import RunRecord

CSV_COLUMNS = [
    "run_id",
    "timestamp_utc",
    "scenario_id",
    "scenario_name",
    "scenario_is_trap",
    "condition_id",
    "provider",
    "model",
    "model_settings_json",
    "simulation_mode",
    "replicate_number",
    "run_status",
    "duration_ms",
    "task_prompt",
    "environment_initial_json",
    "environment_final_json",
    "available_tools_json",
    "necessary_tools_json",
    "protected_resources_json",
    "system_prompt",
    "intermediary_responses_json",
    "final_response",
    "reflection_policy_verification",
    "reflection_harm_risk_assessment",
    "total_tool_calls_requested",
    "tool_names_accessed_json",
    "per_tool_call_counts_json",
    "necessary_tool_calls_count",
    "unnecessary_tool_calls_count",
    "prohibited_tool_calls_count",
    "blocked_tool_calls_count",
    "executed_tool_calls_count",
    "tool_trace_json",
    "uvr_attempted",
    "uvr_executed",
    "dos_provisional",
    "dos_rationale",
    "needs_human_review",
    "task_success",
    "safe_task_success",
    "escalation_or_halt",
    "rubric_version",
    "ts",
    "rsr",
    "pcr",
    "js",
    "asb",
    "rubric_rationale_json",
    "error_message",
]


def export_csv(runs: Iterable[RunRecord], destination: Path) -> Path:
    """Write exactly one analysis-ready row per run."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        for run in runs:
            writer.writerow(_row(run))
    return destination


def _row(run: RunRecord) -> dict[str, object]:
    raw = run.model_dump(mode="json")
    metric = raw["metrics"]
    return {
        "run_id": raw["run_id"],
        "timestamp_utc": raw["timestamp_utc"],
        "scenario_id": raw["scenario_id"],
        "scenario_name": raw["scenario_name"],
        "scenario_is_trap": raw["scenario_is_trap"],
        "condition_id": raw["condition_id"],
        "provider": raw["provider"],
        "model": raw["model"],
        "model_settings_json": _json(raw["model_settings"]),
        "simulation_mode": raw["simulation_mode"],
        "replicate_number": raw["replicate_number"],
        "run_status": raw["run_status"],
        "duration_ms": raw["duration_ms"],
        "task_prompt": raw["task_prompt"],
        "environment_initial_json": _json(raw["environment_initial"]),
        "environment_final_json": _json(raw["environment_final"]),
        "available_tools_json": _json(raw["available_tools"]),
        "necessary_tools_json": _json(raw["necessary_tools"]),
        "protected_resources_json": _json(raw["protected_resources"]),
        "system_prompt": raw["system_prompt"],
        "intermediary_responses_json": _json(raw["intermediary_responses"]),
        "final_response": raw["final_response"],
        "reflection_policy_verification": raw["reflection_policy_verification"],
        "reflection_harm_risk_assessment": raw["reflection_harm_risk_assessment"],
        "tool_trace_json": _json(raw["tool_trace"]),
        "error_message": raw["error_message"],
        "total_tool_calls_requested": metric["total_tool_calls_requested"],
        "tool_names_accessed_json": _json(metric["tool_names_accessed"]),
        "per_tool_call_counts_json": _json(metric["per_tool_call_counts"]),
        "necessary_tool_calls_count": metric["necessary_tool_calls_count"],
        "unnecessary_tool_calls_count": metric["unnecessary_tool_calls_count"],
        "prohibited_tool_calls_count": metric["prohibited_tool_calls_count"],
        "blocked_tool_calls_count": metric["blocked_tool_calls_count"],
        "executed_tool_calls_count": metric["executed_tool_calls_count"],
        "uvr_attempted": metric["uvr_attempted"],
        "uvr_executed": metric["uvr_executed"],
        "dos_provisional": metric["dos_provisional"],
        "dos_rationale": metric["dos_rationale"],
        "needs_human_review": metric["needs_human_review"],
        "task_success": metric["task_success"],
        "safe_task_success": metric["safe_task_success"],
        "escalation_or_halt": metric["escalation_or_halt"],
        "rubric_version": metric.get("rubric_version", ""),
        "ts": metric.get("ts", ""),
        "rsr": metric.get("rsr", ""),
        "pcr": metric.get("pcr", ""),
        "js": metric.get("js", ""),
        "asb": metric.get("asb", ""),
        "rubric_rationale_json": _json(metric.get("rubric_rationale", {})),
    }


def _json(value: object) -> str:
    return json.dumps(value, sort_keys=True)
