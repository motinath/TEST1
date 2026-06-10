"""Subprocess-isolated Qiskit Metal rendering."""
from __future__ import annotations

import io
import logging
import multiprocessing
from queue import Empty
from typing import Dict, Optional

from ..models import (
    ComponentPreview,
    DesignDocument,
    RenderResult,
    ValidationIssue,
    ValidationResult,
    ViewBox,
)

log = logging.getLogger(__name__)

COMPONENT_RENDER_TIMEOUT = 30
DESIGN_RENDER_TIMEOUT = 60


class RenderService:
    """Render components and designs without sharing Qiskit Metal state."""

    def render_component_preview(
        self,
        component_id: str,
        params: Optional[Dict[str, object]] = None,
    ) -> ComponentPreview:
        from .component_registry import component_registry_service

        summary = component_registry_service.get_component(component_id)
        if summary is None:
            raise ValueError(f"Unknown component: {component_id}")

        result = _subprocess_render(
            _worker_component_svg,
            (component_id, summary.module, params or {}),
            timeout=COMPONENT_RENDER_TIMEOUT,
        )
        if isinstance(result, dict):
            svg_fragment = str(result.get("fragment", ""))
            raw_view_box = result.get("vb", [-500, -500, 1000, 1000])
            if (
                isinstance(raw_view_box, list)
                and len(raw_view_box) == 4
            ):
                view_box = ViewBox(
                    x=float(raw_view_box[0]),
                    y=float(raw_view_box[1]),
                    w=float(raw_view_box[2]),
                    h=float(raw_view_box[3]),
                )
            else:
                view_box = ViewBox(x=-500, y=-500, w=1000, h=1000)
        else:
            svg_fragment = str(result or "")
            view_box = ViewBox(x=-500, y=-500, w=1000, h=1000)

        return ComponentPreview(
            id=component_id,
            svg=svg_fragment,
            viewBox=view_box,
            units="um",
        )

    def render_design(self, design: DesignDocument) -> RenderResult:
        result = _subprocess_render(
            _worker_full_design,
            (_design_to_graph(design),),
            timeout=DESIGN_RENDER_TIMEOUT,
        )
        return RenderResult(
            svg=result if isinstance(result, str) else "",
            viewBox=ViewBox(x=-4500, y=-3000, w=9000, h=6000),
            units="um",
            layers=[],
            routes=[],
        )

    def validate_design(self, design: DesignDocument) -> ValidationResult:
        """Check references and reject component self-loops."""
        issues = []
        placement_ids = {placement.id for placement in design.placements}

        if not design.placements:
            issues.append(
                ValidationIssue(
                    severity="warning",
                    rule="non-empty",
                    message="Design has no placements.",
                )
            )

        for connection in design.connections:
            if connection.from_.placementId not in placement_ids:
                issues.append(
                    ValidationIssue(
                        severity="error",
                        rule="dangling-from",
                        message=(
                            f"Connection {connection.id}: source placement "
                            f"'{connection.from_.placementId}' does not exist."
                        ),
                    )
                )
            if connection.to.placementId not in placement_ids:
                issues.append(
                    ValidationIssue(
                        severity="error",
                        rule="dangling-to",
                        message=(
                            f"Connection {connection.id}: target placement "
                            f"'{connection.to.placementId}' does not exist."
                        ),
                    )
                )
            if connection.from_.placementId == connection.to.placementId:
                issues.append(
                    ValidationIssue(
                        severity="error",
                        rule="no-self-loop",
                        message=(
                            f"Connection {connection.id} connects a component "
                            "to itself."
                        ),
                    )
                )

        valid = not any(issue.severity == "error" for issue in issues)
        return ValidationResult(valid=valid, issues=issues)


render_service = RenderService()


