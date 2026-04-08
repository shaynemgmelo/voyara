"""WhatsApp webhook routes for Meta Cloud API."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Request, Response, Query

from app.config import settings
from app.services.whatsapp_client import WhatsAppClient
from app.services.whatsapp_handler import handle_message, handle_button_reply

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/webhook")
async def verify_webhook(
    mode: str = Query(None, alias="hub.mode"),
    token: str = Query(None, alias="hub.verify_token"),
    challenge: str = Query(None, alias="hub.challenge"),
):
    """WhatsApp webhook verification (called once during setup)."""
    if mode == "subscribe" and token == settings.whatsapp_verify_token:
        logger.info("[whatsapp] Webhook verified successfully")
        return Response(content=challenge, media_type="text/plain")
    logger.warning("[whatsapp] Webhook verification failed: token=%s", token)
    return Response(content="Forbidden", status_code=403)


@router.post("/webhook")
async def receive_webhook(request: Request):
    """Receive incoming WhatsApp messages."""
    body = await request.json()

    # WhatsApp sends various notification types — we only care about messages
    entries = body.get("entry", [])
    for entry in entries:
        changes = entry.get("changes", [])
        for change in changes:
            value = change.get("value", {})
            messages = value.get("messages", [])

            for msg in messages:
                phone = msg.get("from", "")
                msg_id = msg.get("id", "")
                msg_type = msg.get("type", "")

                wa = WhatsAppClient()

                if msg_type == "text":
                    text = msg.get("text", {}).get("body", "")
                    logger.info(
                        "[whatsapp] Message from %s: %s",
                        phone, text[:100],
                    )
                    await handle_message(phone, text, msg_id, wa)

                elif msg_type == "interactive":
                    interactive = msg.get("interactive", {})
                    int_type = interactive.get("type", "")

                    if int_type == "button_reply":
                        btn = interactive.get("button_reply", {})
                        btn_id = btn.get("id", "")
                        logger.info(
                            "[whatsapp] Button reply from %s: %s",
                            phone, btn_id,
                        )
                        await handle_button_reply(phone, btn_id, msg_id, wa)

                    elif int_type == "list_reply":
                        item = interactive.get("list_reply", {})
                        item_id = item.get("id", "")
                        logger.info(
                            "[whatsapp] List reply from %s: %s",
                            phone, item_id,
                        )
                        # Treat list replies as text
                        await handle_message(phone, item_id, msg_id, wa)

                else:
                    logger.info(
                        "[whatsapp] Unsupported message type: %s from %s",
                        msg_type, phone,
                    )
                    wa_client = WhatsAppClient()
                    await wa_client.send_text(
                        phone,
                        "Por enquanto só aceito *texto* e *links*. "
                        "Envie um link de TikTok/Instagram/YouTube ou digite o destino!"
                    )

    return {"status": "ok"}
