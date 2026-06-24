from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .config import get_settings
from .database import init_pool, close_pool
from .migrations import init_schema
from .routers import auth, tenants, users, invites, projects, issues, sprints, comments, reports, ai, events

settings = get_settings()

app = FastAPI(
    title="Taskman Backend",
    description="Multi-tenant Jira-like task manager backend with sprint planning and SSE realtime events.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_origin_regex=settings.cors_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    init_pool()
    init_schema()


@app.on_event("shutdown")
def shutdown() -> None:
    close_pool()


@app.get("/api/health")
def health():
    return {"ok": True, "service": "taskman-backend", "version": "1.0.0"}


app.include_router(auth.router)
app.include_router(tenants.router)
app.include_router(users.router)
app.include_router(invites.router)
app.include_router(projects.router)
app.include_router(issues.router)
app.include_router(sprints.router)
app.include_router(comments.router)
app.include_router(reports.router)
app.include_router(ai.router)
app.include_router(events.router)
