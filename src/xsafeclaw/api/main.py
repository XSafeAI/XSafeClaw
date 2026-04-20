"""Main FastAPI application."""

import mimetypes
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

# Windows often maps .js → text/plain via the registry; ES module scripts require
# application/javascript (strict MIME checking in browsers).
mimetypes.add_type("application/javascript", ".js", strict=True)
mimetypes.add_type("application/javascript", ".mjs", strict=True)
mimetypes.add_type("text/css", ".css", strict=True)
mimetypes.add_type("application/json", ".json", strict=True)
mimetypes.add_type("image/svg+xml", ".svg", strict=True)

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from ..config import settings
from ..database import close_db, init_db
from ..services.message_sync_service import MessageSyncService
from .routes import assets, chat, events, guard, map_skins, memory, messages, redteam, risk_test, sessions, skills, stats, system, tool_calls, trace

STATIC_DIR = Path(__file__).parent.parent / "static"


# ── Picker mode (§38) ────────────────────────────────────────────────────────
# When the CLI supervisor detects both OpenClaw and Hermes installed, it spawns
# this server as a subprocess with ``XSAFECLAW_PICKER_MODE=1``. In that mode:
#   * lifespan skips heavy init (DB, FileWatcher, onboard preload);
#   * the HTTP middleware rejects every /api/* route except /health and the two
#     picker endpoints below, so the frontend can only reach the
#     SelectFramework page;
#   * once the user POSTs a choice, the picker endpoint writes the pin file and
#     schedules ``os._exit(_PICKER_EXIT_CODE)`` so the supervisor can read the
#     selection and spawn the real server with ``PLATFORM`` fixed.
PICKER_MODE_ENV = "XSAFECLAW_PICKER_MODE"

_PICKER_API_ALLOWLIST = frozenset({
    "/api/system/runtime-platform-status",
    "/api/system/runtime-platform-pick",
})


def _picker_mode_active() -> bool:
    """Return True when this process was launched in picker mode."""
    return os.environ.get(PICKER_MODE_ENV, "").strip().lower() in {"1", "true", "yes", "on"}


# Global sync service instance
message_sync_service: MessageSyncService | None = None


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """
    Application lifespan manager.
    
    Handles startup and shutdown events.
    """
    global message_sync_service

    if _picker_mode_active():
        print("🧭 XSafeClaw Picker Mode — waiting for framework selection...")
        print(f"   Open http://{settings.api_host}:{settings.api_port}/select-framework")
        yield
        print("🧭 Picker Mode shutdown")
        return

    # Startup
    print("🚀 Starting XSafeClaw Application...")

    from .routes.system import sanitize_legacy_openclaw_config
    if sanitize_legacy_openclaw_config():
        print("🧹 Removed legacy XSafeClaw config keys from openclaw.json")
    
    # Initialize database
    await init_db()
    print("✅ Database initialized")
    
    # Start Message-based sync service
    if settings.enable_file_watcher:
        message_sync_service = MessageSyncService()
        await message_sync_service.start()
    else:
        print("⚠️  File watcher disabled")
    
    print(f"✅ API server ready at http://{settings.api_host}:{settings.api_port}")

    # Preload onboard-scan data in background (openclaw models list is slow)
    from .routes.system import trigger_onboard_scan_preload
    trigger_onboard_scan_preload()
    
    yield
    
    # Shutdown
    print("🛑 Shutting down XSafeClaw Application...")
    
    if message_sync_service:
        await message_sync_service.stop()
    
    await close_db()
    print("✅ Shutdown complete")


