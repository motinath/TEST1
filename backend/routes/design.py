"""Design-level routes: validate, render, generate-code."""
from __future__ import annotations

import logging

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from ..models import (
    DesignDocument,
    GeneratedCode,
    RenderResult,
    ValidationResult,
)
from ..services import codegen_service, render_service

router = APIRouter(prefix="/design", tags=["design"])
log = logging.getLogger(__name__)


@router.post("/validate", response_model=ValidationResult)
def validate_design(design: DesignDocument) -> ValidationResult:
    return render_service.validate_design(design)


@router.post("/render")
def render_design(request: Request, design: DesignDocument) -> JSONResponse:
    """Render the full design SVG via Qiskit Metal.

    Always returns JSON (never drops the connection) so the browser never sees
    a CORS-less network failure — even when the subprocess renderer is not yet
    implemented or crashes internally.
    """
    origin = request.headers.get("origin", "*")
    cors_headers = {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    }
    try:
        result = render_service.render_design(design)
        return JSONResponse(
            content=result.model_dump(),
            headers=cors_headers,
        )
    except NotImplementedError as exc:
        return JSONResponse(
            status_code=501,
            headers=cors_headers,
            content={
                "error": {
                    "code": "NOT_IMPLEMENTED",
                    "message": str(exc) or "Render not yet implemented.",
                    "details": {},
                }
            },
        )
    except Exception as exc:
        log.exception("render_design failed")
        return JSONResponse(
            status_code=500,
            headers=cors_headers,
            content={
                "error": {
                    "code": "RENDER_ERROR",
                    "message": str(exc) or "Render failed.",
                    "details": {},
                }
            },
        )


@router.post("/generate-code", response_model=GeneratedCode)
def generate_code(design: DesignDocument) -> GeneratedCode:
    return codegen_service.generate(design)
