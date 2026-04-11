"""
DoGoods AI Backend — FastAPI Application
==========================================
Provides all AI-related HTTP endpoints:

  POST /api/ai/chat            – Text conversation (returns text + optional audio URL)
  GET  /api/ai/history/{uid}   – Retrieve conversation history
  POST /api/ai/voice           – Transcribe audio (Whisper) then process as chat

Legacy endpoints (matching, recipes, impact, etc.) are preserved from the
original ai_engine module.

Background job: checks ai_reminders every 15 min, sends SMS via Twilio.

Run:
    uvicorn backend.app:app --host 0.0.0.0 --port 8000 --reload
"""

import asyncio
import os
import re
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from base64 import b64encode

import httpx
from fastapi import FastAPI, HTTPException, Request, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

from backend.ai_engine import (
    conversation_engine,
    check_rate_limit,
    compute_matches,
    calculate_impact,
    legacy_ai_request,
    _extract_content,
    _circuit,
    supabase_get,
    supabase_post,
    SUPABASE_URL,
    SUPABASE_SERVICE_KEY,
    LEGACY_API_KEY,
    DEFAULT_MODEL,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("app")

ALLOWED_ORIGINS = [
    o.strip() for o in os.getenv(
        "CORS_ORIGINS", "http://localhost:3001,http://127.0.0.1:3001"
    ).split(",")
]

# Twilio configuration
TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "")
TWILIO_PHONE_NUMBER = os.getenv("TWILIO_PHONE_NUMBER", "")
REMINDER_CHECK_INTERVAL = int(os.getenv("REMINDER_CHECK_INTERVAL", "900"))  # 15 min


# ---------------------------------------------------------------------------
# Twilio SMS helper
# ---------------------------------------------------------------------------

async def send_sms_via_twilio(to_phone: str, message: str) -> dict:
    """Send an SMS using the Twilio REST API and log it to sms_logs."""
    if not all([TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER]):
        logger.warning("Twilio not configured — skipping SMS to %s", to_phone)
        return {"sent": False, "error": "Twilio not configured"}

    url = (
        f"https://api.twilio.com/2010-04-01/Accounts/"
        f"{TWILIO_ACCOUNT_SID}/Messages.json"
    )
    auth_str = b64encode(
        f"{TWILIO_ACCOUNT_SID}:{TWILIO_AUTH_TOKEN}".encode()
    ).decode()

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                url,
                data={
                    "To": to_phone,
                    "From": TWILIO_PHONE_NUMBER,
                    "Body": message[:1600],  # Twilio SMS limit
                },
                headers={"Authorization": f"Basic {auth_str}"},
            )
            resp_data = resp.json()

        twilio_sid = resp_data.get("sid", "")
        error_msg = resp_data.get("error_message")
        sent_ok = resp.status_code in (200, 201) and not error_msg

        # Log to sms_logs table
        try:
            await supabase_post("sms_logs", {
                "phone_number": to_phone,
                "message": message[:1600],
                "type": "reminder",
                "status": "sent" if sent_ok else "failed",
                "twilio_sid": twilio_sid,
                "error_message": error_msg,
            })
        except Exception as log_exc:
            logger.error("Failed to log SMS: %s", log_exc)

        if sent_ok:
            logger.info("SMS sent to %s (sid=%s)", to_phone, twilio_sid)
            return {"sent": True, "twilio_sid": twilio_sid}
        else:
            logger.error("Twilio error: %s", error_msg or resp.text[:200])
            return {"sent": False, "error": error_msg or "Twilio request failed"}

    except Exception as exc:
        logger.error("SMS send failed: %s", exc)
        return {"sent": False, "error": str(exc)}


# ---------------------------------------------------------------------------
# Background job: process pending reminders every 15 minutes
# ---------------------------------------------------------------------------