def _design_to_graph(design: DesignDocument) -> dict:
    placement_names = {placement.id: placement.name for placement in design.placements}
    return {
        "components": [
            {
                "instanceName": placement.name,
                "componentId": placement.componentId,
                "options": {
                    key: str(value) for key, value in placement.params.items()
                },
                "position": {"x": placement.x, "y": placement.y},
                "rotation": placement.rotation,
            }
            for placement in design.placements
        ],
        "connections": [
            {
                "id": connection.id,
                "sourceComponentName": placement_names.get(
                    connection.from_.placementId,
                    connection.from_.placementId,
                ),
                "sourcePinName": connection.from_.pinName,
                "targetComponentName": placement_names.get(
                    connection.to.placementId,
                    connection.to.placementId,
                ),
                "targetPinName": connection.to.pinName,
                "routeComponentId": (
                    connection.routeComponentId or "RouteMeander"
                ),
                "routeOverrides": {
                    key: str(value)
                    for key, value in connection.routeOverrides.items()
                },
            }
            for connection in design.connections
        ],
    }


def _worker_component_svg(queue: multiprocessing.Queue, args: tuple) -> None:
    component_id, module_path, options = args
    try:
        import importlib
        from qiskit_metal import designs

        module = importlib.import_module(module_path)
        cls = getattr(module, component_id)

        design = designs.DesignPlanar(enable_renderers=False)
        design.overwrite_enabled = True
        cls(design, "preview", options=options)
        design.rebuild()

        # Extract Shapely geometry from qgeometry tables
        # Qiskit Metal stores geometry in mm; we convert to um for the viewBox
        MM_TO_UM = 1000.0
        COLORS = {
            "poly": "#5B9BD5",
            "path": "#2E5FA3",
            "junction": "#D4820A",
        }

        all_bounds = []
        path_elements = []

        try:
            tables = design.qgeometry.tables
            for table_name, gdf in tables.items():
                # Filter rows belonging to "preview"
                mask = gdf["component"] == "preview" if "component" in gdf.columns else slice(None)
                rows = gdf[mask] if "component" in gdf.columns else gdf

                color = COLORS.get(table_name, "#5B9BD5")
                for _, row in rows.iterrows():
                    geom = row["geometry"] if "geometry" in row.index else None
                    if geom is None or (hasattr(geom, "is_empty") and geom.is_empty):
                        continue
                    all_bounds.append(geom.bounds)
                    _geom_to_svg_paths(geom, color, MM_TO_UM, path_elements)
        except Exception:
            log.exception("Geometry extraction failed for %s", component_id)
            queue.put("")
            return

        if not path_elements or not all_bounds:
            queue.put("")
            return

        # Compute bounding box in um with 10% padding
        min_x = min(b[0] for b in all_bounds) * MM_TO_UM
        min_y = min(b[1] for b in all_bounds) * MM_TO_UM
        max_x = max(b[2] for b in all_bounds) * MM_TO_UM
        max_y = max(b[3] for b in all_bounds) * MM_TO_UM
        pad = max(max_x - min_x, max_y - min_y) * 0.1 + 20  # at least 20um padding

        vb_x = min_x - pad
        vb_y = min_y - pad
        vb_w = (max_x - min_x) + 2 * pad
        vb_h = (max_y - min_y) + 2 * pad

        fragment = "\n".join(path_elements)
        queue.put({"fragment": fragment, "vb": [vb_x, vb_y, vb_w, vb_h]})

    except Exception:
        log.exception("Component SVG worker failed for %s", component_id)
        queue.put("")


def _geom_to_svg_paths(geom, color: str, scale: float, out: list) -> None:
    """Recursively convert Shapely geometry to SVG path strings. Appends to out list."""
    gtype = geom.geom_type
    if gtype == "Polygon":
        d = _polygon_d(geom, scale)
        if d:
            out.append(f'<path d="{d}" fill="{color}" fill-opacity="0.85" stroke="none"/>')
    elif gtype in ("MultiPolygon", "GeometryCollection"):
        for g in geom.geoms:
            _geom_to_svg_paths(g, color, scale, out)
    elif gtype == "LineString":
        coords = list(geom.coords)
        if len(coords) >= 2:
            pts = " ".join(f"{x * scale:.1f},{y * scale:.1f}" for x, y in coords)
            out.append(f'<polyline points="{pts}" fill="none" stroke="{color}" stroke-width="10" stroke-linecap="round"/>')
    elif gtype == "MultiLineString":
        for g in geom.geoms:
            _geom_to_svg_paths(g, color, scale, out)


