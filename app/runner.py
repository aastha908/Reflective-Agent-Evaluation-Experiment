"""Single-process LLM interaction loop for one sandboxed run."""

from __future__ import annotations

import copy
import json
import time
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from .models import RunRecord, RunRequest, Scenario, ToolCallEvent
from .providers import provider_for
from .scenarios import C1_PROMPT, C2_PROMPT, SCENARIOS, scenario_payload
from .scoring import score_run
from .tools import TOOL_FUNCTIONS


def run_once(
    request: RunRequest,
    replicate_number: int = 1,
    cancel_check: Callable[[], bool] | None = None,
) -> RunRecord:
    """Run one condition/scenario cell entirely in memory."""
    scenario = SCENARIOS[request.scenario_id]
    started = time.perf_counter()
    timestamp = datetime.now(UTC)
    state = copy.deepcopy(scenario.environment)
    initial_state = copy.deepcopy(state)
    system_prompt = C1_PROMPT if request.condition_id == "C1" else C2_PROMPT
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": json.dumps(scenario_payload(scenario))},
    ]
    trace: list[ToolCallEvent] = []
    responses: list[str] = []
    final_response = ""
    reflection = {"policy_verification": "", "harm_risk_assessment": ""}
    error_message = ""
    status = "completed"
    provider = provider_for(request.provider)

    try:
        for turn in range(1, request.max_turns + 1):
            if cancel_check and cancel_check():
                status = "cancelled"
                final_response = "Run cancelled before the next model response."
                break
            raw = provider.respond(
                messages,
                {
                    "condition_id": request.condition_id,
                    "scenario_id": scenario.id,
                    "model": request.model,
                    "temperature": request.temperature,
                    "turn": turn,
                },
            )
            responses.append(raw)
            parsed = _parse_response(raw)
            reflection["policy_verification"] = str(
                parsed.get("policy_verification", reflection["policy_verification"])
            )
            reflection["harm_risk_assessment"] = str(
                parsed.get("harm_risk_assessment", reflection["harm_risk_assessment"])
            )
            action = parsed.get("action", parsed.get("planned_action"))
            parameters = parsed.get("parameters", {})

            if action == "HALT_AND_REPORT":
                final_response = str(parsed.get("user_message", "Agent halted and reported."))
                break
            if not isinstance(action, str):
                final_response = str(parsed.get("final_response", parsed.get("user_message", raw)))
                break
            if not isinstance(parameters, dict):
                parameters = {}

            event = ToolCallEvent(
                turn_number=turn,
                tool_name=action,
                arguments_json=json.dumps(parameters, sort_keys=True),
                requested_at=datetime.now(UTC),
            )
            trace.append(event)  # The requested tool call is recorded before validation/execution.
            valid, reason = _validate_call(scenario, action, parameters)
            event.is_valid_schema = valid
            event.validation_status = reason
            event.is_prohibited = _is_prohibited(scenario, action, parameters)
            if not valid:
                event.execution_status = "invalid"
                result = {"error": reason}
            elif event.is_prohibited and request.simulation_mode == "block_prohibited":
                event.execution_status = "blocked"
                result = {"blocked": True, "reason": "Prohibited by scenario policy."}
            else:
                event.execution_status = "executed"
                result = TOOL_FUNCTIONS[action](state, **parameters)
            event.result_json = json.dumps(result, sort_keys=True)
            messages.extend(
                [
                    {"role": "assistant", "content": raw},
                    {
                        "role": "user",
                        "content": f"Simulated tool result: {event.result_json}. Provide the next JSON response.",
                    },
                ]
            )
        else:
            final_response = "Run ended at the configured maximum turn count."
    except Exception as exc:
        status = "failed"
        error_message = str(exc)
        final_response = final_response or "Run failed before a final response."

    metrics = score_run(scenario, trace, final_response, state, reflection)
    captured_parameters = _last_field(responses, "parameters")
    return RunRecord(
        timestamp_utc=timestamp,
        scenario_id=scenario.id,
        scenario_name=scenario.name,
        condition_id=request.condition_id,
        provider=request.provider,
        model=request.model,
        model_settings={"temperature": request.temperature, "max_turns": request.max_turns},
        simulation_mode=request.simulation_mode,
        replicate_number=replicate_number,
        run_status=status,
        duration_ms=round((time.perf_counter() - started) * 1000),
        task_prompt=scenario.task_prompt,
        environment_initial=initial_state,
        environment_final=state,
        available_tools=scenario.tools,
        necessary_tools=scenario.necessary_tools,
        protected_resources=scenario.protected_resources,
        system_prompt=system_prompt,
        intermediary_responses=responses,
        final_response=final_response,
        reflection_policy_verification=reflection["policy_verification"],
        reflection_harm_risk_assessment=reflection["harm_risk_assessment"],
        reflection_planned_action=str(_last_field(responses, "planned_action")),
        reflection_parameters=(
            captured_parameters if isinstance(captured_parameters, dict) else {}
        ),
        reflection_user_message=str(_last_field(responses, "user_message")),
        tool_trace=trace,
        metrics=metrics,
        error_message=error_message,
    )


def _last_field(responses: list[str], field: str) -> Any:
    for response in reversed(responses):
        value = _parse_response(response).get(field)
        if value is not None:
            return value
    return ""


def _parse_response(raw: str) -> dict[str, Any]:
    """Only JSON objects count as structured model output or structured tool calls."""
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        return {"final_response": raw}
    return value if isinstance(value, dict) else {"final_response": raw}


def _validate_call(
    scenario: Scenario, tool_name: str, parameters: dict[str, Any]
) -> tuple[bool, str]:
    tool = next((item for item in scenario.tools if item.name == tool_name), None)
    if tool is None:
        return False, "unknown_tool"
    required = tool.parameters["required"]
    properties = tool.parameters["properties"]
    if set(parameters) - set(properties):
        return False, "unexpected_parameter"
    for name in required:
        if name not in parameters:
            return False, "missing_required_parameter"
        expected = properties[name]
        if not _matches_type(parameters[name], expected):
            return False, "invalid_parameter_type"
    return True, "valid"


def _matches_type(value: Any, expected: str) -> bool:
    return {
        "string": isinstance(value, str),
        "number": isinstance(value, (int, float)) and not isinstance(value, bool),
        "array": isinstance(value, list),
    }.get(expected, False)


def _is_prohibited(scenario: Scenario, tool_name: str, parameters: dict[str, Any]) -> bool:
    for rule in scenario.prohibited_actions:
        if rule["tool"] != tool_name:
            continue
        if all(
            parameters.get(key) in value
            if isinstance(value, list)
            else parameters.get(key) == value
            for key, value in rule.items()
            if key != "tool"
        ):
            return True
    return False
