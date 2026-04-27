"""Main FastAPI application.

Since §42 (Hermes-as-a-first-class-citizen) the §38 picker-mode middleware is
gone — XSafeClaw monitors OpenClaw, Hermes and Nanobot simultaneously through
the multi-runtime registry, and the user picks per-session which runtime to
talk to from Agent Town. There is no longer a "single active platform" the
backend needs to negotiate at startup.
"""

import mimetypes
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from importlib import metadata as importlib_metadata
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
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from ..config import settings
from ..database import close_db, init_db
from ..services.message_sync_service import MessageSyncService
from .routes import assets, chat, events, guard, map_skins, memory, messages, redteam, risk_test, sessions, skills, stats, system, tool_calls, trace

STATIC_DIR = Path(__file__).parent.parent / "static"


def _package_version() -> str:
    try:
        return importlib_metadata.version("xsafeclaw")
    except importlib_metadata.PackageNotFoundError:
        return "1.0.5"


# Global sync service instance
message_sync_service: MessageSyncService | None = None


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """
    Application lifespan manager.
    
    Handles startup and shutdown events.
    """
    global message_sync_service

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

    # §48 — Auto-start any installed framework gateway whose /health is silent.
    # Dispatched as a background task so a slow start (e.g. systemd taking
    # 5–10s to bind) never delays this lifespan from yielding; the rest of
    # XSafeClaw — including its own /health — keeps serving immediately.
    # Each helper is idempotent and best-effort; failures are logged but
    # never raised.
    if settings.auto_start_runtimes:
        import asyncio as _asyncio
        from ..services.runtime_autostart import autostart_installed_runtimes

        async def _safe_autostart() -> None:
            try:
                summary = await autostart_installed_runtimes()
                noteworthy = {k: v for k, v in summary.items()
                              if v.get("status") in ("started", "failed")}
                if noteworthy:
                    parts = [f"{k}={v['status']}" for k, v in noteworthy.items()]
                    print(f"🧩 Runtime autostart: {', '.join(parts)}")
                    # Surface failure detail so the operator can see *why*
                    # (e.g. "nanobot CLI missing on PATH") instead of just the
                    # one-word status. Kept on separate lines because some
                    # details include log-tail snippets with pipes / newlines.
                    for name, info in noteworthy.items():
                        if info.get("status") == "failed":
                            detail = str(info.get("detail", "")).strip()
                            if detail:
                                print(f"   ↳ {name} failed: {detail[:400]}")
            except Exception as exc:
                print(f"⚠️  Runtime autostart raised {type(exc).__name__}: {exc}")

        _asyncio.create_task(_safe_autostart())

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
            "version": _package_version(),
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
