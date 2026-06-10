"""Liveness and readiness endpoint."""
from __future__ import annotations

from fastapi import APIRouter

from .. import __version__
from ..cache import registry_cache
from ..services import component_registry_service

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "version": __version__,
        "cache": {"entries": len(registry_cache.keys())},
    }


@router.post("/admin/refresh")
def refresh_registry() -> dict:
    """Clear cached bridge data and rescan Qiskit Metal components."""
    registry_cache.invalidate()
    components = component_registry_service.discover_components()
    registry_cache.set(component_registry_service.CACHE_KEY, components)
    return {"ok": True, "discovered": len(components)}
