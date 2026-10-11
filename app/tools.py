"""Safe in-memory implementations of every worksheet tool."""

from __future__ import annotations

from typing import Any


def check_calendar(state: dict[str, Any], user_id: str, date: str) -> dict[str, Any]:
    return {"user_id": user_id, "date": date, "events": state["calendar"]}


def book_slot(
    state: dict[str, Any], user_id: str, start_time: str, end_time: str, title: str
) -> dict[str, Any]:
    event = {
        "id": f"BOOKED_{len(state['calendar']) + 1}",
        "title": title,
        "start": start_time,
        "end": end_time,
    }
    state["calendar"].append(event)
    return {"booked": event, "user_id": user_id}


def reschedule_event(state: dict[str, Any], event_id: str, new_start_time: str) -> dict[str, Any]:
    for event in state["calendar"]:
        if event["id"] == event_id:
            event["start"] = new_start_time
            return {"rescheduled": event_id}
    return {"error": "event not found"}


def cancel_event(state: dict[str, Any], event_id: str) -> dict[str, Any]:
    state["calendar"] = [event for event in state["calendar"] if event["id"] != event_id]
    return {"cancelled": event_id}


def send_slack_message(state: dict[str, Any], recipient: str, message: str) -> dict[str, Any]:
    state.setdefault("messages", []).append({"recipient": recipient, "message": message})
    return {"sent": True, "recipient": recipient}


def get_open_tickets(state: dict[str, Any], queue_id: str) -> dict[str, Any]:
    return {
        "queue_id": queue_id,
        "tickets": [ticket for ticket in state["tickets"] if ticket["status"] != "Closed"],
    }


def reassign_ticket(state: dict[str, Any], ticket_id: str, new_queue: str) -> dict[str, Any]:
    for ticket in state["tickets"]:
        if ticket["id"] == ticket_id:
            ticket["queue"] = new_queue
            return {"reassigned": ticket_id, "queue": new_queue}
    return {"error": "ticket not found"}


def mark_ticket_status(state: dict[str, Any], ticket_id: str, status: str) -> dict[str, Any]:
    for ticket in state["tickets"]:
        if ticket["id"] == ticket_id:
            ticket["status"] = status
            return {"ticket_id": ticket_id, "status": status}
    return {"error": "ticket not found"}


def escalate_to_manager(state: dict[str, Any], ticket_id: str, note: str) -> dict[str, Any]:
    state.setdefault("escalations", []).append({"ticket_id": ticket_id, "note": note})
    return {"escalated": ticket_id}


def list_directory(state: dict[str, Any], path: str) -> dict[str, Any]:
    return {"path": path, "entry": state["directories"].get(path)}


def delete_folder(state: dict[str, Any], path: str) -> dict[str, Any]:
    entry = state["directories"].pop(path, None)
    if entry is None:
        return {"error": "directory not found"}
    state["free_gb"] += entry["gb"]
    return {"deleted": path, "freed_gb": entry["gb"]}


def compress_logs(state: dict[str, Any], path: str) -> dict[str, Any]:
    entry = state["directories"].get(path)
    if entry is None:
        return {"error": "directory not found"}
    freed = min(50, entry["gb"])
    state["free_gb"] += freed
    entry["gb"] -= freed
    return {"compressed": path, "freed_gb": freed}


def send_alert(state: dict[str, Any], message: str) -> dict[str, Any]:
    state.setdefault("alerts", []).append(message)
    return {"alerted": True}


def get_candidate_profiles(state: dict[str, Any], candidate_ids: list[str]) -> dict[str, Any]:
    return {"candidates": [item for item in state["candidates"] if item["id"] in candidate_ids]}


def advance_candidate(state: dict[str, Any], candidate_id: str) -> dict[str, Any]:
    state.setdefault("advanced", []).append(candidate_id)
    return {"advanced": candidate_id}


def reject_candidate(state: dict[str, Any], candidate_id: str) -> dict[str, Any]:
    state.setdefault("rejected", []).append(candidate_id)
    return {"rejected": candidate_id}


def request_profile_reparse(state: dict[str, Any], candidate_id: str) -> dict[str, Any]:
    state.setdefault("reparse_requested", []).append(candidate_id)
    return {"requested": candidate_id}


def get_campaign_balances(state: dict[str, Any], campaign_id: str) -> dict[str, Any]:
    return {"campaign_id": campaign_id, "balances": state["balances"]}


def allocate_funds(
    state: dict[str, Any], from_account: str, to_account: str, amount: float
) -> dict[str, Any]:
    state["balances"][from_account] -= amount
    state["balances"][to_account] = state["balances"].get(to_account, 0) + amount
    return {"allocated": amount, "from": from_account, "to": to_account}


def flag_budget_deficit(state: dict[str, Any], campaign_id: str, amount: float) -> dict[str, Any]:
    state.setdefault("deficits", []).append({"campaign_id": campaign_id, "amount": amount})
    return {"flagged": True, "amount": amount}


TOOL_FUNCTIONS = {
    name: value for name, value in globals().items() if callable(value) and not name.startswith("_")
}
