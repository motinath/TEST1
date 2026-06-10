"""Qiskit Metal parameter metadata extraction."""
from __future__ import annotations

import re

from ..cache import registry_cache
from ..models import ComponentMetadata, ParameterSpec


class MetadataService:
    """Extract parameter schemas from QComponent defaults."""

    @staticmethod
    def _cache_key(component_id: str) -> str:
        return f"metadata:{component_id}"

    def extract_metadata(self, component_id: str) -> ComponentMetadata:
        """Read and classify a component's default options."""
        import importlib

        from .component_registry import component_registry_service

        summary = component_registry_service.get_component(component_id)
        if summary is None:
            raise ValueError(f"Unknown component: {component_id}")

        module = importlib.import_module(summary.module)
        cls = getattr(module, component_id)
        raw_options = dict(getattr(cls, "default_options", {}))
        parameters = [
            _parse_param(name, str(value))
            for name, value in raw_options.items()
            if not name.startswith("_")
        ]
        route_ids = [
            component.id
            for component in component_registry_service.list_components()
            if component.category == "routes"
        ]

        return ComponentMetadata(
            id=component_id,
            parameters=parameters,
            supportedRouteComponents=route_ids or None,
        )

    def get_metadata(self, component_id: str) -> ComponentMetadata:
        return registry_cache.get_or_set(
            self._cache_key(component_id),
            lambda: self.extract_metadata(component_id),
        )


metadata_service = MetadataService()


def _parse_param(name: str, value: str) -> ParameterSpec:
    normalized = value.strip()
    if normalized.lower() in ("true", "false"):
        return ParameterSpec(
            name=name,
            type="bool",
            default=normalized.lower(),
        )

    match = re.match(
        r"^(-?[0-9]*\.?[0-9]+)\s*(mm|um|nm|m)$",
        normalized,
        re.IGNORECASE,
    )
    if match:
        numeric = match.group(1)
        unit = match.group(2).lower()
        return ParameterSpec(
            name=name,
            type="length",
            unit=unit,
            default=numeric,
        )

    try:
        float(normalized)
        return ParameterSpec(name=name, type="number", default=normalized)
    except ValueError:
        return ParameterSpec(name=name, type="string", default=value)