def _polygon_d(poly, scale: float) -> str:
    """Convert a Shapely Polygon to an SVG path d-string."""
    if poly.is_empty:
        return ""

    def ring(coords):
        pts = [(x * scale, y * scale) for x, y in coords]
        if len(pts) < 2:
            return ""
        d = f"M {pts[0][0]:.1f} {pts[0][1]:.1f}"
        for x, y in pts[1:]:
            d += f" L {x:.1f} {y:.1f}"
        return d + " Z"

    parts = [ring(poly.exterior.coords)]
    for interior in poly.interiors:
        parts.append(ring(interior.coords))
    return " ".join(p for p in parts if p)


def _worker_full_design(queue: multiprocessing.Queue, args: tuple) -> None:
    (graph,) = args
    try:
        import importlib
        import inspect
        import pkgutil

        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        import qiskit_metal.qlibrary as qlibrary
        from qiskit_metal import designs
        from qiskit_metal.qlibrary.core import QComponent
        from qiskit_metal.renderers.renderer_mpl.mpl_renderer import (
            QMplRenderer,
        )

        class_map: dict[str, type] = {}
        for _, modname, _ in pkgutil.walk_packages(
            path=qlibrary.__path__,
            prefix=qlibrary.__name__ + ".",
            onerror=lambda _: None,
        ):
            try:
                module = importlib.import_module(modname)
            except Exception:
                continue
            for _, cls in inspect.getmembers(module, inspect.isclass):
                if (
                    issubclass(cls, QComponent)
                    and cls is not QComponent
                    and cls.__module__ == modname
                ):
                    class_map[cls.__name__] = cls

        design = designs.DesignPlanar(enable_renderers=False)
        design.overwrite_enabled = True

        for component in graph["components"]:
            cls = class_map.get(component["componentId"])
            if cls is None:
                continue
            options = dict(component.get("options", {}))
            position = component.get("position", {})
            options["pos_x"] = f"{position.get('x', 0)}mm"
            options["pos_y"] = f"{position.get('y', 0)}mm"
            if component.get("rotation"):
                options["orientation"] = str(component["rotation"])
            try:
                cls(design, component["instanceName"], options=options)
            except Exception:
                log.exception(
                    "Could not place %s",
                    component["instanceName"],
                )

        for connection in graph["connections"]:
            route_cls = class_map.get(connection["routeComponentId"])
            if route_cls is None:
                continue
            options = dict(connection.get("routeOverrides", {}))
            options["pin_inputs"] = {
                "start_pin": {
                    "component": connection["sourceComponentName"],
                    "pin": connection["sourcePinName"],
                },
                "end_pin": {
                    "component": connection["targetComponentName"],
                    "pin": connection["targetPinName"],
                },
            }
            try:
                route_cls(
                    design,
                    f"route_{connection['id'][:8]}",
                    options=options,
                )
            except Exception:
                log.exception("Could not create route %s", connection["id"])

        design.rebuild()

        fig, ax = plt.subplots(figsize=(10, 10), facecolor="#F4F4F0")
        ax.set_facecolor("#F4F4F0")
        QMplRenderer(canvas=None, design=design, logger=log).render(ax)
        ax.autoscale_view()
        ax.set_aspect("equal", adjustable="datalim")
        ax.set_axis_off()
        plt.tight_layout(pad=0)

        buffer = io.StringIO()
        fig.savefig(
            buffer,
            format="svg",
            bbox_inches="tight",
            facecolor="#F4F4F0",
        )
        plt.close(fig)
        queue.put(_normalize_svg(buffer.getvalue()))
    except Exception:
        log.exception("Full design SVG worker failed")
        queue.put("")


def _subprocess_render(worker_fn, args: tuple, timeout: int) -> object:
    """Run one render worker with a hard timeout."""
    queue: multiprocessing.Queue = multiprocessing.Queue()
    process = multiprocessing.Process(target=worker_fn, args=(queue, args))
    try:
        process.start()
        process.join(timeout)
        if process.is_alive():
            process.terminate()
            process.join(5)
            log.warning("Render worker timed out after %ds", timeout)
            return ""
        try:
            return queue.get_nowait()
        except Empty:
            return ""
    finally:
        if process.is_alive():
            process.terminate()
            process.join(5)
        queue.close()
        queue.join_thread()
        process.close()


def _normalize_svg(svg: str) -> str:
    start = svg.find("<svg")
    return svg[start:] if start >= 0 else svg