# Create FastAPI app
app = FastAPI(
    title="XSafeClaw API",
    description="Real-time monitoring and analytics system for OpenClaw AI agents",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def _picker_mode_guard(request: Request, call_next):
    """Restrict /api/* to the picker allowlist when running in picker mode.

    Non-API routes (SPA static assets, /select-framework) pass through so the
    frontend can load and render the picker UI.  Once the user submits a
    platform choice, the /runtime-platform-pick endpoint schedules process
    exit and the CLI supervisor takes over.
    """
    if not _picker_mode_active():
        return await call_next(request)

    path = request.url.path
    if path == "/health" or not path.startswith("/api/"):
        return await call_next(request)

    if path in _PICKER_API_ALLOWLIST:
        return await call_next(request)

    return JSONResponse(
        status_code=503,
        content={
            "detail": (
                "XSafeClaw is in platform picker mode. "
                "POST /api/system/runtime-platform-pick to proceed."
            ),
            "picker_mode": True,
        },
    )


# Include routers
app.include_router(sessions.router, prefix="/api/sessions", tags=["Sessions"])
app.include_router(messages.router, prefix="/api/messages", tags=["Messages"])
app.include_router(tool_calls.router, prefix="/api/tool-calls", tags=["Tool Calls"])
app.include_router(events.router, prefix="/api/events", tags=["Events"])
app.include_router(stats.router, prefix="/api/stats", tags=["Statistics"])
app.include_router(assets.router, prefix="/api/assets", tags=["Asset Scanning"])
app.include_router(risk_test.router, prefix="/api/risk-test", tags=["Risk Test"])
app.include_router(redteam.router, prefix="/api/redteam", tags=["Red Team"])
app.include_router(chat.router, prefix="/api/chat", tags=["Chat"])
app.include_router(system.router, prefix="/api/system", tags=["System"])
app.include_router(trace.router, prefix="/api/trace", tags=["Trace"])
app.include_router(guard.router, prefix="/api/guard", tags=["Guard"])
app.include_router(skills.router, prefix="/api/skills", tags=["Skills"])
app.include_router(memory.router, prefix="/api/memory", tags=["Memory"])
app.include_router(map_skins.router, prefix="/api/map-skins", tags=["Map Skins"])

# Serve embedded frontend static files (production mode)
if STATIC_DIR.is_dir() and (STATIC_DIR / "index.html").exists():
    _static_assets = STATIC_DIR / "assets"
    _static_assets.mkdir(parents=True, exist_ok=True)
    # Hashed asset files under /assets/ are safe to cache aggressively; the
    # bundler emits a new filename whenever the content changes.
    app.mount("/assets", StaticFiles(directory=_static_assets), name="static-assets")

    # HTML entry points and other non-hashed files must NEVER be cached by the
    # browser — otherwise a freshly rebuilt bundle won't be picked up until
    # the user hard-refreshes. The assets/ mount above keeps its own headers.
    _HTML_NO_CACHE_HEADERS = {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        "Pragma": "no-cache",
        "Expires": "0",
    }

    @app.get("/{path:path}", include_in_schema=False)
    async def spa_fallback(request: Request, path: str):
        """SPA fallback — serve static files or index.html for SPA routes.

        HTML responses are returned with ``Cache-Control: no-store`` so that
        redeploying the embedded bundle is visible on the next page load
        without the user having to manually clear the browser cache.
        """
        file = STATIC_DIR / path
        if file.is_file() and not path.startswith("api"):
            headers = _HTML_NO_CACHE_HEADERS if file.suffix.lower() in {".html", ".htm"} else None
            return FileResponse(file, headers=headers)
        basename = path.rsplit("/", 1)[-1]
        if "." in basename:
            return Response(status_code=404)
        dedicated = STATIC_DIR / f"{path}.html"
        if dedicated.is_file():
            return FileResponse(dedicated, headers=_HTML_NO_CACHE_HEADERS)
        return FileResponse(STATIC_DIR / "index.html", headers=_HTML_NO_CACHE_HEADERS)
else:
    @app.get("/", tags=["Root"])
    async def root():
        return {
            "name": "XSafeClaw",
            "version": "1.0.0",
            "status": "running",
            "message_sync_service_running": message_sync_service.is_running() if message_sync_service else False,
            "hint": "Frontend not built. Run: cd frontend && npm run build",
        }


@app.get("/health", tags=["Health"])
async def health():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "database": "connected",
        "message_sync_service": "running" if (message_sync_service and message_sync_service.is_running()) else "stopped",
    }


def get_message_sync_service() -> MessageSyncService | None:
    """Get the global message sync service instance."""
    return message_sync_service