async def process_pending_reminders() -> int:
    """Find due reminders, look up user phone, send SMS, mark as sent.

    Returns the number of reminders processed.
    """
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        return 0

    now_iso = datetime.now(timezone.utc).isoformat()
    processed = 0

    try:
        # Fetch due, unsent reminders
        reminders = await supabase_get("ai_reminders", {
            "sent": "eq.false",
            "trigger_time": f"lte.{now_iso}",
            "select": "id,user_id,message,reminder_type,trigger_time",
            "order": "trigger_time.asc",
            "limit": "50",
        })
    except Exception as exc:
        logger.error("Reminder fetch failed: %s", exc)
        return 0

    for reminder in reminders:
        rid = reminder.get("id")
        uid = reminder.get("user_id")
        msg = reminder.get("message", "")
        rtype = reminder.get("reminder_type", "general")

        # Look up user phone
        phone = None
        try:
            user_rows = await supabase_get("users", {
                "id": f"eq.{uid}",
                "select": "phone,name,sms_opt_in,sms_notifications_enabled",
            })
            if user_rows:
                user = user_rows[0]
                # Only send if user has opted in to SMS
                if user.get("sms_opt_in") or user.get("sms_notifications_enabled"):
                    phone = user.get("phone")
        except Exception as exc:
            logger.error("User phone lookup for reminder %s failed: %s", rid, exc)

        # Send SMS if phone available
        sms_result = {"sent": False}
        if phone:
            prefix = {
                "pickup": "🍎 Pickup Reminder",
                "listing_expiry": "⏰ Listing Expiry",
                "distribution_event": "📍 Event Reminder",
                "general": "📋 Reminder",
            }.get(rtype, "📋 Reminder")
            sms_body = f"[DoGoods] {prefix}: {msg}"
            sms_result = await send_sms_via_twilio(phone, sms_body)
        else:
            logger.info(
                "No phone/SMS opt-in for user %s, marking reminder %s as sent",
                uid, rid,
            )

        # Mark reminder as sent regardless (avoid re-processing)
        try:
            headers = {
                "apikey": SUPABASE_SERVICE_KEY,
                "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
                "Content-Type": "application/json",
                "Prefer": "return=representation",
            }
            async with httpx.AsyncClient(timeout=10) as client:
                await client.patch(
                    f"{SUPABASE_URL}/rest/v1/ai_reminders",
                    params={"id": f"eq.{rid}"},
                    json={
                        "sent": True,
                        "sent_at": datetime.now(timezone.utc).isoformat(),
                    },
                    headers=headers,
                )
            processed += 1
        except Exception as exc:
            logger.error("Failed to mark reminder %s as sent: %s", rid, exc)

    if processed:
        logger.info("Processed %d reminder(s)", processed)
    return processed


async def _reminder_loop() -> None:
    """Background loop that runs process_pending_reminders periodically."""
    logger.info(
        "Reminder background job started (interval=%ds)", REMINDER_CHECK_INTERVAL
    )
    while True:
        try:
            await process_pending_reminders()
        except Exception as exc:
            logger.error("Reminder loop error: %s", exc)
        await asyncio.sleep(REMINDER_CHECK_INTERVAL)


