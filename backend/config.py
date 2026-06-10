"""Application configuration.

Values are read from environment variables with sensible defaults so the
service can boot in development without any setup.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import List


def _split_csv(value: str) -> List[str]:
    return [v.strip() for v in value.split(",") if v.strip()]


@dataclass(frozen=True)
class Settings:
    host: str = field(default_factory=lambda: os.getenv("BRIDGE_HOST", "0.0.0.0"))
    port: int = field(default_factory=lambda: int(os.getenv("BRIDGE_PORT", "8000")))
    cors_origins: List[str] = field(
        default_factory=lambda: _split_csv(os.getenv("BRIDGE_CORS_ORIGINS", "*"))
    )
    cache_ttl_seconds: int = field(
        default_factory=lambda: int(os.getenv("BRIDGE_CACHE_TTL", "0"))  # 0 = no expiry
    )
    log_level: str = field(default_factory=lambda: os.getenv("BRIDGE_LOG_LEVEL", "info"))


settings = Settings()
