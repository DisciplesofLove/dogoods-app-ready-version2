"""
DoGoods AI Conversation Engine
================================
World-class AI engine for fighting hunger: GPT-4o vision for food recognition,
Whisper STT, TTS, DeepSeek chat, multi-turn tool calling, food safety verification,
advanced AI matching, multi-language support (10+ languages), analytics, and
connection pooling for production speed.

This module is the *service layer*. FastAPI routes live in backend/app.py.

Run the API:
    uvicorn backend.app:app --host 0.0.0.0 --port 8000 --reload
"""

import asyncio
import hashlib
import json
import logging
import math
import os
import re
import time
from datetime import datetime, timezone
from enum import Enum
from typing import Optional

import httpx
from dotenv import load_dotenv

load_dotenv(".env.local")
load_dotenv(".env")  # fallback if .env.local doesn't exist

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ai_engine")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "") or os.getenv("VITE_OPENAI_API_KEY", "")
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "") or os.getenv("VITE_DEEPSEEK_API_KEY", "")

# OpenAI (needed for Whisper STT, TTS, and GPT-4o Vision)
OPENAI_BASE_URL = "https://api.openai.com/v1"
DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1")

# Primary AI key: prefer DeepSeek for chat, fall back to OpenAI
PRIMARY_API_KEY = DEEPSEEK_API_KEY or OPENAI_API_KEY
PRIMARY_BASE_URL = DEEPSEEK_BASE_URL if DEEPSEEK_API_KEY else OPENAI_BASE_URL

# Legacy alias (used by matching/recipe/storage endpoints)
LEGACY_API_KEY = PRIMARY_API_KEY
LEGACY_BASE_URL = PRIMARY_BASE_URL
DEFAULT_MODEL = os.getenv("AI_MODEL", "deepseek-chat")

# Conversation engine — DeepSeek primary (OpenAI-compatible API)
CHAT_MODEL = os.getenv("AI_CHAT_MODEL", "deepseek-chat")
CHAT_API_KEY = DEEPSEEK_API_KEY or OPENAI_API_KEY
CHAT_BASE_URL = DEEPSEEK_BASE_URL if DEEPSEEK_API_KEY else OPENAI_BASE_URL

# Vision model — OpenAI only (DeepSeek doesn't support vision)
VISION_MODEL = os.getenv("AI_VISION_MODEL", "gpt-4o")

# Whisper / TTS (OpenAI only — optional)
WHISPER_MODEL = "whisper-1"
TTS_MODEL = "tts-1"
TTS_VOICE_EN = os.getenv("AI_TTS_VOICE", "nova")
TTS_VOICE_ES = os.getenv("AI_TTS_VOICE_ES", "nova")

MAX_RETRIES = int(os.getenv("AI_MAX_RETRIES", "3"))
TIMEOUT_SECONDS = int(os.getenv("AI_TIMEOUT", "30"))

# ---------------------------------------------------------------------------
# Multi-language detection (10+ languages)
# ---------------------------------------------------------------------------

_LANG_MARKERS: dict[str, set[str]] = {
    "es": {
        "hola", "gracias", "por favor", "ayuda", "comida", "buscar",
        "quiero", "necesito", "dónde", "donde", "cómo", "como",
        "cuándo", "cuando", "tengo", "puedo", "buenos", "buenas",
        "qué", "que", "disponible", "recoger", "compartir",
        "alimentos", "comunidad", "recordatorio", "horario",
    },
    "fr": {
        "bonjour", "merci", "aidez", "nourriture", "chercher", "besoin",
        "comment", "quand", "avoir", "pouvoir", "disponible", "communauté",
        "bonsoir", "salut", "svp", "manger", "partager", "trouver",
    },
    "pt": {
        "olá", "obrigado", "obrigada", "ajuda", "comida", "procurar",
        "preciso", "como", "quando", "posso", "disponível", "comunidade",
        "bom dia", "boa tarde", "compartilhar", "encontrar", "alimento",
    },
    "ar": {
        "مرحبا", "شكرا", "مساعدة", "طعام", "بحث", "أحتاج",
        "كيف", "متى", "أين", "متاح", "مجتمع",
    },
    "hi": {
        "नमस्ते", "धन्यवाद", "मदद", "खाना", "खोजें", "चाहिए",
        "कैसे", "कब", "कहाँ", "उपलब्ध", "समुदाय",
    },
    "zh": {
        "你好", "谢谢", "帮助", "食物", "搜索", "需要",
        "怎么", "什么时候", "在哪里", "可用", "社区",
    },
    "sw": {
        "habari", "asante", "msaada", "chakula", "tafuta", "nahitaji",
        "vipi", "lini", "wapi", "inapatikana", "jamii",
    },
    "bn": {
        "হ্যালো", "ধন্যবাদ", "সাহায্য", "খাবার", "খুঁজুন", "দরকার",
        "কিভাবে", "কখন", "কোথায়", "উপলব্ধ", "সম্প্রদায়",
    },
    "ht": {
        "bonjou", "mèsi", "ede", "manje", "chèche", "bezwen",
        "kijan", "kilè", "ki kote", "disponib", "kominote",
    },
}

_LANG_CHAR_PATTERNS: dict[str, str] = {
    "es": r"[¿¡ñáéíóúü]",
    "fr": r"[àâçéèêëïîôùûüÿœæ]",
    "pt": r"[ãõçàáâéêíóôú]",
    "ar": r"[\u0600-\u06FF]",
    "hi": r"[\u0900-\u097F]",
    "zh": r"[\u4e00-\u9fff]",
    "bn": r"[\u0980-\u09FF]",
}

SUPPORTED_LANGUAGES = {
    "en": "English", "es": "Spanish", "fr": "French", "pt": "Portuguese",
    "ar": "Arabic", "hi": "Hindi", "zh": "Chinese", "sw": "Swahili",
    "bn": "Bengali", "ht": "Haitian Creole",
}


def detect_language(text: str) -> str:
    """Detect language from text using marker words and character patterns.
    Returns ISO 639-1 code. Defaults to 'en' if uncertain."""
    words = set(re.split(r"\W+", text.lower()))
    best_lang = "en"
    best_score = 0

    for lang, markers in _LANG_MARKERS.items():
        marker_hits = len(words & markers)
        char_pattern = _LANG_CHAR_PATTERNS.get(lang)
        has_chars = bool(re.search(char_pattern, text.lower())) if char_pattern else False

        score = marker_hits * 2 + (3 if has_chars else 0)
        if score > best_score:
            best_score = score
            best_lang = lang

    # Need at least 2 points to override English default
    return best_lang if best_score >= 2 else "en"


# Keep backward compat
def detect_spanish(text: str) -> bool:
    """Fast heuristic: return True if text is likely Spanish."""
    return detect_language(text) == "es"


# ---------------------------------------------------------------------------
# Canned fallback responses (used when OpenAI is unavailable)
# ---------------------------------------------------------------------------

CANNED_RESPONSES = {
    "en": {
        "timeout": (
            "I'm sorry, I'm taking a bit longer than usual to respond. "
            "Please try again in a moment. In the meantime, you can "
            "browse available food on the Find Food page or check "
            "your dashboard for updates."
        ),
        "api_down": (
            "I'm temporarily unable to connect to my AI service. "
            "Don't worry — you can still browse food listings, "
            "manage your profile, and check your schedule directly "
            "on the app. I'll be back shortly!"
        ),
        "general_error": (
            "Something went wrong on my end. Please try again, "
            "or use the app's navigation to find what you need. "
            "If the issue persists, contact support."
        ),
        "tool_error": (
            "I wasn't able to look up that information right now, "
            "but I can still help answer general questions. "
            "You can also check the app directly for the latest data."
        ),
    },
    "es": {
        "timeout": (
            "Lo siento, estoy tardando un poco más de lo normal en responder. "
            "Por favor, inténtalo de nuevo en un momento. Mientras tanto, "
            "puedes explorar los alimentos disponibles en la página "
            "Buscar Comida o revisar tu panel de control."
        ),
        "api_down": (
            "No puedo conectarme a mi servicio de inteligencia artificial "
            "en este momento. No te preocupes — aún puedes explorar "
            "los listados de comida, gestionar tu perfil y revisar "
            "tu horario directamente en la aplicación. ¡Volveré pronto!"
        ),
        "general_error": (
            "Algo salió mal de mi lado. Por favor, inténtalo de nuevo "
            "o usa la navegación de la aplicación para encontrar lo que "
            "necesitas. Si el problema persiste, contacta a soporte."
        ),
        "tool_error": (
            "No pude buscar esa información en este momento, "
            "pero aún puedo ayudarte con preguntas generales. "
            "También puedes revisar la aplicación directamente "
            "para los datos más recientes."
        ),
    },
}


