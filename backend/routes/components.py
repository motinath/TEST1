"""Component discovery / metadata / pin / preview routes."""
from __future__ import annotations

import asyncio
import json
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query

from ..models import (
    ComponentMetadata,
    ComponentPins,
    ComponentPreview,
    ComponentSummary,
)
from ..services import (
    component_registry_service,
    metadata_service,
    pin_service,
    render_service,
)

router = APIRouter(prefix="/components", tags=["components"])


@router.get("", response_model=List[ComponentSummary])
async def list_components() -> List[ComponentSummary]:
    # Run in a thread pool so the slow first-time qiskit-metal import doesn't
    # block the event loop and cause timeouts.
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, component_registry_service.list_components)


@router.get("/{component_id}", response_model=ComponentSummary)
def get_component(component_id: str) -> ComponentSummary:
    summary = component_registry_service.get_component(component_id)
    if summary is None:
        raise HTTPException(status_code=404, detail=f"Unknown component: {component_id}")
    return summary


@router.get("/{component_id}/metadata", response_model=ComponentMetadata)
def get_metadata(component_id: str) -> ComponentMetadata:
    return metadata_service.get_metadata(component_id)


@router.get("/{component_id}/pins", response_model=ComponentPins)
def get_pins(component_id: str) -> ComponentPins:
    return pin_service.get_pins(component_id)


@router.get("/{component_id}/preview", response_model=ComponentPreview)
def get_preview(
    component_id: str,
    params: Optional[str] = Query(default=None, description="URL-encoded JSON object"),
) -> ComponentPreview:
    parsed = None
    if params:
        try:
            parsed = json.loads(params)
        except json.JSONDecodeError as exc:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid params JSON: {exc.msg}",
            ) from exc
    return render_service.render_component_preview(component_id, parsed)
