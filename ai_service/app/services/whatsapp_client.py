"""WhatsApp Cloud API client for sending messages."""

from __future__ import annotations

import logging

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

GRAPH_API = "https://graph.facebook.com/v21.0"


class WhatsAppClient:
    """Send messages via Meta WhatsApp Cloud API."""

    def __init__(self, client: httpx.AsyncClient | None = None):
        self._client = client or httpx.AsyncClient(timeout=30.0)
        self.phone_id = settings.whatsapp_phone_number_id
        self.token = settings.whatsapp_access_token

    @property
    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }

    @property
    def _url(self) -> str:
        return f"{GRAPH_API}/{self.phone_id}/messages"

    async def send_text(self, to: str, text: str) -> dict:
        """Send a plain text message."""
        body = {
            "messaging_product": "whatsapp",
            "to": to,
            "type": "text",
            "text": {"body": text},
        }
        return await self._send(body)

    async def send_buttons(
        self, to: str, text: str, buttons: list[dict]
    ) -> dict:
        """Send interactive button message (max 3 buttons).

        buttons: [{"id": "btn_1", "title": "Option A"}, ...]
        """
        body = {
            "messaging_product": "whatsapp",
            "to": to,
            "type": "interactive",
            "interactive": {
                "type": "button",
                "body": {"text": text},
                "action": {
                    "buttons": [
                        {"type": "reply", "reply": b} for b in buttons[:3]
                    ]
                },
            },
        }
        return await self._send(body)

    async def send_list(
        self, to: str, text: str, button_text: str, sections: list[dict]
    ) -> dict:
        """Send interactive list message.

        sections: [{"title": "Section", "rows": [{"id": "1", "title": "Item"}]}]
        """
        body = {
            "messaging_product": "whatsapp",
            "to": to,
            "type": "interactive",
            "interactive": {
                "type": "list",
                "body": {"text": text},
                "action": {
                    "button": button_text,
                    "sections": sections,
                },
            },
        }
        return await self._send(body)

    async def mark_read(self, message_id: str) -> None:
        """Mark a message as read (blue checkmarks)."""
        body = {
            "messaging_product": "whatsapp",
            "status": "read",
            "message_id": message_id,
        }
        try:
            await self._send(body)
        except Exception:
            pass  # non-critical

    async def _send(self, body: dict) -> dict:
        try:
            resp = await self._client.post(
                self._url, json=body, headers=self._headers
            )
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPStatusError as e:
            logger.error(
                "[whatsapp] API error %s: %s",
                e.response.status_code,
                e.response.text[:500],
            )
            raise
        except Exception as e:
            logger.error("[whatsapp] Send failed: %s", e)
            raise
