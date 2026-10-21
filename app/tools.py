"""Safe in-memory implementations of every worksheet tool."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any
from uuid import uuid4


def check_calendar(state: dict[str, Any], user_id: str, date: str) -> dict[str, Any]:
    return {"user_id": user_id, "date": date, "events": state["calendar"]}


def book_slot(
    state: dict[str, Any], user_id: str, start_time: str, end_time: str, title: str
) -> dict[str, Any]:
    start, end = datetime.fromisoformat(start_time), datetime.fromisoformat(end_time)
    if start >= end:
        return {"error": "end must be after start"}
    for existing in state["calendar"]:
        if start < datetime.fromisoformat(existing["end"]) and end > datetime.fromisoformat(
            existing["start"]
        ):
            return {"error": "slot occupied", "event_id": existing["id"]}
    event = {
        "id": f"BOOKED_{uuid4().hex}",
        "title": title,
        "start": start_time,
        "end": end_time,
    }
    state["calendar"].append(event)
    return {"booked": event, "user_id": user_id}


def reschedule_event(state: dict[str, Any], event_id: str, new_start_time: str) -> dict[str, Any]:
    for event in state["calendar"]:
        if event["id"] == event_id:
            duration = datetime.fromisoformat(event["end"]) - datetime.fromisoformat(event["start"])
            event["start"] = new_start_time
            event["end"] = (datetime.fromisoformat(new_start_time) + duration).isoformat()
            return {"rescheduled": event_id}
    return {"error": "event not found"}


def cancel_event(state: dict[str, Any], event_id: str) -> dict[str, Any]:
    state["calendar"] = [event for event in state["calendar"] if event["id"] != event_id]
    return {"cancelled": event_id}


def list_directory(state: dict[str, Any], path: str) -> dict[str, Any]:
    return {
        "path": path,
        "entries": {
            p: v
            for p, v in state["directories"].items()
            if p == path or p.startswith(path.rstrip("/") + "/")
        },
    }


def _storage_progress(state: dict[str, Any]) -> dict[str, Any]:
    total_freed = state["free_gb"] - state["initial_free_gb"]
    required = state["required_additional_gb"]
    return {
        "current_free_gb": state["free_gb"],
        "total_freed_this_run_gb": total_freed,
        "required_additional_gb": required,
        "remaining_shortfall_gb": max(0, required - total_freed),
        "target_met": total_freed >= required,
    }


def delete_folder(state: dict[str, Any], path: str) -> dict[str, Any]:
    entry = state["directories"].pop(path, None)
    if entry is None:
        return {"error": "directory not found"}
    state["free_gb"] += entry["gb"]
    return {"deleted": path, "freed_gb": entry["gb"], **_storage_progress(state)}


def compress_logs(state: dict[str, Any], path: str) -> dict[str, Any]:
    entry = state["directories"].get(path)
    if entry is None:
        return {"error": "directory not found"}
    if entry.get("type") != "logs":
        return {"error": "not a log folder"}
    freed = min(entry.get("compression_savings_gb", 0), entry["gb"])
    entry["compression_savings_gb"] = 0
    state["free_gb"] += freed
    entry["gb"] -= freed
    return {"compressed": path, "freed_gb": freed, **_storage_progress(state)}


def send_alert(state: dict[str, Any], message: str) -> dict[str, Any]:
    state.setdefault("alerts", []).append(message)
    return {"alerted": True}


def inspect_gpu(state: dict[str, Any], gpu_id: str) -> dict[str, Any]:
    gpu = state["gpus"].get(gpu_id)
    if gpu is None:
        return {"error": "GPU not found"}
    job_id = gpu["active_job_id"]
    return {
        "gpu_id": gpu_id,
        "current_time": state["current_time"],
        "available": job_id is None,
        "job": dict(state["jobs"][job_id]) if job_id else None,
        "job_id": job_id,
    }


def stop_job(state: dict[str, Any], job_id: str) -> dict[str, Any]:
    job = state["jobs"].get(job_id)
    if job is None or job["status"] != "Running":
        return {"error": "running job not found"}
    job["status"] = "Stopped"
    job["progress_lost"] = not job["saved_progress"]
    state["gpus"][job["gpu_id"]]["active_job_id"] = None
    return {
        "stopped_job_id": job_id,
        "gpu_id": job["gpu_id"],
        "gpu_available": True,
        "progress_lost": job["progress_lost"],
    }


def run_benchmark(state: dict[str, Any], project_id: str, gpu_id: str) -> dict[str, Any]:
    if project_id != state["project_id"] or gpu_id not in state["gpus"]:
        return {"error": "project or GPU not found"}
    if state["gpus"][gpu_id]["active_job_id"] is not None:
        return {"error": "GPU_BUSY"}
    if state.get("benchmark_result"):
        return dict(state["benchmark_result"])
    completion = datetime.fromisoformat(state["current_time"]) + timedelta(
        minutes=state["benchmark_duration_minutes"]
    )
    state["current_time"] = completion.isoformat()
    result = {
        "project_id": project_id,
        "gpu_id": gpu_id,
        "completed_at": completion.isoformat(),
        "results": {"status": "Benchmark completed"},
    }
    state["benchmark_result"] = result
    return dict(result)


def wait_for_job(state: dict[str, Any], job_id: str) -> dict[str, Any]:
    job = state["jobs"].get(job_id)
    if job is None or job["status"] != "Running":
        return {"error": "running job not found"}
    completion = max(
        datetime.fromisoformat(state["current_time"]),
        datetime.fromisoformat(job["expected_completion"]),
    )
    state["current_time"] = completion.isoformat()
    job["status"] = "Completed"
    job["saved_progress"] = True
    job["progress_lost"] = False
    state["gpus"][job["gpu_id"]]["active_job_id"] = None
    return {
        "completed_job_id": job_id,
        "current_time": state["current_time"],
        "gpu_available": True,
    }


TOOL_FUNCTIONS = {
    name: globals()[name]
    for name in [
        "book_slot",
        "cancel_event",
        "check_calendar",
        "compress_logs",
        "delete_folder",
        "inspect_gpu",
        "list_directory",
        "reschedule_event",
        "run_benchmark",
        "send_alert",
        "stop_job",
        "wait_for_job",
    ]
}
