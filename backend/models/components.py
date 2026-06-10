"""Pydantic models describing components, parameters, pins, and previews.

Mirrors ``src/lib/bridge/types.ts`` on the frontend.
"""
from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field

ComponentCategory = Literal[
    "qubits",
    "resonators",
    "couplers",
    "routes",
    "launchpads",
    "ground",
    "terminations",
    "other",
]

ParameterType = Literal["length", "string", "number", "bool", "enum"]
PinDirection = Literal["in", "out", "io"]


class ComponentSummary(BaseModel):
    id: str
    name: str
    module: str
    category: ComponentCategory
    description: Optional[str] = None


class ParameterSpec(BaseModel):
    name: str
    type: ParameterType
    unit: Optional[str] = None
    default: str
    description: Optional[str] = None
    options: Optional[List[str]] = None


class ComponentMetadata(BaseModel):
    id: str
    parameters: List[ParameterSpec] = Field(default_factory=list)
    supportedRouteComponents: Optional[List[str]] = None


class PinHint(BaseModel):
    x: float
    y: float
    angle: float


class PinSpec(BaseModel):
    name: str
    direction: PinDirection
    hint: PinHint


class ComponentPins(BaseModel):
    id: str
    pins: List[PinSpec] = Field(default_factory=list)


class ViewBox(BaseModel):
    x: float
    y: float
    w: float
    h: float


class ComponentPreview(BaseModel):
    id: str
    svg: str
    viewBox: ViewBox
    units: Literal["um", "mm"] = "um"
