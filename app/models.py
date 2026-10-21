"""Pydantic models shared by the small research prototype."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, Field

ConditionId = Literal["C1", "C2"]
SimulationMode = Literal["block_prohibited", "observe_only"]


class ToolSpec(BaseModel):
    name: str
    description: str
    parameters: dict[str, Any]


class Scenario(BaseModel):
    id: str
    name: str
    is_trap: bool = False
    task_prompt: str
    environment: dict[str, Any]
    tools: list[ToolSpec]
    protected_resources: list[str]
    prohibited_actions: list[dict[str, Any]]
    safe_alternatives: list[str]
    success_conditions: list[str]
    necessary_tools: list[str] = Field(default_factory=list)


class ToolCallEvent(BaseModel):
    call_id: str = Field(default_factory=lambda: str(uuid4()))
    turn_number: int
    tool_name: str
    arguments_json: str
    requested_at: datetime
    is_valid_schema: bool = False
    is_prohibited: bool = False
    validation_status: str = "recorded"
    execution_status: str = "not_executed"
    result_json: str = ""


class RunRequest(BaseModel):
    provider: Literal["mock", "openai_compatible", "hkust"] = "mock"
    model: str = "mock-deterministic-v1"
    condition_id: ConditionId
    scenario_id: str
    replicates: int = Field(default=1, ge=1, le=25)
    temperature: float = Field(default=0, ge=0, le=2)
    max_turns: int = Field(default=4, ge=1, le=12)
    simulation_mode: SimulationMode = "block_prohibited"


class RunRecord(BaseModel):
    run_id: str = Field(default_factory=lambda: str(uuid4()))
    timestamp_utc: datetime
    scenario_id: str
    scenario_name: str
    scenario_is_trap: bool = False
    condition_id: ConditionId
    provider: str
    model: str
    model_settings: dict[str, Any]
    simulation_mode: SimulationMode
    replicate_number: int
    run_status: Literal["completed", "failed", "cancelled"]
    duration_ms: int
    task_prompt: str
    environment_initial: dict[str, Any]
    environment_final: dict[str, Any]
    available_tools: list[ToolSpec]
    necessary_tools: list[str]
    protected_resources: list[str]
    system_prompt: str
    intermediary_responses: list[str]
    final_response: str
    reflection_policy_verification: str = ""
    reflection_harm_risk_assessment: str = ""
    reflection_planned_action: str = ""
    reflection_parameters: dict[str, Any] = Field(default_factory=dict)
    reflection_user_message: str = ""
    tool_trace: list[ToolCallEvent]
    metrics: dict[str, Any]
    error_message: str = ""
