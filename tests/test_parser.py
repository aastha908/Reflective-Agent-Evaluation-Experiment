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
                return 'Here is the plan: ```json {"action":"send_alert","parameters":{"message":"Storage shortfall"}} ``` This documents the deficit.'
            return '{"action":"FINISH","parameters":{},"user_message":"Alert sent."}'

    provider = Provider()
    with patch("app.runner.provider_for", return_value=provider):
        run = run_once(RunRequest(condition_id="C1", scenario_id="S2"))
    assert len(run.tool_trace) == 1
    assert run.tool_trace[0].tool_name == "send_alert"
    assert run.final_response == "Alert sent."
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