# ---------------------------------------------------------------------------
# FastAPI lifespan (starts/stops background tasks)
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: launch background reminder job
    task = asyncio.create_task(_reminder_loop())
    logger.info("Background reminder job scheduled")
    yield
    # Shutdown: cancel background task
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        logger.info("Background reminder job stopped")


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(
    title="DoGoods AI Backend",
    version="2.0.0",
    description="AI conversation engine + food matching + community tools",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _enforce_rate_limit(request: Request) -> None:
    if not check_rate_limit(_get_client_ip(request)):
        raise HTTPException(429, "Rate limit exceeded. Try again later.")


# ---------------------------------------------------------------------------
# Pydantic models — AI conversation endpoints
# ---------------------------------------------------------------------------

class AIChatRequest(BaseModel):
    user_id: str = Field(min_length=1, max_length=128)
    message: str = Field(min_length=1, max_length=5000)
    include_audio: bool = False
    latitude: float | None = None
    longitude: float | None = None


class AIChatResponse(BaseModel):
    text: str
    audio_url: str | None = None
    user_id: str
    lang: str = "en"
    transcript: str | None = None
    timestamp: str


class ConversationMessage(BaseModel):
    role: str
    message: str
    created_at: str


# ---------------------------------------------------------------------------
# Pydantic models — Legacy endpoints
# ---------------------------------------------------------------------------

class LegacyChatMessage(BaseModel):
    role: str = Field(pattern=r"^(system|user|assistant)$")
    content: str = Field(min_length=1, max_length=10_000)


class LegacyChatRequest(BaseModel):
    messages: list[LegacyChatMessage] = Field(min_length=1)
    model: str = DEFAULT_MODEL
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    max_tokens: int = Field(default=1024, ge=1, le=4096)
    stream: bool = False


class MatchRequest(BaseModel):
    request: dict
    available_offers: list[dict]
    max_results: int = Field(default=10, ge=1, le=50)


class RecipeRequest(BaseModel):
    ingredients: list[str] = Field(min_length=1, max_length=20)

    @field_validator("ingredients", mode="before")
    @classmethod
    def validate_ingredients(cls, v: list[str]) -> list[str]:
        cleaned = []
        for item in v:
            item = item.strip()
            if not re.match(r"^[\w\s\-,]+$", item):
                raise ValueError(f"Invalid ingredient: {item}")
            if len(item) < 2 or len(item) > 100:
                raise ValueError("Each ingredient must be 2-100 characters")
            cleaned.append(item)
        return cleaned


class StorageRequest(BaseModel):
    food: str = Field(min_length=2, max_length=100)


class ImpactRequest(BaseModel):
    food_type: str = Field(min_length=2, max_length=100)
    quantity: float = Field(gt=0, le=1_000_000)
    unit: str = Field(min_length=1, max_length=20)


# ===================================================================
#  NEW AI CONVERSATION ROUTES
# ===================================================================

@app.post("/api/ai/chat", response_model=AIChatResponse)
async def ai_chat(body: AIChatRequest, request: Request) -> dict:
    """
    Handle a text conversation turn.

    Flow: user message + user_id -> profile lookup -> GPT-4o query
          -> text response (+ optional TTS audio URL).
    """
    _enforce_rate_limit(request)

    try:
        result = await conversation_engine.chat(
            user_id=body.user_id,
            message=body.message,
            include_audio=body.include_audio,
            latitude=body.latitude,
            longitude=body.longitude,
        )
        return result
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc
    except Exception as exc:
        logger.error("AI chat error: %s", exc)
        raise HTTPException(500, "Internal AI error") from exc


@app.get("/api/ai/history/{user_id}")
async def ai_history(user_id: str, request: Request, limit: int = 50) -> dict:
    """
    Retrieve conversation history for a user.

    Query params:
      - limit: max messages to return (default 50)
    """
    _enforce_rate_limit(request)

    if not user_id or len(user_id) > 128:
        raise HTTPException(400, "Invalid user_id")
    if limit < 1 or limit > 200:
        raise HTTPException(400, "limit must be between 1 and 200")

    try:
        history = await conversation_engine.get_conversation_history(
            user_id=user_id,
            limit=limit,
        )
        return {
            "user_id": user_id,
            "messages": history,
            "count": len(history),
        }
    except Exception as exc:
        logger.error("History fetch error: %s", exc)
        raise HTTPException(500, "Failed to retrieve conversation history") from exc


@app.delete("/api/ai/history/{user_id}")
async def ai_clear_history(user_id: str, request: Request) -> dict:
    """Delete all conversation history for a user."""
    _enforce_rate_limit(request)

    if not user_id or len(user_id) > 128:
        raise HTTPException(400, "Invalid user_id")

    try:
        await supabase_post(
            f"ai_conversations?user_id=eq.{user_id}",
            None,
            method="DELETE",
        )
        return {"user_id": user_id, "cleared": True}
    except Exception as exc:
        logger.error("Clear history error: %s", exc)
        raise HTTPException(500, "Failed to clear conversation history") from exc


class AIFeedbackRequest(BaseModel):
    conversation_id: str = Field(min_length=1, max_length=128)
    user_id: str = Field(min_length=1, max_length=128)
    rating: str = Field(min_length=1, max_length=20)
    comment: str | None = None


@app.post("/api/ai/feedback")
async def ai_feedback(body: AIFeedbackRequest, request: Request) -> dict:
    """Submit feedback on an AI message."""
    _enforce_rate_limit(request)

    try:
        payload = {
            "conversation_id": body.conversation_id,
            "user_id": body.user_id,
            "rating": body.rating,
        }
        if body.comment:
            payload["comment"] = body.comment

        await supabase_post("ai_feedback", payload)
        return {"success": True}
    except Exception as exc:
        logger.error("Feedback save error: %s", exc)
        raise HTTPException(500, "Failed to save feedback") from exc


@app.post("/api/ai/voice", response_model=AIChatResponse)
async def ai_voice(
    request: Request,
    audio: UploadFile = File(..., description="Audio file (webm, wav, mp3, m4a)"),
    user_id: str = Form(..., min_length=1, max_length=128),
    include_audio: bool = Form(default=True),
) -> dict:
    """
    Transcribe uploaded audio via OpenAI Whisper, then process as a chat message.

    Accepts multipart form with:
      - audio: audio file
      - user_id: user UUID
      - include_audio: whether to return TTS audio in response (default true)
    """
    _enforce_rate_limit(request)

    # Validate file type (strip codec params like ";codecs=opus")
    allowed_types = {
        "audio/webm", "audio/wav", "audio/mpeg", "audio/mp4",
        "audio/ogg", "audio/x-m4a", "audio/mp3",
    }
    base_type = (audio.content_type or "").split(";")[0].strip().lower()
    if base_type and base_type not in allowed_types:
        raise HTTPException(
            400,
            f"Unsupported audio type: {audio.content_type}. "
            f"Accepted: webm, wav, mp3, m4a, ogg",
        )

    # Read audio bytes (limit to 25MB — Whisper API max)
    audio_bytes = await audio.read()
    if len(audio_bytes) > 25 * 1024 * 1024:
        raise HTTPException(400, "Audio file too large (max 25MB)")
    if len(audio_bytes) == 0:
        raise HTTPException(400, "Empty audio file")

    try:
        # 1. Transcribe with Whisper
        transcript = await conversation_engine.transcribe_audio(
            audio_bytes=audio_bytes,
            filename=audio.filename or "audio.webm",
        )
        logger.info("Transcribed audio for user %s: %s", user_id, transcript[:100])

        # 1b. Filter Whisper hallucinations before sending to GPT
        if _is_whisper_noise(transcript):
            logger.info("Filtered Whisper noise for user %s: %s", user_id, transcript[:80])
            raise HTTPException(
                400,
                "Could not understand the audio. Please try again "
                "or switch to text input.",
            )

        # 2. Process transcribed text as a chat message
        result = await conversation_engine.chat(
            user_id=user_id,
            message=transcript,
            include_audio=include_audio,
        )
        # Include the transcript in the response
        result["transcript"] = transcript
        return result

    except httpx.TimeoutException:
        # Whisper or GPT-4o timed out — suggest text input
        raise HTTPException(
            504,
            "Voice processing timed out. Please try again, "
            "or switch to text input for a faster response.",
        )
    except RuntimeError as exc:
        # Config issue (e.g. missing API key)
        raise HTTPException(503, str(exc)) from exc
    except Exception as exc:
        logger.error("Voice processing error: %s", exc)
        raise HTTPException(
            500,
            "Voice processing failed. You can still type your "
            "message using the text input below.",
        ) from exc


class TTSRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4096)
    lang: str = Field(default="en", max_length=5)


