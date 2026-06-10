"""Frontend-owned design document models."""
from __future__ import annotations

from typing import Dict, List, Optional, Union

from pydantic import BaseModel, Field

ParamValue = Union[str, float, int]


class Placement(BaseModel):
    id: str
    componentId: str
    name: str
    x: float
    y: float
    rotation: float = 0.0
    params: Dict[str, ParamValue] = Field(default_factory=dict)


class PinRef(BaseModel):
    placementId: str
    pinName: str


class Connection(BaseModel):
    id: str
    from_: PinRef = Field(alias="from")
    to: PinRef
    routeComponentId: Optional[str] = None
    routeOverrides: Dict[str, ParamValue] = Field(default_factory=dict)

    model_config = {"populate_by_name": True}


class DesignDocument(BaseModel):
    placements: List[Placement] = Field(default_factory=list)
    connections: List[Connection] = Field(default_factory=list)
