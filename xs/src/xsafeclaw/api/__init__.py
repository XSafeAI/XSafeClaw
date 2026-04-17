"""FastAPI application for SafetyAgent monitoring."""

from .main import app, lifespan

__all__ = ["app", "lifespan"]
