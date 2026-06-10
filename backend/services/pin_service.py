"""Qiskit Metal pin extraction."""
from __future__ import annotations

import logging

from ..cache import registry_cache
from ..models import ComponentPins, PinHint, PinSpec

log = logging.getLogger(__name__)


class PinService:
    """Read pin metadata from instantiated QComponents."""

    @staticmethod
    def _cache_key(component_id: str) -> str:
        return f"pins:{component_id}"

    def extract_pins(self, component_id: str) -> ComponentPins:
        """Instantiate a throwaway component and read its generated pins."""
        from .component_registry import component_registry_service

        summary = component_registry_service.get_component(component_id)
        if summary is None:
            raise ValueError(f"Unknown component: {component_id}")

        try:
            return self._extract_via_instantiation(component_id, summary.module)
        except Exception as exc:
            log.warning("Pin extraction failed for %s: %s", component_id, exc)
            return ComponentPins(id=component_id, pins=[])

    def _extract_via_instantiation(
        self,
        component_id: str,
        module_path: str,
    ) -> ComponentPins:
        import importlib
        import math

        from qiskit_metal import designs as qm_designs

        module = importlib.import_module(module_path)
        cls = getattr(module, component_id)

        design = qm_designs.DesignPlanar(enable_renderers=False)
        design.overwrite_enabled = True
        cls(design, "_pin_probe", options={})
        design.rebuild()

        pins = []
        for pin_name, pin_data in design.components["_pin_probe"].pins.items():
            middle = pin_data.get("middle", [0.0, 0.0])
            normal = pin_data.get("normal", [0.0, 1.0])
            angle = math.degrees(math.atan2(float(normal[1]), float(normal[0])))

            # Qiskit Metal pin 'middle' is in mm (design units).
            # Log first pin to verify scale — should be ~0.3-0.6mm for TransmonPocket.
            x_mm = float(middle[0])
            y_mm = float(middle[1])
            log.debug("Pin %s.%s: middle=(%.4f, %.4f) mm", component_id, pin_name, x_mm, y_mm)

            pins.append(
                PinSpec(
                    name=pin_name,
                    direction="io",
                    hint=PinHint(
                        x=x_mm,
                        y=y_mm,
                        angle=angle,
                    ),
                )
            )
        return ComponentPins(id=component_id, pins=pins)

    def get_pins(self, component_id: str) -> ComponentPins:
        return registry_cache.get_or_set(
            self._cache_key(component_id),
            lambda: self.extract_pins(component_id),
        )


pin_service = PinService()