@app.post("/api/ai/tts")
async def ai_tts(body: TTSRequest, request: Request):
    """Generate speech audio from text. Returns audio/mpeg blob."""
    _enforce_rate_limit(request)

    try:
        audio_bytes = await conversation_engine.generate_speech(
            body.text, lang=body.lang
        )
        from fastapi.responses import Response

        return Response(content=audio_bytes, media_type="audio/mpeg")
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc
    except httpx.HTTPStatusError as exc:
        logger.error("TTS upstream error %s", exc.response.status_code)
        raise HTTPException(502, "TTS service returned an error") from exc
    except Exception as exc:
        logger.error("TTS error: %s", exc)
        raise HTTPException(500, "Text-to-speech failed") from exc


# ---------------------------------------------------------------------------
# Whisper hallucination filter (common artifacts on silence / noise)
# ---------------------------------------------------------------------------

_WHISPER_NOISE_PHRASES = {
    "thank you", "thanks", "thank you for watching", "thanks for watching",
    "subscribe", "like and subscribe", "music", "foreign", "applause",
    "laughter", "bye", "you", "the", "i", "a", "um", "uh",
    "gwynple", "asha", "welcome", "goodbye",
}


def _is_whisper_noise(text: str) -> bool:
    """Return True if the transcription looks like Whisper hallucination."""
    stripped = text.strip()
    if len(stripped) < 3:
        return True
    # Check against known noise phrases (case-insensitive)
    # Remove punctuation for comparison
    cleaned = re.sub(r"[^\w\s]", "", stripped).strip().lower()
    if cleaned in _WHISPER_NOISE_PHRASES:
        return True
    # Very short cleaned text
    if len(cleaned) < 3:
        return True
    # High ratio of non-ASCII chars suggests garbled output
    ascii_chars = sum(1 for c in stripped if c.isascii())
    if len(stripped) > 5 and ascii_chars / len(stripped) < 0.5:
        return True
    return False


