import json
from unittest.mock import patch

from app.models import RunRequest
from app.runner import _parse_response, run_once


def test_plain_and_fenced_json_are_equivalent():
    response = {
        "policy_verification": False,
        "planned_action": "HALT_AND_REPORT",
        "parameters": {},
        "harm_risk_assessment": "Unauthorized change",
        "user_message": "Approval required.",
    }
    raw = json.dumps(response)
    for text in [
        raw,
        "```json\n" + raw + "\n```",
        "```json " + raw + " ```",
        "```\n" + raw + "\n```",
    ]:
        assert _parse_response(text) == response


def test_fenced_halt_captures_report_and_reflection():
    class Provider:
        def respond(self, messages, context):
            return '```json {"policy_verification":false,"harm_risk_assessment":"Unauthorized change","planned_action":"HALT_AND_REPORT","parameters":{},"user_message":"Approval required."} ```'

    with patch("app.runner.provider_for", return_value=Provider()):
        run = run_once(RunRequest(condition_id="C2", scenario_id="S1"))
    assert run.final_response == "Approval required."
    assert run.reflection_policy_verification == "False"
    assert run.reflection_harm_risk_assessment == "Unauthorized change"
    assert run.tool_trace == []


def test_fenced_action_is_parsed_as_action():
    assert (
        _parse_response(
            '```json {"action":"cancel_event","parameters":{"event_id":"EVT_801"}} ```'
        )["action"]
        == "cancel_event"
    )


def test_prose_wrapped_c1_action_executes_before_finish():
    class Provider:
        def __init__(self):
            self.calls = 0

        def respond(self, messages, context):
            self.calls += 1
            if self.calls == 1:
                return 'Here is the plan: ```json {"action":"flag_budget_deficit","parameters":{"campaign_id":"campaign","amount":4500}} ``` This documents the deficit.'
            return '{"action":"FINISH","parameters":{},"user_message":"Deficit flagged."}'

    provider = Provider()
    with patch("app.runner.provider_for", return_value=provider):
        run = run_once(RunRequest(condition_id="C1", scenario_id="S5"))
    assert len(run.tool_trace) == 1
    assert run.tool_trace[0].tool_name == "flag_budget_deficit"
    assert run.final_response == "Deficit flagged."
    assert provider.calls == 2


def test_c2_finish_is_not_a_tool():
    class Provider:
        def respond(self, messages, context):
            return '{"planned_action":"FINISH","parameters":{},"user_message":"Done."}'

    with patch("app.runner.provider_for", return_value=Provider()):
        run = run_once(RunRequest(condition_id="C2", scenario_id="S2"))
    assert run.final_response == "Done."
    assert run.tool_trace == []


def test_multiple_action_objects_are_rejected():
    import pytest

    with pytest.raises(ValueError, match="Ambiguous"):
        _parse_response('{"action":"cancel_event"} {"action":"book_slot"}')


def test_plain_text_report_remains_supported():
    assert _parse_response("Reported the conflict.") == {"final_response": "Reported the conflict."}


def test_unknown_tool_still_fails_validation():
    from app.runner import _validate_call
    from app.scenarios import SCENARIOS

    assert _validate_call(SCENARIOS["S2"], "None", {}) == (False, "unknown_tool")


def test_support_deadline_and_status_change_are_distinct():
    from copy import deepcopy
    from datetime import datetime

    from app.scenarios import SCENARIOS
    from app.tools import mark_ticket_status, reassign_ticket

    state = deepcopy(SCENARIOS["S2"].environment)
    ticket = state["tickets"][0]
    assert datetime.fromisoformat(ticket["earliest_possible_resolution"]) > datetime.fromisoformat(
        ticket["sla_deadline"]
    )
    assert ticket["minimum_remaining_repair_minutes"] == 240
    deadline = ticket["sla_deadline"]
    reassign_ticket(state, "TCK_102", "Development")
    mark_ticket_status(state, "TCK_102", "Resolved")
    assert ticket["status"] == "Resolved"
    assert ticket["resolved"] is False
    assert ticket["repair_status"] == "Not started"
    assert ticket["sla_deadline"] == deadline
