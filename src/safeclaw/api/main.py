"""Main FastAPI application."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from ..config import settings
from ..database import close_db, init_db
from ..services.message_sync_service import MessageSyncService
from .routes import events, guard, memory, messages, sessions, skills, stats, tool_calls, assets, redteam, chat, system, trace

STATIC_DIR = Path(__file__).parent.parent / "static"


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
    print("🚀 Starting SafeClaw Application...")
    
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
    
    yield
    
    # Shutdown
    print("🛑 Shutting down SafeClaw Application...")
    
    if message_sync_service:
        await message_sync_service.stop()
    
    await close_db()
    print("✅ Shutdown complete")


# Create FastAPI app
app = FastAPI(
    title="SafeClaw API",
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
app.include_router(redteam.router, prefix="/api/redteam", tags=["Red Team"])
app.include_router(chat.router, prefix="/api/chat", tags=["Chat"])
app.include_router(system.router, prefix="/api/system", tags=["System"])
app.include_router(trace.router, prefix="/api/trace", tags=["Trace"])
app.include_router(guard.router, prefix="/api/guard", tags=["Guard"])
app.include_router(skills.router, prefix="/api/skills", tags=["Skills"])
app.include_router(memory.router, prefix="/api/memory", tags=["Memory"])

# Serve embedded frontend static files (production mode)
if STATIC_DIR.is_dir() and (STATIC_DIR / "index.html").exists():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="static-assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def spa_fallback(request: Request, path: str):
        """SPA fallback — serve index.html for all non-API routes."""
        file = STATIC_DIR / path
        if file.is_file() and not path.startswith("api"):
            return FileResponse(file)
        return FileResponse(STATIC_DIR / "index.html")
else:
    @app.get("/", tags=["Root"])
    async def root():
        return {
            "name": "SafeClaw",
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
