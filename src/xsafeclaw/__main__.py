"""Entry point for running SafetyAgent as a module."""

import uvicorn

from .config import settings

if __name__ == "__main__":
    uvicorn.run(
        "xsafeclaw.api.main:app",
        host=settings.api_host,
        port=settings.api_port,
        reload=settings.api_reload,
        log_level=settings.log_level.lower(),
    )
