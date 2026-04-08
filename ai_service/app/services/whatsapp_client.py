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

    @staticmethod
    def _normalize_br_number(phone: str) -> str:
        """Fix Brazilian mobile numbers missing the 9 digit."""
        # Brazilian numbers: 55 + 2-digit area + 8 or 9-digit number
        # WhatsApp sometimes returns without the 9: 5581XXXXXXXX (12 digits)
        # API needs the 9: 55819XXXXXXXX (13 digits)
        if phone.startswith("55") and len(phone) == 12:
            area = phone[2:4]
            number = phone[4:]
            phone = f"55{area}9{number}"
        return phone

    async def send_text(self, to: str, text: str) -> dict:
        """Send a plain text message."""
        to = self._normalize_br_number(to)
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
        to = self._normalize_br_number(to)
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
        to = self._normalize_br_number(to)
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