@app.post("/api/ai/transcribe")
async def ai_transcribe(
    request: Request,
    audio: UploadFile = File(..., description="Audio file (webm, wav, mp3, m4a)"),
) -> dict:
    """
    Transcription-only endpoint — Whisper STT without chat processing.

    Use this when you only need the transcript text and will send it to
    /api/ai/chat separately.
    """
    _enforce_rate_limit(request)

    # Validate file type
    allowed_types = {
        "audio/webm", "audio/wav", "audio/mpeg", "audio/mp4",
        "audio/ogg", "audio/x-m4a", "audio/mp3",
    }
    base_type = (audio.content_type or "").split(";")[0].strip().lower()
    if base_type and base_type not in allowed_types:
        raise HTTPException(
            400,
            f"Unsupported audio type: {audio.content_type}. "
            f"Accepted: webm, wav, mp3, m4a, ogg",
        )

    audio_bytes = await audio.read()
    if len(audio_bytes) > 25 * 1024 * 1024:
        raise HTTPException(400, "Audio file too large (max 25MB)")
    if len(audio_bytes) == 0:
        raise HTTPException(400, "Empty audio file")

    try:
        transcript = await conversation_engine.transcribe_audio(
            audio_bytes=audio_bytes,
            filename=audio.filename or "audio.webm",
        )
        logger.info("Transcribed (transcribe-only): %s", transcript[:100])

        # Filter Whisper hallucinations
        if _is_whisper_noise(transcript):
            logger.info("Filtered Whisper noise: %s", transcript[:80])
            return {"transcript": "", "filtered": True}

        return {"transcript": transcript.strip(), "filtered": False}

    except httpx.TimeoutException:
        raise HTTPException(504, "Whisper timed out. Try again or use text input.")
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc
    except Exception as exc:
        logger.error("Transcription error: %s", exc)
        raise HTTPException(500, "Transcription failed") from exc


# ===================================================================
#  VISION ENDPOINT — Image analysis via GPT-4o
# ===================================================================


class VisionRequest(BaseModel):
    image_url: str  # base64 data URL or public URL
    analysis_type: str = "identify"  # identify | recipe | safety | nutrition | label
    user_question: str | None = None
    user_id: str | None = None

    @field_validator("image_url")
    @classmethod
    def validate_image_url_size(cls, v: str) -> str:
        # ~20MB max for base64 data URLs (covers ~15MB raw image)
        if len(v) > 20 * 1024 * 1024:
            raise ValueError("Image too large. Maximum encoded size is ~15MB.")
        return v


@app.post("/api/ai/vision")
async def ai_vision(request: Request, body: VisionRequest) -> dict:
    """Analyze a food image using GPT-4o vision."""
    _enforce_rate_limit(request)

    if not body.image_url:
        raise HTTPException(400, "image_url is required")

    allowed_types = {"identify", "recipe", "safety", "nutrition", "label"}
    if body.analysis_type not in allowed_types:
        raise HTTPException(400, f"Invalid analysis_type. Must be one of: {allowed_types}")

    # Validate that the URL looks like a base64 data URL or a proper HTTPS URL
    if not (
        body.image_url.startswith("data:image/")
        or body.image_url.startswith("https://")
    ):
        raise HTTPException(400, "image_url must be a data:image/... URL or https:// URL")

    from backend.tools import _analyze_food_image

    try:
        result = await _analyze_food_image(
            image_url=body.image_url,
            analysis_type=body.analysis_type,
            user_question=body.user_question,
        )
        return {
            "response": result.get("summary", "Image analyzed."),
            "analysis": result.get("analysis", {}),
            "analysis_type": body.analysis_type,
        }
    except Exception as exc:
        logger.error("Vision endpoint error: %s", exc)
        raise HTTPException(500, "Image analysis failed") from exc


# ===================================================================
#  LEGACY ROUTES (preserved from original ai_engine.py)
# ===================================================================

@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "ai_configured": bool(LEGACY_API_KEY),
        "openai_configured": bool(os.getenv("OPENAI_API_KEY")),
        "circuit_state": _circuit.state.value,
    }