def get_canned_response(error_type: str, lang: str = "en") -> str:
    """Return a canned fallback response for the given error type and language."""
    lang_key = "es" if lang == "es" else "en"
    return CANNED_RESPONSES.get(lang_key, CANNED_RESPONSES["en"]).get(
        error_type, CANNED_RESPONSES[lang_key]["general_error"]
    )
RATE_LIMIT_DEFAULT = 50
RATE_LIMIT_WINDOW = 60

# Supabase (service role for server-side operations)
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

TRAINING_DATA_PATH = os.path.join(os.path.dirname(__file__), "ai_training_data.json")


# ---------------------------------------------------------------------------
# Connection pool — shared httpx clients (reused across requests)
# ---------------------------------------------------------------------------

_ai_client: httpx.AsyncClient | None = None
_supabase_client: httpx.AsyncClient | None = None


def _get_ai_client() -> httpx.AsyncClient:
    """Lazily create and return a shared httpx client for AI API calls."""
    global _ai_client
    if _ai_client is None or _ai_client.is_closed:
        _ai_client = httpx.AsyncClient(
            timeout=httpx.Timeout(TIMEOUT_SECONDS, connect=10),
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
            http2=False,  # DeepSeek/OpenAI work on HTTP/1.1
        )
    return _ai_client


def _get_supabase_client() -> httpx.AsyncClient:
    """Shared httpx client for Supabase requests."""
    global _supabase_client
    if _supabase_client is None or _supabase_client.is_closed:
        _supabase_client = httpx.AsyncClient(
            timeout=15,
            limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
        )
    return _supabase_client


async def close_clients():
    """Gracefully close shared HTTP clients (call on shutdown)."""
    global _ai_client, _supabase_client
    if _ai_client and not _ai_client.is_closed:
        await _ai_client.aclose()
        _ai_client = None
    if _supabase_client and not _supabase_client.is_closed:
        await _supabase_client.aclose()
        _supabase_client = None


# ---------------------------------------------------------------------------
# Tool result cache (in-memory TTL cache)
# ---------------------------------------------------------------------------

_tool_cache: dict[str, tuple[float, object]] = {}
_TOOL_CACHE_TTL = {
    "search_food_near_user": 300,        # 5 min
    "get_user_profile": 900,             # 15 min
    "get_pickup_schedule": 300,           # 5 min
    "query_distribution_centers": 600,    # 10 min
    "get_user_dashboard": 300,            # 5 min
    "check_pickup_schedule": 300,         # 5 min
    "__default__": 300,                   # 5 min fallback
}


def _cache_key(tool_name: str, args: dict) -> str:
    """Generate a cache key for tool results."""
    args_str = json.dumps(args, sort_keys=True, default=str)
    h = hashlib.md5(args_str.encode()).hexdigest()[:12]
    return f"{tool_name}:{h}"


def _cache_get(tool_name: str, args: dict) -> object | None:
    """Get a cached tool result if fresh, else None."""
    key = _cache_key(tool_name, args)
    if key in _tool_cache:
        ts, val = _tool_cache[key]
        ttl = _TOOL_CACHE_TTL.get(tool_name, _TOOL_CACHE_TTL["__default__"])
        if time.time() - ts < ttl:
            return val
        del _tool_cache[key]
    return None


