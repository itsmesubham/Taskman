import asyncio
import json
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

class EventBus:
    def __init__(self) -> None:
        self._subscribers: dict[str, set[asyncio.Queue[str]]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def subscribe(self, tenant_id: str) -> asyncio.Queue[str]:
        queue: asyncio.Queue[str] = asyncio.Queue(maxsize=100)
        async with self._lock:
            self._subscribers[tenant_id].add(queue)
        return queue

    async def unsubscribe(self, tenant_id: str, queue: asyncio.Queue[str]) -> None:
        async with self._lock:
            self._subscribers[tenant_id].discard(queue)
            if not self._subscribers[tenant_id]:
                self._subscribers.pop(tenant_id, None)

    async def publish(self, tenant_id: str, event_type: str, data: dict[str, Any]) -> None:
        payload = {
            "type": event_type,
            "tenant_id": tenant_id,
            "data": data,
            "sent_at": datetime.now(timezone.utc).isoformat(),
        }
        message = f"event: {event_type}\ndata: {json.dumps(payload, default=str)}\n\n"
        async with self._lock:
            queues = list(self._subscribers.get(tenant_id, set()))
        for queue in queues:
            try:
                queue.put_nowait(message)
            except asyncio.QueueFull:
                pass


event_bus = EventBus()