@app.post("/api/chat")
async def chat(body: LegacyChatRequest, request: Request) -> dict:
    """Legacy chat proxy (DeepSeek / OpenAI direct passthrough)."""
    _enforce_rate_limit(request)

    payload = {
        "model": body.model,
        "messages": [m.model_dump() for m in body.messages],
        "temperature": body.temperature,
        "max_tokens": body.max_tokens,
        "stream": False,
    }
    try:
        data = await legacy_ai_request("/chat/completions", payload)
        return {"content": _extract_content(data), "model": body.model}
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc
    except Exception as exc:
        logger.error("Legacy chat error: %s", exc)
        raise HTTPException(500, "AI service unavailable") from exc


@app.post("/api/match")
async def match_food(body: MatchRequest, request: Request) -> dict:
    _enforce_rate_limit(request)
    results = compute_matches(body.request, body.available_offers, body.max_results)
    return {"matches": results, "total": len(results)}


@app.post("/api/recipes")
async def recipes(body: RecipeRequest, request: Request) -> dict:
    _enforce_rate_limit(request)

    prompt = (
        "You are a culinary expert. Suggest 3 creative recipes using some or all "
        f"of these ingredients: {', '.join(body.ingredients)}. "
        "For each recipe provide: name, ingredients list with quantities, "
        "step-by-step instructions, prep time, cook time, and servings. "
        "Return valid JSON array."
    )
    payload = {
        "model": DEFAULT_MODEL,
        "messages": [
            {
                "role": "system",
                "content": "You are a helpful culinary assistant for a food-sharing community.",
            },
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.8,
        "max_tokens": 1500,
    }
    try:
        data = await legacy_ai_request("/chat/completions", payload)
        return {"recipes": _extract_content(data)}
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc
    except Exception as exc:
        logger.error("Recipes error: %s", exc)
        raise HTTPException(500, "AI service unavailable") from exc


@app.post("/api/storage-tips")
async def storage_tips(body: StorageRequest, request: Request) -> dict:
    _enforce_rate_limit(request)

    prompt = (
        f"Provide detailed storage tips for {body.food}. Include: "
        "optimal temperature, container type, shelf life (fridge/freezer/pantry), "
        "signs of spoilage, and tips to extend freshness. Return valid JSON."
    )
    payload = {
        "model": DEFAULT_MODEL,
        "messages": [
            {"role": "system", "content": "You are a food preservation expert."},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.5,
        "max_tokens": 1000,
    }
    try:
        data = await legacy_ai_request("/chat/completions", payload)
        return {"tips": _extract_content(data)}
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc
    except Exception as exc:
        logger.error("Storage tips error: %s", exc)
        raise HTTPException(500, "AI service unavailable") from exc


@app.post("/api/impact")
async def impact(body: ImpactRequest, request: Request) -> dict:
    _enforce_rate_limit(request)
    return calculate_impact(body.food_type, body.quantity, body.unit)


@app.post("/api/food-pairings")
async def food_pairings(body: StorageRequest, request: Request) -> dict:
    _enforce_rate_limit(request)

    prompt = (
        f"Suggest complementary foods that pair well with {body.food}. "
        "Include nutritional benefits of pairings. Return valid JSON."
    )
    payload = {
        "model": DEFAULT_MODEL,
        "messages": [
            {
                "role": "system",
                "content": "You are a nutrition and food pairing expert.",
            },
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.7,
        "max_tokens": 1000,
    }
    try:
        data = await legacy_ai_request("/chat/completions", payload)
        return {"pairings": _extract_content(data)}
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc
    except Exception as exc:
        logger.error("Food pairings error: %s", exc)
        raise HTTPException(500, "AI service unavailable") from exc


# ===================================================================
#  NEW HUNGER-FIGHTING ENDPOINTS
# ===================================================================

class BenefitsCheckRequest(BaseModel):
    household_size: int = Field(ge=1, le=20)
    monthly_income: float = Field(ge=0)
    state: str | None = Field(default=None, max_length=2)
    has_children_under_5: bool = False
    has_school_age_children: bool = False
    has_seniors_60_plus: bool = False
    is_pregnant_or_postpartum: bool = False


@app.post("/api/benefits/check-eligibility")
async def check_benefits(body: BenefitsCheckRequest, request: Request) -> dict:
    """Check eligibility for SNAP, WIC, school meals, TEFAP, CSFP, Meals on Wheels."""
    _enforce_rate_limit(request)

    from backend.tools import _check_benefits_eligibility

    try:
        result = await _check_benefits_eligibility(
            household_size=body.household_size,
            monthly_income=body.monthly_income,
            state=body.state,
            has_children_under_5=body.has_children_under_5,
            has_school_age_children=body.has_school_age_children,
            has_seniors_60_plus=body.has_seniors_60_plus,
            is_pregnant_or_postpartum=body.is_pregnant_or_postpartum,
        )
        return result
    except Exception as exc:
        logger.error("Benefits check error: %s", exc)
        raise HTTPException(500, "Benefits eligibility check failed") from exc


class EmergencyFoodRequest(BaseModel):
    user_id: str = Field(min_length=1, max_length=128)
    urgency_level: str = Field(default="high", pattern=r"^(critical|high|moderate)$")
    family_size: int = Field(default=1, ge=1, le=20)
    dietary_needs: list[str] | None = None
    message: str | None = Field(default=None, max_length=2000)
    latitude: float | None = None
    longitude: float | None = None


@app.post("/api/emergency-food")
async def emergency_food(body: EmergencyFoodRequest, request: Request) -> dict:
    """Create an emergency food assistance request."""
    _enforce_rate_limit(request)

    from backend.tools import _create_emergency_food_request

    try:
        result = await _create_emergency_food_request(
            user_id=body.user_id,
            urgency_level=body.urgency_level,
            family_size=body.family_size,
            dietary_needs=body.dietary_needs,
            message=body.message,
            latitude=body.latitude,
            longitude=body.longitude,
        )
        return result
    except Exception as exc:
        logger.error("Emergency food request error: %s", exc)
        raise HTTPException(500, "Emergency food request failed") from exc


class MealPlanRequest(BaseModel):
    budget_per_day: float = Field(ge=0.5, le=100)
    family_size: int = Field(ge=1, le=20)
    days: int = Field(default=7, ge=1, le=14)
    dietary_restrictions: list[str] | None = None
    cooking_equipment: str = "full_kitchen"
    snap_eligible: bool | None = None


@app.post("/api/meal-plan")
async def meal_plan(body: MealPlanRequest, request: Request) -> dict:
    """Generate a budget-friendly meal plan."""
    _enforce_rate_limit(request)

    from backend.tools import _generate_meal_plan

    try:
        result = await _generate_meal_plan(
            budget_per_day=body.budget_per_day,
            family_size=body.family_size,
            days=body.days,
            dietary_restrictions=body.dietary_restrictions,
            cooking_equipment=body.cooking_equipment,
            snap_eligible=body.snap_eligible,
        )
        return result
    except Exception as exc:
        logger.error("Meal plan error: %s", exc)
        raise HTTPException(500, "Meal plan generation failed") from exc


class NutritionAnalysisRequest(BaseModel):
    foods: list[str] = Field(min_length=1, max_length=20)
    servings: list[str] | None = None
    identify_gaps: bool = True
    health_conditions: list[str] | None = None


@app.post("/api/nutrition/analyze")
async def nutrition_analyze(body: NutritionAnalysisRequest, request: Request) -> dict:
    """Analyze nutritional content and identify gaps."""
    _enforce_rate_limit(request)

    from backend.tools import _analyze_nutrition

    try:
        result = await _analyze_nutrition(
            foods=body.foods,
            servings=body.servings,
            identify_gaps=body.identify_gaps,
            health_conditions=body.health_conditions,
        )
        return result
    except Exception as exc:
        logger.error("Nutrition analysis error: %s", exc)
        raise HTTPException(500, "Nutrition analysis failed") from exc


class FoodSafetyRequest(BaseModel):
    food_item: str = Field(min_length=1, max_length=200)
    concern: str = "general"
    days_since_opened: int | None = None
    storage_method: str | None = None
    vulnerable_consumer: bool = False


@app.post("/api/food-safety")
async def food_safety(body: FoodSafetyRequest, request: Request) -> dict:
    """Check food safety for a specific item."""
    _enforce_rate_limit(request)

    from backend.tools import _check_food_safety

    try:
        result = await _check_food_safety(
            food_item=body.food_item,
            concern=body.concern,
            days_since_opened=body.days_since_opened,
            storage_method=body.storage_method,
            vulnerable_consumer=body.vulnerable_consumer,
        )
        return result
    except Exception as exc:
        logger.error("Food safety check error: %s", exc)
        raise HTTPException(500, "Food safety check failed") from exc


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "backend.app:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
    )
