"""Optional structured debug logging for backend diagnostics."""

from __future__ import annotations

import json
import os
from typing import Any


def debug_log(
    location: str,
    message: str,
    payload: dict[str, Any] | None = None,
    *,
    hypothesis_id: str | None = None,
) -> None:
    """Emit a debug log line when BACKEND_DEBUG_LOGS is enabled."""
    if os.getenv("BACKEND_DEBUG_LOGS", "").lower() not in {"1", "true", "yes"}:
        return

    entry = {
        "location": location,
        "message": message,
        "hypothesis_id": hypothesis_id,
        "payload": payload or {},
    }
    print(json.dumps(entry, default=str), flush=True)
