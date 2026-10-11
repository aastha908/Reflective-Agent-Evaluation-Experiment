"""FastAPI application for the local, file-backed research prototype."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.templating import Jinja2Templates

from .export import export_csv
from .models import RunRecord, RunRequest
from .runner import run_once
from .scenarios import SCENARIOS

ROOT = Path(__file__).resolve().parents[1]
RUNS_DIR = ROOT / "data" / "runs"
EXPORTS_DIR = ROOT / "data" / "exports"
RUNS_DIR.mkdir(parents=True, exist_ok=True)
EXPORTS_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Reflective AI Agent Evaluation")
templates = Jinja2Templates(directory=str(ROOT / "app" / "templates"))


@app.get("/", response_class=HTMLResponse)
def dashboard(request: Request) -> HTMLResponse:
    return templates.TemplateResponse(request, "index.html")


@app.get("/api/scenarios")
def scenarios() -> list[dict[str, Any]]:
    return [item.model_dump() for item in SCENARIOS.values()]


@app.get("/api/providers")
def providers() -> list[dict[str, str]]:
    return [
        {"id": "mock", "label": "Mock (offline)", "credential_reference": "No credential required"},
        {
            "id": "openai_compatible",
            "label": "OpenAI-compatible",
            "credential_reference": "LLM_API_KEY",
        },
    ]


@app.post("/api/runs")
def create_runs(request: RunRequest) -> dict[str, Any]:
    completed: list[RunRecord] = []
    for replicate in range(1, request.replicates + 1):
        run = run_once(request, replicate)
        _save_run(run)
        completed.append(run)
    return {"runs": [item.model_dump(mode="json") for item in completed]}


@app.get("/api/runs")
def list_runs(
    scenario_id: str | None = None,
    condition_id: str | None = None,
    model: str | None = None,
    date: str | None = None,
) -> list[dict[str, Any]]:
    runs = _load_runs()
    if scenario_id:
        runs = [run for run in runs if run.scenario_id == scenario_id]
    if condition_id:
        runs = [run for run in runs if run.condition_id == condition_id]
    if model:
        runs = [run for run in runs if model.lower() in run.model.lower()]
    if date:
        runs = [run for run in runs if run.timestamp_utc.date().isoformat() == date]
    return [run.model_dump(mode="json") for run in runs]


@app.get("/api/runs/{run_id}")
def get_run(run_id: str) -> dict[str, Any]:
    path = RUNS_DIR / f"{run_id}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Run not found")
    return json.loads(path.read_text(encoding="utf-8"))


@app.get("/api/runs/{run_id}/download")
def download_run(run_id: str) -> FileResponse:
    path = RUNS_DIR / f"{run_id}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Run not found")
    return FileResponse(path, media_type="application/json", filename=path.name)


@app.get("/api/results/aggregate")
def aggregate_results() -> dict[str, Any]:
    runs = _load_runs()
    return {
        "C1": _aggregate([run for run in runs if run.condition_id == "C1"]),
        "C2": _aggregate([run for run in runs if run.condition_id == "C2"]),
    }


@app.get("/api/exports/results.csv")
def download_results_csv() -> FileResponse:
    path = export_csv(_load_runs(), EXPORTS_DIR / "results.csv")
    return FileResponse(path, media_type="text/csv", filename="results.csv")


def _save_run(run: RunRecord) -> None:
    (RUNS_DIR / f"{run.run_id}.json").write_text(run.model_dump_json(indent=2), encoding="utf-8")


def _load_runs() -> list[RunRecord]:
    records: list[RunRecord] = []
    for path in RUNS_DIR.glob("*.json"):
        try:
            records.append(RunRecord.model_validate_json(path.read_text(encoding="utf-8")))
        except ValueError:
            continue
    return sorted(records, key=lambda item: item.timestamp_utc, reverse=True)


def _aggregate(runs: list[RunRecord]) -> dict[str, Any]:
    keys = [
        "uvr_attempted",
        "uvr_executed",
        "task_success",
        "safe_task_success",
        "total_tool_calls_requested",
        "prohibited_tool_calls_count",
    ]
    values = {key: sum(float(run.metrics[key]) for run in runs) for key in keys}
    return {
        "n": len(runs),
        **values,
        "mean_dos": (sum(run.metrics["dos_provisional"] for run in runs) / len(runs))
        if runs
        else None,
    }
