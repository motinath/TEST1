"""Silicofeller ↔ Qiskit Metal bridge — FastAPI application entrypoint.

This module wires the route modules, CORS, and a uniform error envelope that
matches the contract documented in ``contracts/bridge_contract.md``.
Qiskit Metal logic lives in ``services/``.
"""
from __future__ import annotations

import logging
import threading

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import settings
from .routes import components, design, health

logging.basicConfig(level=settings.log_level.upper())
log = logging.getLogger("silicofeller.bridge")


def _prewarm_registry() -> None:
    """Import qiskit_metal and walk its qlibrary in a background thread.

    Component discovery imports the full scientific stack (matplotlib, scipy,
    shapely, …) which can take 30–90 s on first run.  Running it at startup
    means the first real request gets a cached result instead of blocking.
    """
    try:
        from .services import component_registry_service
        log.info("Pre-warming component registry in background thread …")
        components_found = component_registry_service.list_components()
        log.info("Registry pre-warm complete — %d components cached.", len(components_found))
    except Exception:
        log.exception("Registry pre-warm failed (non-fatal — will retry on first request).")


def create_app() -> FastAPI:
    app = FastAPI(
        title="Silicofeller Bridge",
        description="HTTP bridge between the Silicofeller editor and Qiskit Metal.",
        version="0.1.0",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
    )

    app.include_router(health.router)
    app.include_router(components.router)
    app.include_router(design.router)

    @app.on_event("startup")
    async def _startup() -> None:
        # Kick off discovery in a daemon thread so the HTTP server starts
        # immediately and the cache is ready by the time the first browser
        # request arrives (usually a few seconds later).
        t = threading.Thread(target=_prewarm_registry, daemon=True, name="registry-prewarm")
        t.start()

    @app.exception_handler(NotImplementedError)
    async def _not_implemented(_: Request, exc: NotImplementedError) -> JSONResponse:
        return JSONResponse(
            status_code=501,
            headers={"Access-Control-Allow-Origin": "*"},
            content={
                "error": {
                    "code": "NOT_IMPLEMENTED",
                    "message": str(exc) or "This bridge endpoint is not implemented yet.",
                    "details": {},
                }
            },
        )

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception) -> JSONResponse:  # noqa: BLE001
        log.exception("Unhandled bridge error", exc_info=exc)
        return JSONResponse(
            status_code=500,
            headers={"Access-Control-Allow-Origin": "*"},
            content={
                "error": {
                    "code": "BRIDGE_ERROR",
                    "message": str(exc) or "Internal bridge error.",
                    "details": {},
                }
            },
        )

    return app


app = create_app()


if __name__ == "__main__":  # pragma: no cover
    import uvicorn

    uvicorn.run(
        "backend.app:app",
        host=settings.host,
        port=settings.port,
        log_level=settings.log_level,
        reload=False,
    )
