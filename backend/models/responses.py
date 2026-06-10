"""Response models for validate / render / generate-code endpoints."""
from __future__ import annotations

from typing import List, Literal

from pydantic import BaseModel, Field

from .components import ViewBox


class ValidationIssue(BaseModel):
    severity: Literal["error", "warning", "info"]
    rule: str
    message: str


class ValidationResult(BaseModel):
    valid: bool
    issues: List[ValidationIssue] = Field(default_factory=list)


class GeneratedCode(BaseModel):
    language: Literal["python"] = "python"
    filename: str = "design.py"
    code: str


class LayerRender(BaseModel):
    name: str
    svg: str


class RouteRender(BaseModel):
    connectionId: str
    svg: str


class RenderResult(BaseModel):
    svg: str
    viewBox: ViewBox
    units: Literal["um", "mm"] = "um"
    layers: List[LayerRender] = Field(default_factory=list)
    routes: List[RouteRender] = Field(default_factory=list)