def _cache_set(tool_name: str, args: dict, result: object) -> None:
    """Cache a tool result."""
    key = _cache_key(tool_name, args)
    _tool_cache[key] = (time.time(), result)
    # Evict oldest entries if cache grows too large
    if len(_tool_cache) > 500:
        oldest = sorted(_tool_cache.items(), key=lambda x: x[1][0])
        for k, _ in oldest[: len(oldest) // 2]:
            del _tool_cache[k]

# ---------------------------------------------------------------------------
# Rate limiter (in-memory, per-IP)
# ---------------------------------------------------------------------------

_rate_store: dict[str, list[float]] = {}


def check_rate_limit(client_ip: str, limit: int = RATE_LIMIT_DEFAULT) -> bool:
    """Return True if request is allowed, raise on limit breach."""
    now = time.time()
    timestamps = _rate_store.setdefault(client_ip, [])
    _rate_store[client_ip] = [t for t in timestamps if now - t < RATE_LIMIT_WINDOW]
    if len(_rate_store[client_ip]) >= limit:
        return False
    _rate_store[client_ip].append(now)
    return True


# ---------------------------------------------------------------------------
# Circuit breaker
# ---------------------------------------------------------------------------

class CircuitState(Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


class CircuitBreaker:
    def __init__(
        self,
        failure_threshold: int = 5,
        reset_timeout: float = 60.0,
    ):
        self.failure_threshold = failure_threshold
        self.reset_timeout = reset_timeout
        self.state = CircuitState.CLOSED
        self.failure_count = 0
        self.last_failure_time: float = 0

    def record_success(self) -> None:
        self.failure_count = 0
        self.state = CircuitState.CLOSED

    def record_failure(self) -> None:
        self.failure_count += 1
        self.last_failure_time = time.time()
        if self.failure_count >= self.failure_threshold:
            self.state = CircuitState.OPEN

    def allow_request(self) -> bool:
        if self.state == CircuitState.CLOSED:
            return True
        if self.state == CircuitState.OPEN:
            if time.time() - self.last_failure_time >= self.reset_timeout:
                self.state = CircuitState.HALF_OPEN
                return True
            return False
        # HALF_OPEN — allow one probe request
        return True


_circuit = CircuitBreaker()

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class ChatMessage:
    """Lightweight message container (Pydantic models live in app.py)."""
    def __init__(self, role: str, content: str):
        self.role = role
        self.content = content

    def to_dict(self) -> dict:
        return {"role": self.role, "content": self.content}


# ---------------------------------------------------------------------------
# HTTP helpers — call external AI API with retry + circuit breaker
# ---------------------------------------------------------------------------

async def _ai_request(
    endpoint: str,
    payload: dict,
    *,
    base_url: str | None = None,
    api_key: str | None = None,
    retries: int = MAX_RETRIES,
) -> dict:
    """Make an HTTP request to an AI API with retries and circuit breaker."""
    import asyncio

    effective_key = api_key or LEGACY_API_KEY
    effective_base = base_url or LEGACY_BASE_URL

    if not effective_key:
        raise RuntimeError("AI API key is not configured")

    if not _circuit.allow_request():
        raise RuntimeError("AI service temporarily unavailable (circuit open)")

    headers = {
        "Authorization": f"Bearer {effective_key}",
        "Content-Type": "application/json",
    }

    last_exc: Exception | None = None
    client = _get_ai_client()
    for attempt in range(retries):
        try:
            resp = await client.post(
                f"{effective_base}{endpoint}",
                json=payload,
                headers=headers,
                timeout=TIMEOUT_SECONDS,
            )
            if resp.status_code == 429:
                wait = 2**attempt + 1
                logger.warning("Rate‑limited by upstream, retrying in %ds", wait)
                await asyncio.sleep(wait)
                continue
            resp.raise_for_status()
            _circuit.record_success()
            return resp.json()
        except httpx.HTTPStatusError as exc:
            last_exc = exc
            logger.error("AI API error %s: %s", exc.response.status_code, exc.response.text[:300])
            _circuit.record_failure()
            if exc.response.status_code in (401, 403):
                raise RuntimeError("AI authentication failed") from exc
        except httpx.TimeoutException as exc:
            last_exc = exc
            logger.warning("AI API timeout (attempt %d/%d)", attempt + 1, retries)
            _circuit.record_failure()
        except httpx.RequestError as exc:
            last_exc = exc
            logger.warning("AI API request error: %s", exc)
            _circuit.record_failure()

        if attempt < retries - 1:
            await asyncio.sleep(2**attempt)

    raise RuntimeError(f"AI request failed after {retries} attempts: {last_exc}")


# Public alias used by legacy routes in app.py
legacy_ai_request = _ai_request


def _extract_content(response: dict) -> str:
    try:
        return response["choices"][0]["message"]["content"]
    except (KeyError, IndexError) as exc:
        raise RuntimeError("Unexpected AI response format") from exc


# ---------------------------------------------------------------------------
# Matching engine (port of MatchingEngine.js core logic)
# ---------------------------------------------------------------------------

FOOD_GROUPS: dict[str, list[str]] = {
    "proteins": ["meat", "chicken", "fish", "eggs", "beans", "lentils", "tofu", "nuts"],
    "grains": ["rice", "bread", "pasta", "cereal", "oats", "wheat", "flour", "noodles"],
    "vegetables": ["carrot", "broccoli", "spinach", "tomato", "potato", "onion", "pepper", "lettuce"],
    "fruits": ["apple", "banana", "orange", "grape", "strawberry", "mango", "pear", "watermelon"],
    "dairy": ["milk", "cheese", "yogurt", "butter", "cream"],
}

SEASONAL_FOODS: dict[str, list[str]] = {
    "spring": ["strawberry", "asparagus", "peas", "spinach", "lettuce"],
    "summer": ["tomato", "watermelon", "corn", "pepper", "mango"],
    "fall": ["apple", "pumpkin", "squash", "grape", "pear"],
    "winter": ["orange", "potato", "carrot", "broccoli", "cabbage"],
}


def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distance in km between two lat/lng points."""
    R = 6371.0
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(d_lon / 2) ** 2
    )
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _current_season() -> str:
    month = datetime.now().month
    if month in (3, 4, 5):
        return "spring"
    if month in (6, 7, 8):
        return "summer"
    if month in (9, 10, 11):
        return "fall"
    return "winter"


def _classify_food_group(name: str) -> str:
    lower = name.lower()
    for group, items in FOOD_GROUPS.items():
        if any(item in lower for item in items):
            return group
    return "other"


def _score_location(req: dict, offer: dict, max_km: float = 20.0) -> float:
    req_loc = req.get("location")
    off_loc = offer.get("location")
    if not req_loc or not off_loc:
        return 0.5
    try:
        dist = _haversine(req_loc["lat"], req_loc["lng"], off_loc["lat"], off_loc["lng"])
    except (KeyError, TypeError):
        return 0.5
    if dist > max_km:
        return 0.0
    return max(0.0, 1.0 - dist / max_km)


def _score_nutritional(req: dict, offer: dict) -> float:
    req_group = _classify_food_group(req.get("name", ""))
    off_group = _classify_food_group(offer.get("name", ""))
    if req_group == off_group and req_group != "other":
        return 1.0
    if req_group != "other" and off_group != "other":
        return 0.6
    return 0.3


def _score_seasonal(offer: dict) -> float:
    season = _current_season()
    foods = SEASONAL_FOODS.get(season, [])
    name = offer.get("name", "").lower()
    if any(f in name for f in foods):
        return 1.0
    return 0.4


def _score_urgency(offer: dict) -> float:
    expiry = offer.get("expiry_date") or offer.get("expiryDate")
    if not expiry:
        return 0.5
    try:
        exp_dt = datetime.fromisoformat(expiry.replace("Z", "+00:00"))
        hours_left = (exp_dt - datetime.now(exp_dt.tzinfo)).total_seconds() / 3600
    except (ValueError, TypeError):
        return 0.5
    if hours_left < 0:
        return 0.0
    if hours_left < 6:
        return 1.0
    if hours_left < 24:
        return 0.8
    if hours_left < 72:
        return 0.5
    return 0.3


def _score_trust(offer: dict) -> float:
    rating = offer.get("donor_rating", offer.get("donorRating", 0))
    try:
        rating = float(rating)
    except (ValueError, TypeError):
        return 0.5
    return min(rating / 5.0, 1.0)


def _determine_match_type(score: float, urgency: float) -> str:
    if urgency >= 0.8:
        return "urgent"
    if score >= 0.75:
        return "fair_trade"
    return "loop_trade"


WEIGHTS = {
    "location": 0.20,
    "urgency": 0.20,
    "nutritional": 0.10,
    "seasonal": 0.10,
    "trust": 0.15,
}
# Remaining 0.25 reserved for AI‑augmented scoring when API is available


def compute_matches(request: dict, offers: list[dict], max_results: int = 10) -> list[dict]:
    scored: list[dict] = []
    for offer in offers:
        loc = _score_location(request, offer)
        urg = _score_urgency(offer)
        nut = _score_nutritional(request, offer)
        sea = _score_seasonal(offer)
        tru = _score_trust(offer)

        total = (
            WEIGHTS["location"] * loc
            + WEIGHTS["urgency"] * urg
            + WEIGHTS["nutritional"] * nut
            + WEIGHTS["seasonal"] * sea
            + WEIGHTS["trust"] * tru
        ) / sum(WEIGHTS.values())  # normalise to 0‑1 scale

        scored.append(
            {
                "offer": offer,
                "score": round(total, 4),
                "breakdown": {
                    "location": round(loc, 3),
                    "urgency": round(urg, 3),
                    "nutritional": round(nut, 3),
                    "seasonal": round(sea, 3),
                    "trust": round(tru, 3),
                },
                "match_type": _determine_match_type(total, urg),
            }
        )

    scored.sort(key=lambda m: m["score"], reverse=True)
    return scored[:max_results]


# ---------------------------------------------------------------------------
# Environmental impact calculator (mirrors aiAgent.js)
# ---------------------------------------------------------------------------

# Approximate values per kg — sourced from commonly cited food‑waste studies.
_IMPACT_FACTORS: dict[str, dict[str, float]] = {
    "default": {"water_litres": 500, "co2_kg": 2.5, "land_m2": 3.0},
    "meat": {"water_litres": 15400, "co2_kg": 27.0, "land_m2": 20.0},
    "dairy": {"water_litres": 1020, "co2_kg": 3.2, "land_m2": 2.0},
    "vegetables": {"water_litres": 322, "co2_kg": 0.5, "land_m2": 0.3},
    "fruits": {"water_litres": 962, "co2_kg": 1.1, "land_m2": 0.5},
    "grains": {"water_litres": 1644, "co2_kg": 1.4, "land_m2": 1.5},
}

_UNIT_TO_KG: dict[str, float] = {
    "kg": 1.0,
    "lbs": 0.4536,
    "lb": 0.4536,
    "g": 0.001,
    "oz": 0.02835,
    "pieces": 0.15,
    "servings": 0.25,
    "serving": 0.25,
}


def calculate_impact(food_type: str, quantity: float, unit: str) -> dict:
    kg = quantity * _UNIT_TO_KG.get(unit.lower(), 0.15)
    group = _classify_food_group(food_type)
    factors = _IMPACT_FACTORS.get(group, _IMPACT_FACTORS["default"])

    water = round(factors["water_litres"] * kg, 1)
    co2 = round(factors["co2_kg"] * kg, 2)
    land = round(factors["land_m2"] * kg, 2)

    return {
        "water_saved_litres": water,
        "co2_prevented_kg": co2,
        "land_saved_m2": land,
        "equivalents": {
            "car_km_avoided": round(co2 / 0.21, 1),
            "showers_saved": round(water / 65, 1),
        },
    }


# ---------------------------------------------------------------------------
# Supabase REST helpers (service-role, server-side only)
# ---------------------------------------------------------------------------

def _supabase_headers() -> dict:
    return {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


async def supabase_get(table: str, params: dict) -> list:
    """GET rows from a Supabase table via PostgREST."""
    client = _get_supabase_client()
    resp = await client.get(
        f"{SUPABASE_URL}/rest/v1/{table}",
        params=params,
        headers=_supabase_headers(),
    )
    resp.raise_for_status()
    return resp.json()


async def supabase_post(
    table: str, data: dict | list | None, *, method: str = "POST"
) -> list:
    """INSERT/DELETE row(s) in a Supabase table via PostgREST."""
    client = _get_supabase_client()
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    headers = _supabase_headers()

    if method.upper() == "DELETE":
        resp = await client.delete(url, headers=headers)
    else:
        resp = await client.post(url, json=data, headers=headers)

    resp.raise_for_status()
    try:
        result = resp.json()
        return result if isinstance(result, list) else [result]
    except Exception:
        return []


# ---------------------------------------------------------------------------
# Training data loader
# ---------------------------------------------------------------------------

def _load_training_data() -> dict:
    try:
        with open(TRAINING_DATA_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        logger.warning("Training data not found: %s", TRAINING_DATA_PATH)
        return {}


def _build_system_prompt(training_data: dict) -> str:
    """Assemble a system prompt from training data sections."""
    sections: list[str] = []

    if "platform_overview" in training_data:
        sections.append(f"## Platform Overview\n{training_data['platform_overview']}")

    if "user_roles" in training_data:
        roles = "\n".join(
            f"- **{r['role']}**: {r['description']}"
            for r in training_data["user_roles"]
        )
        sections.append(f"## User Roles\n{roles}")

    if "processes" in training_data:
        procs = "\n".join(f"- {p}" for p in training_data["processes"])
        sections.append(f"## Key Processes\n{procs}")

    if "food_safety" in training_data:
        safety = "\n".join(f"- {s}" for s in training_data["food_safety"])
        sections.append(f"## Food Safety Guidelines\n{safety}")

    if "tone_guidelines" in training_data:
        sections.append(f"## Communication Style\n{training_data['tone_guidelines']}")

    if "spanish_guidelines" in training_data:
        sections.append(
            f"## Spanish Response Guidelines\n{training_data['spanish_guidelines']}"
        )

    base = training_data.get(
        "system_base",
        "You are DoGoods AI Assistant, a warm and helpful community food sharing assistant.",
    )
    return (
        f"{base}\n\n"
        "IMPORTANT: Respond in English by default. Only respond in Spanish "
        "when the user explicitly writes in Spanish.\n\n"
        + "\n\n".join(sections)
    )


# ---------------------------------------------------------------------------
# Conversation Engine
# ---------------------------------------------------------------------------

class ConversationEngine:
    """
    Manages AI conversations:
      user message + user_id -> profile lookup -> GPT-4o query -> text/audio response
    """

    def __init__(self) -> None:
        self.training_data = _load_training_data()
        self.system_prompt = _build_system_prompt(self.training_data)

        # Import tool definitions (lazy to avoid circular imports)
        from backend.tools import TOOL_DEFINITIONS, execute_tool

        self.tool_definitions = TOOL_DEFINITIONS
        self._execute_tool = execute_tool

    # ---- Language detection -----------------------------------------------

    def _detect_lang(self, text: str) -> str:
        """Return ISO language code using multi-language detection."""
        return detect_language(text)

    # ---- Profile lookup ---------------------------------------------------

    async def get_user_profile(self, user_id: str) -> Optional[dict]:
        """Fetch user profile from Supabase users table."""
        if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
            logger.warning("Supabase not configured — skipping profile lookup")
            return None
        try:
            rows = await supabase_get("users", {
                "id": f"eq.{user_id}",
                "select": "id,name,email,is_admin,avatar_url,organization,created_at",
            })
            return rows[0] if rows else None
        except Exception as exc:
            logger.error("Profile lookup failed for %s: %s", user_id, exc)
            return None

    # ---- Conversation history ---------------------------------------------

    async def get_conversation_history(
        self, user_id: str, limit: int = 50
    ) -> list[dict]:
        """Retrieve recent conversation messages from ai_conversations table."""
        if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
            return []
        try:
            rows = await supabase_get("ai_conversations", {
                "user_id": f"eq.{user_id}",
                "select": "role,message,created_at",
                "order": "created_at.desc",
                "limit": str(limit),
            })
            rows.reverse()  # chronological order
            return rows
        except Exception as exc:
            logger.error("History fetch failed for %s: %s", user_id, exc)
            return []

    # ---- Store messages ---------------------------------------------------

    async def store_message(
        self,
        user_id: str,
        role: str,
        message: str,
        metadata: dict | None = None,
    ) -> None:
        """Persist a conversation message to ai_conversations table."""
        if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
            return
        try:
            await supabase_post("ai_conversations", {
                "user_id": user_id,
                "role": role,
                "message": message,
                "metadata": metadata or {},
            })
        except Exception as exc:
            logger.error("Failed to store message: %s", exc)

    # ---- Main chat flow ---------------------------------------------------

    async def chat(
        self,
        user_id: str,
        message: str,
        include_audio: bool = False,
    ) -> dict:
        """
        Full conversation flow:
          1. Detect language (Spanish / English)
          2. Look up user profile
          3. Fetch conversation history
          4. Build messages with system prompt + context + history + new message
          5. Call GPT-4o with tool definitions (with fallback)
          6. Store user + assistant messages
          7. Optionally generate TTS audio (language-aware voice)
          8. Return text + audio URL + detected language
        """
        # 1. Language detection
        lang = self._detect_lang(message)

        # 2. Profile (graceful — failure doesn't block chat)
        profile = await self.get_user_profile(user_id)

        # 3. History
        history = await self.get_conversation_history(user_id, limit=20)

        # 4. Build messages
        messages: list[dict] = [{"role": "system", "content": self.system_prompt}]

        # Inject language directive
        if lang != "en" and lang in SUPPORTED_LANGUAGES:
            lang_name = SUPPORTED_LANGUAGES[lang]
            messages.append({
                "role": "system",
                "content": (
                    f"The user is writing in {lang_name}. You MUST respond entirely "
                    f"in {lang_name}. Maintain your warm, helpful personality."
                ),
            })

        if profile:
            context = (
                f"Current user: {profile.get('name', 'Community Member')} "
                f"(ID: {user_id}). "
                f"Organization: {profile.get('organization', 'N/A')}. "
                f"Role: {'Admin' if profile.get('is_admin') else 'Member'}. "
                f"When calling tools that require user_id, always use \"{user_id}\"."
            )
            messages.append({"role": "system", "content": context})
        else:
            # No profile found, still provide user_id for tool calls
            context = (
                f"Current user ID: {user_id}. "
                f"When calling tools that require user_id, always use \"{user_id}\"."
            )
            messages.append({"role": "system", "content": context})

        for msg in history:
            messages.append({"role": msg["role"], "content": msg["message"]})

        messages.append({"role": "user", "content": message})

        # 5. Call GPT-4o with full fallback chain
        response_text = await self._call_with_fallbacks(messages, lang)

        # 6. Persist conversation
        await self.store_message(user_id, "user", message)
        await self.store_message(
            user_id, "assistant", response_text,
            metadata={"lang": lang},
        )

        # 7. Optional audio (language-aware voice selection)
        audio_url = None
        if include_audio:
            audio_url = await self._generate_audio_url(response_text, lang=lang)

        return {
            "text": response_text,
            "audio_url": audio_url,
            "user_id": user_id,
            "lang": lang,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    # ---- Fallback-aware orchestrator --------------------------------------

    async def _call_with_fallbacks(
        self, messages: list[dict], lang: str = "en"
    ) -> str:
        """Try GPT-4o; on failure fall back to text-only canned responses."""
        # Attempt 1: Full GPT-4o with tool calling
        try:
            return await self._call_openai_chat(messages, lang=lang)
        except httpx.TimeoutException:
            logger.warning("GPT-4o timed out — returning canned timeout response")
            return get_canned_response("timeout", lang)
        except httpx.HTTPStatusError as exc:
            logger.error("GPT-4o HTTP error %s", exc.response.status_code)
            return get_canned_response("api_down", lang)
        except RuntimeError as exc:
            # e.g. "OPENAI_API_KEY not configured"
            logger.error("GPT-4o runtime error: %s", exc)
            return get_canned_response("api_down", lang)
        except Exception as exc:
            logger.error("GPT-4o unexpected error: %s", exc)
            return get_canned_response("general_error", lang)

    # ---- OpenAI chat completions with tool calling -----------------------

    async def _call_openai_chat(
        self, messages: list[dict], lang: str = "en"
    ) -> str:
        """Call DeepSeek/OpenAI chat completions with multi-turn tool calling."""
        if not CHAT_API_KEY:
            raise RuntimeError("No AI API key configured (set DEEPSEEK_API_KEY or OPENAI_API_KEY)")

        headers = {
            "Authorization": f"Bearer {CHAT_API_KEY}",
            "Content-Type": "application/json",
        }

        # Allow up to 3 rounds of tool calling
        max_rounds = 3
        for round_num in range(max_rounds):
            payload = {
                "model": CHAT_MODEL,
                "messages": messages,
                "tools": self.tool_definitions,
                "temperature": 0.7,
                "max_tokens": 1024,
            }

            async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
                resp = await client.post(
                    f"{CHAT_BASE_URL}/chat/completions",
                    json=payload,
                    headers=headers,
                )
                resp.raise_for_status()
                data = resp.json()

            choice = data["choices"][0]
            msg = choice["message"]

            # If no tool calls, we have the final response
            if not msg.get("tool_calls"):
                return msg["content"]

            # Process tool calls
            messages.append(msg)
            for tool_call in msg["tool_calls"]:
                fn_name = tool_call["function"]["name"]
                try:
                    fn_args = json.loads(tool_call["function"]["arguments"])
                except (json.JSONDecodeError, TypeError) as parse_err:
                    logger.error("Bad tool args for %s: %s", fn_name, parse_err)
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tool_call["id"],
                        "content": json.dumps({"error": f"Invalid arguments: {parse_err}"}),
                    })
                    continue

                try:
                    result = await self._execute_tool(fn_name, fn_args)
                    logger.info("Tool %s returned %d bytes", fn_name, len(json.dumps(result)))
                except Exception as tool_exc:
                    logger.error("Tool %s failed: %s", fn_name, tool_exc)
                    result = {
                        "error": True,
                        "message": (
                            f"The {fn_name} tool encountered an error. "
                            "Please respond helpfully without this data."
                        ),
                    }

                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call["id"],
                    "content": json.dumps(result),
                })

        # Final call after all tool rounds (no tools to prevent infinite loop)
        followup_payload = {
            "model": CHAT_MODEL,
            "messages": messages,
            "temperature": 0.7,
            "max_tokens": 1024,
        }
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
                resp = await client.post(
                    f"{CHAT_BASE_URL}/chat/completions",
                    json=followup_payload,
                    headers=headers,
                )
                resp.raise_for_status()
                data = resp.json()
            return data["choices"][0]["message"]["content"]
        except Exception as followup_exc:
            logger.error("Final follow-up failed: %s", followup_exc)
            return get_canned_response("tool_error", lang)

    # ---- Streaming chat with tool calling --------------------------------

    async def chat_stream(
        self,
        user_id: str,
        message: str,
    ):
        """
        Streaming conversation flow — yields SSE chunks.
        Performs tool calling first (non-streaming), then streams the final response.

        Yields: str chunks in SSE format ("data: {...}\\n\\n")
        """
        import asyncio

        lang = self._detect_lang(message)
        profile = await self.get_user_profile(user_id)
        history = await self.get_conversation_history(user_id, limit=20)

        # Build messages
        messages: list[dict] = [{"role": "system", "content": self.system_prompt}]

        if lang != "en" and lang in SUPPORTED_LANGUAGES:
            lang_name = SUPPORTED_LANGUAGES[lang]
            messages.append({
                "role": "system",
                "content": (
                    f"The user is writing in {lang_name}. You MUST respond entirely "
                    f"in {lang_name}. Maintain your warm, helpful personality."
                ),
            })

        if profile:
            context = (
                f"Current user: {profile.get('name', 'Community Member')} "
                f"(ID: {user_id}). "
                f"Organization: {profile.get('organization', 'N/A')}. "
                f"Role: {'Admin' if profile.get('is_admin') else 'Member'}. "
                f"When calling tools that require user_id, always use \"{user_id}\"."
            )
            messages.append({"role": "system", "content": context})
        else:
            messages.append({
                "role": "system",
                "content": f"Current user ID: {user_id}. When calling tools that require user_id, always use \"{user_id}\".",
            })

        for msg in history:
            messages.append({"role": msg["role"], "content": msg["message"]})

        messages.append({"role": "user", "content": message})

        # Send initial metadata event
        yield f"data: {json.dumps({'type': 'meta', 'lang': lang, 'user_id': user_id})}\n\n"

        if not CHAT_API_KEY:
            error_text = get_canned_response("api_down", lang)
            yield f"data: {json.dumps({'type': 'text', 'content': error_text})}\n\n"
            yield "data: [DONE]\n\n"
            return

        headers = {
            "Authorization": f"Bearer {CHAT_API_KEY}",
            "Content-Type": "application/json",
        }

        # Phase 1: Non-streaming tool calling (up to 3 rounds)
        tools_used = []
        try:
            for round_num in range(3):
                payload = {
                    "model": CHAT_MODEL,
                    "messages": messages,
                    "tools": self.tool_definitions,
                    "temperature": 0.7,
                    "max_tokens": 1024,
                }

                ai_client = _get_ai_client()
                resp = await ai_client.post(
                    f"{CHAT_BASE_URL}/chat/completions",
                    json=payload,
                    headers=headers,
                    timeout=TIMEOUT_SECONDS,
                )
                resp.raise_for_status()
                data = resp.json()

                choice = data["choices"][0]
                msg = choice["message"]

                if not msg.get("tool_calls"):
                    # No more tool calls — if this is the first round with no tools,
                    # we want to stream the final response instead
                    if round_num == 0 and not tools_used:
                        # No tools needed — break to streaming phase
                        break
                    # We had tool calls in prior rounds, this is the final text
                    final_text = msg.get("content", "")
                    yield f"data: {json.dumps({'type': 'text', 'content': final_text})}\n\n"
                    await self.store_message(user_id, "user", message)
                    await self.store_message(user_id, "assistant", final_text, metadata={"lang": lang, "tools": tools_used})
                    yield "data: [DONE]\n\n"
                    return

                # Process tool calls
                messages.append(msg)
                for tool_call in msg["tool_calls"]:
                    fn_name = tool_call["function"]["name"]
                    tools_used.append(fn_name)

                    # Notify client about tool usage
                    yield f"data: {json.dumps({'type': 'tool', 'name': fn_name, 'status': 'calling'})}\n\n"

                    try:
                        fn_args = json.loads(tool_call["function"]["arguments"])
                    except (json.JSONDecodeError, TypeError):
                        fn_args = {}

                    try:
                        result = await self._execute_tool(fn_name, fn_args)
                    except Exception as tool_exc:
                        logger.error("Tool %s failed: %s", fn_name, tool_exc)
                        result = {"error": True, "message": f"Tool {fn_name} failed."}

                    messages.append({
                        "role": "tool",
                        "tool_call_id": tool_call["id"],
                        "content": json.dumps(result),
                    })

                    yield f"data: {json.dumps({'type': 'tool', 'name': fn_name, 'status': 'done'})}\n\n"

        except Exception as exc:
            logger.error("Tool calling phase failed: %s", exc)
            error_text = get_canned_response("general_error", lang)
            yield f"data: {json.dumps({'type': 'text', 'content': error_text})}\n\n"
            yield "data: [DONE]\n\n"
            return

        # Phase 2: Stream the final response
        stream_payload = {
            "model": CHAT_MODEL,
            "messages": messages,
            "temperature": 0.7,
            "max_tokens": 1024,
            "stream": True,
        }
        # Don't include tools in the streaming call to prevent another round
        if tools_used:
            pass  # No tools in final streaming call
        else:
            stream_payload["tools"] = self.tool_definitions

        full_response = ""
        try:
            ai_client = _get_ai_client()
            async with ai_client.stream(
                "POST",
                f"{CHAT_BASE_URL}/chat/completions",
                json=stream_payload,
                headers=headers,
                timeout=TIMEOUT_SECONDS * 2,
            ) as resp:
                    resp.raise_for_status()
                    buffer = ""
                    async for chunk in resp.aiter_text():
                        buffer += chunk
                        lines = buffer.split("\n")
                        buffer = lines.pop()

                        for line in lines:
                            line = line.strip()
                            if not line or not line.startswith("data: "):
                                continue
                            payload_str = line[6:]
                            if payload_str == "[DONE]":
                                continue
                            try:
                                parsed = json.loads(payload_str)
                                # Check for tool calls in stream (first round only)
                                delta = parsed.get("choices", [{}])[0].get("delta", {})
                                content = delta.get("content")
                                if content:
                                    full_response += content
                                    yield f"data: {json.dumps({'type': 'text', 'content': content})}\n\n"
                            except json.JSONDecodeError:
                                pass

        except Exception as exc:
            logger.error("Streaming phase failed: %s", exc)
            if not full_response:
                error_text = get_canned_response("general_error", lang)
                yield f"data: {json.dumps({'type': 'text', 'content': error_text})}\n\n"

        # Persist conversation
        if full_response:
            await self.store_message(user_id, "user", message)
            await self.store_message(
                user_id, "assistant", full_response,
                metadata={"lang": lang, "tools": tools_used},
            )

        yield "data: [DONE]\n\n"

    # ---- Dedicated AI feature methods ------------------------------------

    async def get_nutrition_analysis(self, food_items: list[str]) -> dict:
        """AI-powered nutrition analysis for a list of food items."""
        if not CHAT_API_KEY:
            raise RuntimeError("AI not configured")

        prompt = (
            "You are a certified nutritionist. Analyze these food items and provide:\n"
            "1. Estimated calories per serving for each item\n"
            "2. Key macronutrients (protein, carbs, fat) per item\n"
            "3. Notable vitamins and minerals\n"
            "4. Health benefits\n"
            "5. Dietary considerations (gluten-free, vegan, allergens)\n"
            "6. A suggested balanced meal combining these items\n\n"
            f"Food items: {', '.join(food_items)}\n\n"
            "Return as structured JSON with keys: items (array), meal_suggestion, total_estimated_calories."
        )

        data = await _ai_request(
            "/chat/completions",
            {
                "model": CHAT_MODEL,
                "messages": [
                    {"role": "system", "content": "You are a nutrition expert for a community food sharing platform. Always return valid JSON."},
                    {"role": "user", "content": prompt},
                ],
                "temperature": 0.5,
                "max_tokens": 1500,
            },
            base_url=CHAT_BASE_URL,
            api_key=CHAT_API_KEY,
        )
        return {"analysis": _extract_content(data)}

    async def get_meal_plan(
        self, ingredients: list[str], servings: int = 2, dietary: str = "none"
    ) -> dict:
        """Generate a full meal plan from available ingredients."""
        if not CHAT_API_KEY:
            raise RuntimeError("AI not configured")

        dietary_note = f" The person follows a {dietary} diet." if dietary != "none" else ""
        prompt = (
            f"Create a complete meal plan for {servings} people using some or all of "
            f"these available ingredients: {', '.join(ingredients)}.{dietary_note}\n\n"
            "Include:\n"
            "1. Breakfast, lunch, dinner, and a snack\n"
            "2. For each meal: name, ingredients needed (with quantities), "
            "brief instructions (3-5 steps), prep time, cook time\n"
            "3. A grocery list of any additional staples needed\n"
            "4. Food waste tip: how to use leftover ingredients\n\n"
            "Return as structured JSON."
        )

        data = await _ai_request(
            "/chat/completions",
            {
                "model": CHAT_MODEL,
                "messages": [
                    {"role": "system", "content": "You are a meal planning expert for a community food platform. Create practical, waste-reducing meal plans. Return valid JSON."},
                    {"role": "user", "content": prompt},
                ],
                "temperature": 0.7,
                "max_tokens": 2000,
            },
            base_url=CHAT_BASE_URL,
            api_key=CHAT_API_KEY,
        )
        return {"meal_plan": _extract_content(data)}

    async def get_donation_tips(self, food_type: str, quantity: str) -> dict:
        """AI-powered best practices for donating specific food."""
        if not CHAT_API_KEY:
            raise RuntimeError("AI not configured")

        prompt = (
            f"Provide comprehensive donation guidelines for: {quantity} of {food_type}.\n\n"
            "Include:\n"
            "1. Food safety requirements (temperature, packaging, labeling)\n"
            "2. Shelf life and best-by guidance\n"
            "3. Ideal storage during transport\n"
            "4. Packaging tips for safe sharing\n"
            "5. Legal considerations (Good Samaritan Food Donation Act)\n"
            "6. Tips for maximizing the donation's impact\n"
            "7. Who would benefit most from this type of food\n\n"
            "Return as structured JSON."
        )

        data = await _ai_request(
            "/chat/completions",
            {
                "model": CHAT_MODEL,
                "messages": [
                    {"role": "system", "content": "You are a food donation safety expert. Provide practical, safe guidelines. Return valid JSON."},
                    {"role": "user", "content": prompt},
                ],
                "temperature": 0.5,
                "max_tokens": 1500,
            },
            base_url=CHAT_BASE_URL,
            api_key=CHAT_API_KEY,
        )
        return {"tips": _extract_content(data)}

    async def get_community_insights(self) -> dict:
        """Generate community-level insights from platform data."""
        stats = {}
        if SUPABASE_URL and SUPABASE_SERVICE_KEY:
            try:
                listings = await supabase_get("food_listings", {"select": "id,category,status,created_at", "limit": "500"})
                claims = await supabase_get("food_claims", {"select": "id,status,created_at", "limit": "500"})
                events = await supabase_get("distribution_events", {"select": "id,status,registered_count,capacity", "limit": "100"})

                stats = {
                    "total_listings": len(listings),
                    "active_listings": len([l for l in listings if l.get("status") in ("approved", "active")]),
                    "completed_claims": len([c for c in claims if c.get("status") == "approved"]),
                    "pending_claims": len([c for c in claims if c.get("status") == "pending"]),
                    "upcoming_events": len([e for e in events if e.get("status") == "scheduled"]),
                    "total_event_capacity": sum(e.get("capacity", 0) for e in events if e.get("status") == "scheduled"),
                    "categories": {},
                }
                for l in listings:
                    cat = l.get("category", "other")
                    stats["categories"][cat] = stats["categories"].get(cat, 0) + 1
            except Exception as exc:
                logger.error("Community stats fetch failed: %s", exc)

        if not CHAT_API_KEY:
            return {"insights": "AI insights unavailable.", "stats": stats}

        prompt = (
            f"Based on this community food sharing platform data, provide 5 actionable insights:\n\n"
            f"Stats: {json.dumps(stats)}\n\n"
            "Include:\n"
            "1. Overall health of the food sharing community\n"
            "2. Most popular food categories and any gaps\n"
            "3. Suggestions to increase engagement\n"
            "4. Impact highlights to celebrate\n"
            "5. Recommendations for community organizers\n\n"
            "Be specific, data-driven, and encouraging."
        )

        try:
            data = await _ai_request(
                "/chat/completions",
                {
                    "model": CHAT_MODEL,
                    "messages": [
                        {"role": "system", "content": "You are a community engagement analyst for a food sharing platform."},
                        {"role": "user", "content": prompt},
                    ],
                    "temperature": 0.7,
                    "max_tokens": 1200,
                },
                base_url=CHAT_BASE_URL,
                api_key=CHAT_API_KEY,
            )
            return {"insights": _extract_content(data), "stats": stats}
        except Exception as exc:
            logger.error("Community insights AI failed: %s", exc)
            return {"insights": "Unable to generate insights at this time.", "stats": stats}

    async def get_smart_suggestions(self, user_id: str) -> dict:
        """Personalized AI suggestions based on user activity."""
        dashboard = {}
        if SUPABASE_URL and SUPABASE_SERVICE_KEY:
            try:
                from backend.tools import _get_user_dashboard
                dashboard = await _get_user_dashboard(user_id)
            except Exception as exc:
                logger.error("Dashboard fetch for suggestions failed: %s", exc)

        if not CHAT_API_KEY:
            return {"suggestions": [], "user_id": user_id}

        prompt = (
            f"Based on this user's dashboard data, provide 3-5 personalized suggestions:\n\n"
            f"Dashboard: {json.dumps(dashboard, default=str)}\n\n"
            "Suggestions should be:\n"
            "1. Actionable (something they can do right now)\n"
            "2. Relevant to their activity patterns\n"
            "3. Encouraging and motivating\n"
            "4. Mix of: sharing food, finding food, attending events, "
            "setting reminders, improving their impact\n\n"
            "Return as JSON array of objects with keys: title, description, action_type "
            "(share_food|find_food|attend_event|set_reminder|explore), priority (high|medium|low)"
        )

        try:
            data = await _ai_request(
                "/chat/completions",
                {
                    "model": CHAT_MODEL,
                    "messages": [
                        {"role": "system", "content": "You are a helpful food sharing platform assistant. Return valid JSON array."},
                        {"role": "user", "content": prompt},
                    ],
                    "temperature": 0.7,
                    "max_tokens": 1000,
                },
                base_url=CHAT_BASE_URL,
                api_key=CHAT_API_KEY,
            )
            return {"suggestions": _extract_content(data), "user_id": user_id}
        except Exception as exc:
            logger.error("Smart suggestions AI failed: %s", exc)
            return {"suggestions": [], "user_id": user_id}

    # ---- Whisper speech-to-text ------------------------------------------

    async def transcribe_audio(
        self, audio_bytes: bytes, filename: str = "audio.webm"
    ) -> str:
        """Transcribe audio using OpenAI Whisper API.

        Whisper auto-detects language (supports Spanish natively).
        Requires OPENAI_API_KEY (DeepSeek does not offer STT).
        Raises RuntimeError on config issues, httpx errors on API failure.
        """
        if not OPENAI_API_KEY:
            raise RuntimeError(
                "Voice transcription requires OPENAI_API_KEY. "
                "Please type your message instead."
            )

        headers = {"Authorization": f"Bearer {OPENAI_API_KEY}"}

        client = _get_ai_client()
        resp = await client.post(
            f"{OPENAI_BASE_URL}/audio/transcriptions",
            headers=headers,
            files={"file": (filename, audio_bytes)},
            data={"model": WHISPER_MODEL, "response_format": "json"},
            timeout=60,
        )
        resp.raise_for_status()
        return resp.json()["text"]

    # ---- TTS text-to-speech ----------------------------------------------

    async def generate_speech(self, text: str, lang: str = "en") -> bytes:
        """Generate speech audio bytes using OpenAI TTS API.

        Selects voice based on language: Spanish uses TTS_VOICE_ES,
        English uses TTS_VOICE_EN (both support Sesame voices).
        Requires OPENAI_API_KEY (DeepSeek does not offer TTS).
        """
        if not OPENAI_API_KEY:
            raise RuntimeError(
                "Text-to-speech requires OPENAI_API_KEY. "
                "Audio responses are unavailable."
            )

        # TTS has a ~4096 char limit
        truncated = text[:4096]
        voice = TTS_VOICE_ES if lang == "es" else TTS_VOICE_EN

        headers = {
            "Authorization": f"Bearer {OPENAI_API_KEY}",
            "Content-Type": "application/json",
        }

        client = _get_ai_client()
        resp = await client.post(
            f"{OPENAI_BASE_URL}/audio/speech",
            json={
                "model": TTS_MODEL,
                "input": truncated,
                "voice": voice,
            },
            headers=headers,
            timeout=30,
        )
        resp.raise_for_status()
        return resp.content

    async def _generate_audio_url(
        self, text: str, lang: str = "en"
    ) -> Optional[str]:
        """Generate speech and upload to Supabase storage, return public URL."""
        try:
            audio_bytes = await self.generate_speech(text, lang=lang)
            ts = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
            filename = f"ai-voice/{ts}-response.mp3"

            headers = {
                "apikey": SUPABASE_SERVICE_KEY,
                "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
                "Content-Type": "audio/mpeg",
            }
            sb_client = _get_supabase_client()
            resp = await sb_client.post(
                f"{SUPABASE_URL}/storage/v1/object/ai-audio/{filename}",
                content=audio_bytes,
                headers=headers,
            )
            if resp.status_code in (200, 201):
                return (
                    f"{SUPABASE_URL}/storage/v1/object/public/"
                    f"ai-audio/{filename}"
                )
            logger.warning("Audio upload failed: HTTP %s", resp.status_code)
            return None
        except Exception as exc:
            logger.warning("Audio generation failed: %s", exc)
            return None

    # ---- GPT-4o Vision: food image analysis ------------------------------

    async def analyze_food_image(self, image_base64: str) -> dict:
        """Analyze a food photo using GPT-4o vision and return structured data.

        Returns dict with keys: items, estimated_weight, freshness,
        category_suggestion, safety_notes, description.
        """
        if not OPENAI_API_KEY:
            raise RuntimeError("Food image analysis requires OPENAI_API_KEY")

        prompt = (
            "Analyze this food image for a community food-sharing platform.\n"
            "Return ONLY valid JSON with these keys:\n"
            "- items: array of identified food items with name and estimated_quantity\n"
            "- estimated_weight_kg: total estimated weight\n"
            "- freshness: one of 'fresh', 'good', 'fair', 'poor'\n"
            "- category_suggestion: best food category (produce, dairy, bakery, "
            "canned, prepared, beverages, snacks, other)\n"
            "- safety_notes: any visible safety concerns (mold, damage, improper storage)\n"
            "- description: brief 1-2 sentence description suitable for a listing title\n"
            "- dietary_tags: array of applicable tags (vegan, vegetarian, gluten-free, "
            "halal, kosher, nut-free, dairy-free)\n"
            "- allergens: array of detected common allergens"
        )

        data = await _ai_request(
            "/chat/completions",
            {
                "model": VISION_MODEL,
                "messages": [
                    {
                        "role": "system",
                        "content": "You are a food safety and identification expert. Return only valid JSON.",
                    },
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/jpeg;base64,{image_base64}",
                                    "detail": "high",
                                },
                            },
                        ],
                    },
                ],
                "max_tokens": 1000,
                "temperature": 0.3,
            },
            base_url=OPENAI_BASE_URL,
            api_key=OPENAI_API_KEY,
        )
        return {"analysis": _extract_content(data)}

    # ---- Food safety verification ----------------------------------------

    async def verify_food_safety(
        self,
        title: str,
        description: str,
        category: str = "",
        expiry: str = "",
        ingredients: str = "",
        image_url: str = "",
        allergens: list[str] | None = None,
    ) -> dict:
        """AI-powered food safety check for a listing before it goes live.

        Returns dict with: safe (bool), score (0-100), warnings (list),
        suggestions (list), category_check (str).
        """
        if not CHAT_API_KEY:
            raise RuntimeError("AI not configured")

        listing_info = (
            f"Title: {title}\nDescription: {description}\n"
            f"Category: {category}\nExpiry/Best-by: {expiry}\n"
            f"Ingredients: {ingredients}\n"
            f"Allergens declared: {', '.join(allergens or [])}\n"
            f"Image URL: {image_url or 'not provided'}"
        )

        prompt = (
            "You are a food safety inspector for a community food sharing platform.\n"
            "Evaluate this food listing for safety and compliance.\n\n"
            f"{listing_info}\n\n"
            "Return ONLY valid JSON with:\n"
            "- safe: boolean (true if safe to list)\n"
            "- score: integer 0-100 (safety confidence)\n"
            "- warnings: array of specific safety concerns\n"
            "- suggestions: array of improvements for the listing\n"
            "- category_check: 'correct' or suggested better category\n"
            "- allergen_check: any allergens likely present but not declared\n"
            "- shelf_life_estimate: estimated remaining shelf life"
        )

        data = await _ai_request(
            "/chat/completions",
            {
                "model": CHAT_MODEL,
                "messages": [
                    {"role": "system", "content": "You are a food safety expert. Be thorough but practical. Return only valid JSON."},
                    {"role": "user", "content": prompt},
                ],
                "temperature": 0.3,
                "max_tokens": 1000,
            },
            base_url=CHAT_BASE_URL,
            api_key=CHAT_API_KEY,
        )
        return {"verification": _extract_content(data)}

    # ---- Advanced AI matching --------------------------------------------

    async def advanced_match(
        self,
        user_id: str,
        food_request: str,
        location: dict | None = None,
        radius_km: float = 10.0,
        dietary: list[str] | None = None,
        max_results: int = 10,
    ) -> dict:
        """AI-enhanced food matching: rule-based filter → AI re-ranking.

        1. Fetch available listings from Supabase within radius
        2. Filter by dietary preferences
        3. Use AI to re-rank by relevance, freshness, proximity, need
        """
        listings = []
        if SUPABASE_URL and SUPABASE_SERVICE_KEY:
            try:
                listings = await supabase_get("food_listings", {
                    "status": "eq.approved",
                    "select": "id,title,description,category,quantity,unit,expiry_date,"
                              "dietary_tags,allergens,latitude,longitude,created_at,"
                              "donor_name,pickup_instructions",
                    "limit": "50",
                    "order": "created_at.desc",
                })
            except Exception as exc:
                logger.error("Listing fetch for matching failed: %s", exc)

        if not listings:
            return {"matches": [], "total_available": 0, "message": "No listings available right now."}

        if not CHAT_API_KEY:
            return {"matches": listings[:max_results], "total_available": len(listings), "ai_ranked": False}

        prompt = (
            "You are a food matching AI for a hunger-relief platform.\n"
            f"User request: \"{food_request}\"\n"
            f"Dietary preferences: {', '.join(dietary or ['none specified'])}\n"
            f"Location: {json.dumps(location) if location else 'not provided'}\n"
            f"Radius: {radius_km} km\n\n"
            f"Available listings ({len(listings)} total):\n"
            f"{json.dumps(listings[:20], default=str)}\n\n"
            "Re-rank these listings by relevance to the user's request.\n"
            "Return ONLY valid JSON with:\n"
            "- matches: array of listing IDs in order of relevance, "
            "each with: id, relevance_score (0-100), reason (brief)\n"
            f"- top {max_results} only"
        )

        try:
            data = await _ai_request(
                "/chat/completions",
                {
                    "model": CHAT_MODEL,
                    "messages": [
                        {"role": "system", "content": "You are a food matching expert. Return only valid JSON."},
                        {"role": "user", "content": prompt},
                    ],
                    "temperature": 0.4,
                    "max_tokens": 1500,
                },
                base_url=CHAT_BASE_URL,
                api_key=CHAT_API_KEY,
            )
            return {
                "matches": _extract_content(data),
                "total_available": len(listings),
                "ai_ranked": True,
            }
        except Exception as exc:
            logger.error("AI matching failed, returning unranked: %s", exc)
            return {"matches": listings[:max_results], "total_available": len(listings), "ai_ranked": False}

    async def record_match_outcome(
        self,
        match_id: str,
        user_id: str,
        listing_id: str,
        score: float,
        outcome: str,
    ) -> dict:
        """Record the outcome of a match for learning/analytics."""
        if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
            return {"stored": False}
        try:
            await supabase_post("match_outcomes", {
                "match_id": match_id,
                "user_id": user_id,
                "listing_id": listing_id,
                "score": score,
                "outcome": outcome,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
            return {"stored": True}
        except Exception as exc:
            logger.error("Match outcome storage failed: %s", exc)
            return {"stored": False}

    # ---- Analytics methods -----------------------------------------------

    async def get_analytics_community(self) -> dict:
        """Aggregate community-level analytics from Supabase."""
        result = {"period": "all_time"}
        if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
            return result
        try:
            listings = await supabase_get("food_listings", {"select": "id,status,category,created_at", "limit": "1000"})
            claims = await supabase_get("food_claims", {"select": "id,status,created_at", "limit": "1000"})
            users = await supabase_get("users", {"select": "id,created_at", "limit": "1000"})
            events = await supabase_get("distribution_events", {"select": "id,status,registered_count,capacity", "limit": "500"})

            result.update({
                "total_users": len(users),
                "total_listings": len(listings),
                "active_listings": len([l for l in listings if l.get("status") in ("approved", "active")]),
                "total_claims": len(claims),
                "completed_claims": len([c for c in claims if c.get("status") == "approved"]),
                "pending_claims": len([c for c in claims if c.get("status") == "pending"]),
                "total_events": len(events),
                "categories": {},
            })
            for l in listings:
                cat = l.get("category", "other")
                result["categories"][cat] = result["categories"].get(cat, 0) + 1
        except Exception as exc:
            logger.error("Community analytics failed: %s", exc)
        return result

    async def get_analytics_user(self, user_id: str) -> dict:
        """Per-user activity analytics."""
        result = {"user_id": user_id}
        if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
            return result
        try:
            listings = await supabase_get("food_listings", {
                "donor_id": f"eq.{user_id}",
                "select": "id,status,category,created_at",
            })
            claims = await supabase_get("food_claims", {
                "claimer_id": f"eq.{user_id}",
                "select": "id,status,created_at",
            })
            result.update({
                "listings_shared": len(listings),
                "claims_made": len(claims),
                "successful_claims": len([c for c in claims if c.get("status") == "approved"]),
                "categories_shared": list(set(l.get("category", "other") for l in listings)),
            })
        except Exception as exc:
            logger.error("User analytics failed for %s: %s", user_id, exc)
        return result

    async def get_analytics_food_waste(self) -> dict:
        """Food waste reduction analytics."""
        result = {"estimated_kg_saved": 0}
        if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
            return result
        try:
            claims = await supabase_get("food_claims", {
                "status": "eq.approved",
                "select": "id,created_at",
                "limit": "2000",
            })
            # Rough estimate: avg 2kg per claim
            result["estimated_kg_saved"] = len(claims) * 2
            result["total_successful_shares"] = len(claims)
            result["estimated_meals_provided"] = len(claims) * 3
            result["estimated_co2_saved_kg"] = len(claims) * 4.5
        except Exception as exc:
            logger.error("Waste analytics failed: %s", exc)
        return result

    async def get_analytics_matching(self) -> dict:
        """Matching system performance analytics."""
        result = {"total_matches": 0}
        if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
            return result
        try:
            outcomes = await supabase_get("match_outcomes", {
                "select": "id,score,outcome,created_at",
                "limit": "1000",
            })
            if outcomes:
                scores = [o.get("score", 0) for o in outcomes if o.get("score")]
                result.update({
                    "total_matches": len(outcomes),
                    "avg_score": sum(scores) / len(scores) if scores else 0,
                    "successful": len([o for o in outcomes if o.get("outcome") == "claimed"]),
                    "expired": len([o for o in outcomes if o.get("outcome") == "expired"]),
                })
        except Exception as exc:
            logger.error("Matching analytics failed: %s", exc)
        return result


# ---------------------------------------------------------------------------
# Singleton instances
# ---------------------------------------------------------------------------

conversation_engine = ConversationEngine()
