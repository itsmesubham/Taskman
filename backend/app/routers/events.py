import asyncio
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from ..security import get_current_user
from ..sse import event_bus

router = APIRouter(prefix="/api/events", tags=["events"])


def resolve_tenant_id(current_user: dict) -> str:
    tenant_id = current_user.get("tenant_id") or current_user.get("active_tenant_id")
    if not tenant_id:
        raise HTTPException(status_code=400, detail="Workspace not selected")
    return str(tenant_id)


@router.get("/stream")
async def stream_events(request: Request, current_user: dict = Depends(get_current_user)):
    tenant_id = resolve_tenant_id(current_user)
    queue = await event_bus.subscribe(tenant_id)

    async def generator():
        try:
            yield "event: connected\ndata: {\"ok\": true}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    message = await asyncio.wait_for(queue.get(), timeout=20)
                    yield message
                except asyncio.TimeoutError:
                    yield "event: heartbeat\ndata: {\"ok\": true}\n\n"
        finally:
            await event_bus.unsubscribe(tenant_id, queue)

    return StreamingResponse(generator(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "Connection": "keep-alive"})
