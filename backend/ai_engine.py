"""
DoGoods AI Conversation Engine
================================
Connects OpenAI GPT-4o (reasoning), Whisper (speech-to-text), and TTS (text-to-speech).
Manages conversations: user message + ID -> profile lookup -> GPT-4o query -> text/audio response.
Includes food matching engine and environmental impact calculator.

This module is the *service layer*. FastAPI routes live in backend/app.py.

Run the API:
    uvicorn backend.app:app --host 0.0.0.0 --port 8000 --reload
"""

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
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")

# OpenAI is primary for conversation engine (GPT-4o, Whisper, TTS)
OPENAI_BASE_URL = "https://api.openai.com/v1"
DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1")

# Legacy API key resolution (for matching/recipe endpoints that use DeepSeek)
LEGACY_API_KEY = DEEPSEEK_API_KEY or OPENAI_API_KEY
LEGACY_BASE_URL = DEEPSEEK_BASE_URL if DEEPSEEK_API_KEY else OPENAI_BASE_URL
DEFAULT_MODEL = os.getenv("AI_MODEL", "deepseek-chat")

# Conversation engine models (OpenAI)
CHAT_MODEL = os.getenv("AI_CHAT_MODEL", "gpt-4o")
WHISPER_MODEL = "whisper-1"
TTS_MODEL = "tts-1"
TTS_VOICE_EN = os.getenv("AI_TTS_VOICE", "nova")
TTS_VOICE_ES = os.getenv("AI_TTS_VOICE_ES", "nova")  # Sesame-compatible Spanish voice

MAX_RETRIES = int(os.getenv("AI_MAX_RETRIES", "3"))
TIMEOUT_SECONDS = int(os.getenv("AI_TIMEOUT", "30"))

# ---------------------------------------------------------------------------
# Spanish language detection (lightweight heuristic)
# ---------------------------------------------------------------------------

_SPANISH_MARKERS = {
    "hola", "gracias", "por favor", "ayuda", "comida", "buscar",
    "quiero", "necesito", "dónde", "donde", "cómo", "como",
    "cuándo", "cuando", "tengo", "puedo", "buenos", "buenas",
    "qué", "que", "disponible", "recoger", "compartir",
    "alimentos", "comunidad", "recordatorio", "horario",
}


def detect_spanish(text: str) -> bool:
    """Fast heuristic: return True if text is likely Spanish."""
    words = set(re.split(r"\W+", text.lower()))
    # If >=2 Spanish marker words, or text has ¿ ¡ ñ accented chars
    marker_hits = len(words & _SPANISH_MARKERS)
    has_spanish_chars = bool(re.search(r"[¿¡ñáéíóúü]", text.lower()))
    return marker_hits >= 2 or (marker_hits >= 1 and has_spanish_chars)


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
    for attempt in range(retries):
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
                resp = await client.post(
                    f"{effective_base}{endpoint}",
                    json=payload,
                    headers=headers,
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
    async with httpx.AsyncClient(timeout=15) as client:
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
    """INSERT/DELETE row(s) in a Supabase table via PostgREST.

    For DELETE, pass method="DELETE" and encode filters in the table path
    (e.g. "ai_conversations?user_id=eq.abc"). data can be None for DELETE.
    """
    async with httpx.AsyncClient(timeout=15) as client:
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

    if "community_resources" in training_data:
        cr = training_data["community_resources"]
        cr_text = cr.get("description", "")
        if "national_hotlines" in cr:
            cr_text += "\n\nNational hotlines:\n" + "\n".join(f"- {h}" for h in cr["national_hotlines"])
        if "programs" in cr:
            cr_text += "\n\nAvailable programs:\n" + "\n".join(f"- {p}" for p in cr["programs"])
        if "guidance" in cr:
            cr_text += f"\n\n{cr['guidance']}"
        sections.append(f"## Community Food Resources\n{cr_text}")

    # Capabilities summary
    sections.append(
        "## Your Capabilities\n"
        "You have these tools available:\n"
        "- **search_food_near_user**: Find food listings near a location\n"
        "- **suggest_recipes**: Generate recipes from ingredients\n"
        "- **get_storage_tips**: Get food storage and preservation advice\n"
        "- **find_community_resources**: Find food banks, pantries, SNAP/WIC offices nearby\n"
        "- **analyze_food_image**: Analyze food photos (identify, recipes, safety, nutrition, labels)\n"
        "- **check_benefits_eligibility**: Check SNAP, WIC, school meals, TEFAP, CSFP, Meals on Wheels eligibility\n"
        "- **create_emergency_food_request**: Create urgent food request when someone needs food immediately\n"
        "- **generate_meal_plan**: Create budget-friendly weekly meal plans for families\n"
        "- **analyze_nutrition**: Analyze meal nutrition, find gaps, suggest affordable supplements\n"
        "- **get_food_preservation_guide**: Detailed canning, freezing, dehydrating instructions\n"
        "- **find_child_senior_programs**: School meals, summer feeding, Head Start, Meals on Wheels, CSFP\n"
        "- **check_food_safety**: Check if food is safe to eat, allergens, handling guidance\n"
        "- **find_dietary_alternatives**: Find allergen-safe, religious, medical diet substitutes\n"
        "- **get_user_profile**: Look up user information\n"
        "- **get_pickup_schedule**: Check upcoming food pickups\n"
        "- **create_reminder**: Set reminders for pickups or events\n"
        "- **get_mapbox_route**: Get walking/driving directions\n"
        "- **query_distribution_centers**: Find food distribution events\n"
        "- **get_user_dashboard**: Get user dashboard overview\n"
        "- **check_pickup_schedule**: Check scheduled pickups\n"
        "\n## CRITICAL HUNGER RESPONSE GUIDELINES\n"
        "- When someone says they're hungry, need food, or can't afford food, treat it with urgency\n"
        "- Immediately offer to search for food nearby AND share emergency resource hotlines\n"
        "- If they have children, mention school meal programs and summer feeding sites\n"
        "- If they have seniors, mention Meals on Wheels and CSFP\n"
        "- Always mention that 211 is available 24/7 for food assistance referrals\n"
        "- Check benefits eligibility proactively when income/family info is shared\n"
        "- Never make anyone feel ashamed for needing food — this is a community helping community\n"
        "- SNAP and WIC do NOT check immigration status at the federal level\n"
        "- Most food banks require NO ID and NO proof of income\n"
        "- For immediate crisis: call 211 or National Hunger Hotline 1-866-348-6479\n"
        "\nAlways use the appropriate tool when a user's question can be answered with real data. "
        "For food-insecure users, proactively share community resources and national hotline numbers.\n\n"
        "## IMPORTANT OUTPUT RULES\n"
        "- NEVER output XML, DSML, function_call tags, or any markup in your responses.\n"
        "- Use ONLY the built-in tool calling API to invoke tools — never write tool calls as text.\n"
        "- Your responses must be plain natural language, formatted with markdown when appropriate."
    )

    base = training_data.get(
        "system_base",
        "You are DoGoods AI Assistant, a warm and helpful community food sharing assistant.",
    )
    return f"{base}\n\n" + "\n\n".join(sections)


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
        """Return 'es' for Spanish, 'en' for English."""
        return "es" if detect_spanish(text) else "en"

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
        latitude: float | None = None,
        longitude: float | None = None,
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
        if lang == "es":
            messages.append({
                "role": "system",
                "content": (
                    "The user is writing in Spanish. You MUST respond entirely "
                    "in Spanish. Maintain your warm, helpful personality. "
                    "Use 'tú' for casual and 'usted' for formal contexts."
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

        # Inject user location if available
        if latitude is not None and longitude is not None:
            messages.append({
                "role": "system",
                "content": (
                    f"User's current location: latitude={latitude}, longitude={longitude}. "
                    "When calling location-based tools (search_food_near_user, "
                    "query_distribution_centers, find_community_resources, "
                    "get_mapbox_route), use these coordinates for the user's position."
                ),
            })

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
        """Try AI chat with tool calling; fall back to canned responses."""
        try:
            return await self._call_ai_chat(messages, lang=lang)
        except httpx.TimeoutException:
            logger.warning("AI chat timed out — returning canned timeout response")
            return get_canned_response("timeout", lang)
        except httpx.HTTPStatusError as exc:
            logger.error("AI chat HTTP error %s", exc.response.status_code)
            return get_canned_response("api_down", lang)
        except RuntimeError as exc:
            logger.error("AI chat runtime error: %s", exc)
            return get_canned_response("api_down", lang)
        except Exception as exc:
            logger.error("AI chat unexpected error: %s", exc)
            return get_canned_response("general_error", lang)

    # ---- AI chat completions with tool calling ---------------------------

    def _resolve_ai_config(self) -> tuple[str, str, str, list[dict]]:
        """Determine which API key, base URL, model, and tools to use.

        Priority: OpenAI (GPT-4o with full tool set including vision)
                  → DeepSeek (deepseek-chat, vision tool excluded)
        Returns: (api_key, base_url, model, tool_definitions)
        """
        if OPENAI_API_KEY:
            return (
                OPENAI_API_KEY,
                OPENAI_BASE_URL,
                CHAT_MODEL,
                self.tool_definitions,
            )
        if DEEPSEEK_API_KEY:
            # DeepSeek supports tool calling but not vision
            tools = [
                t for t in self.tool_definitions
                if t.get("function", {}).get("name") != "analyze_food_image"
            ]
            return (
                DEEPSEEK_API_KEY,
                DEEPSEEK_BASE_URL,
                DEFAULT_MODEL,
                tools,
            )
        raise RuntimeError(
            "No AI API key configured. Set OPENAI_API_KEY or DEEPSEEK_API_KEY."
        )

    # ---- Response sanitization (strip leaked DeepSeek tool markup) ------

    _DSML_BLOCK_RE = re.compile(
        r"<[｜\|]?DSML[｜\|]?function_calls>.*?</[｜\|]?DSML[｜\|]?function_calls>",
        re.DOTALL | re.IGNORECASE,
    )
    _GENERIC_FNCALL_RE = re.compile(
        r"<function_calls?>.*?</function_calls?>",
        re.DOTALL | re.IGNORECASE,
    )
    _DSML_TOOL_RE = re.compile(
        r'<[｜\|]?DSML[｜\|]?invoke\s+name="(?P<name>[^"]+)">'
        r'(?P<params>.*?)'
        r'</[｜\|]?DSML[｜\|]?invoke>',
        re.DOTALL | re.IGNORECASE,
    )
    _DSML_PARAM_RE = re.compile(
        r'<[｜\|]?DSML[｜\|]?parameter\s+name="(?P<key>[^"]+)"[^>]*>'
        r'(?P<val>.*?)'
        r'</[｜\|]?DSML[｜\|]?parameter>',
        re.DOTALL | re.IGNORECASE,
    )

    def _extract_leaked_tool_calls(self, text: str) -> list[dict]:
        """Parse DeepSeek's leaked DSML markup into structured tool calls."""
        calls = []
        for m in self._DSML_TOOL_RE.finditer(text):
            fn_name = m.group("name")
            params_raw = m.group("params")
            args = {}
            for pm in self._DSML_PARAM_RE.finditer(params_raw):
                key = pm.group("key")
                val = pm.group("val").strip()
                # Try to parse numeric values
                if val.replace(".", "", 1).replace("-", "", 1).isdigit():
                    try:
                        val = float(val) if "." in val else int(val)
                    except ValueError:
                        pass
                elif val.lower() in ("true", "false"):
                    val = val.lower() == "true"
                args[key] = val
            calls.append({"name": fn_name, "arguments": args})
        return calls

    def _sanitize_response(self, text: str | None) -> str:
        """Strip any leaked DSML / function_call XML from response text."""
        if not text:
            return ""
        cleaned = self._DSML_BLOCK_RE.sub("", text)
        cleaned = self._GENERIC_FNCALL_RE.sub("", cleaned)
        return cleaned.strip()

    async def _call_ai_chat(
        self, messages: list[dict], lang: str = "en"
    ) -> str:
        """Call the AI chat API with tool calling support.

        Works with either OpenAI (GPT-4o) or DeepSeek (deepseek-chat).
        """
        api_key, base_url, model, tools = self._resolve_ai_config()

        payload = {
            "model": model,
            "messages": messages,
            "tools": tools,
            "temperature": 0.7,
            "max_tokens": 1024,
        }
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
            resp = await client.post(
                f"{base_url}/chat/completions",
                json=payload,
                headers=headers,
            )
            resp.raise_for_status()
            data = resp.json()

        choice = data["choices"][0]
        msg = choice["message"]

        # Handle tool calls (single round) with graceful per-tool errors
        if msg.get("tool_calls"):
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

            # Follow-up call with tool results (no tools this time)
            followup_payload = {
                "model": model,
                "messages": messages,
                "temperature": 0.7,
                "max_tokens": 1024,
            }
            try:
                async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
                    resp = await client.post(
                        f"{base_url}/chat/completions",
                        json=followup_payload,
                        headers=headers,
                    )
                    resp.raise_for_status()
                    data = resp.json()
                return self._sanitize_response(data["choices"][0]["message"]["content"])
            except Exception as followup_exc:
                logger.error("AI follow-up call failed: %s", followup_exc)
                return get_canned_response("tool_error", lang)

        # Check for leaked DSML tool-call markup in plain text response
        content = msg.get("content") or ""
        leaked_calls = self._extract_leaked_tool_calls(content)
        if leaked_calls:
            logger.warning(
                "DeepSeek leaked %d tool call(s) as text — executing them",
                len(leaked_calls),
            )
            # Execute the leaked tool calls
            tool_results = {}
            for lc in leaked_calls:
                fn_name = lc["name"]
                fn_args = lc["arguments"]
                try:
                    result = await self._execute_tool(fn_name, fn_args)
                except Exception as tool_exc:
                    logger.error("Leaked tool %s failed: %s", fn_name, tool_exc)
                    result = {
                        "error": True,
                        "message": f"The {fn_name} tool encountered an error.",
                    }
                tool_results[fn_name] = result

            # Inject results as a system message and ask for a clean answer
            results_text = json.dumps(tool_results, default=str)
            messages.append({
                "role": "system",
                "content": (
                    "You attempted to call tools but the calls appeared in text "
                    "instead of using the API properly. The tools have been "
                    "executed for you. Here are the results — use them to give "
                    "the user a helpful, natural-language answer. Do NOT output "
                    "any XML, DSML, or function_call markup.\n\n"
                    f"Tool results: {results_text}"
                ),
            })

            # Follow-up call to get a clean natural-language answer
            followup_payload = {
                "model": model,
                "messages": messages,
                "temperature": 0.7,
                "max_tokens": 1024,
            }
            try:
                async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
                    resp = await client.post(
                        f"{base_url}/chat/completions",
                        json=followup_payload,
                        headers=headers,
                    )
                    resp.raise_for_status()
                    data = resp.json()
                return self._sanitize_response(data["choices"][0]["message"]["content"])
            except Exception as followup_exc:
                logger.error("Leaked-tool follow-up failed: %s", followup_exc)
                # Return the cleaned original text (without DSML tags)
                cleaned = self._sanitize_response(content)
                return cleaned if cleaned else get_canned_response("tool_error", lang)

        return self._sanitize_response(content)

    # ---- Whisper speech-to-text ------------------------------------------

    async def transcribe_audio(
        self, audio_bytes: bytes, filename: str = "audio.webm"
    ) -> str:
        """Transcribe audio using OpenAI Whisper API.

        Whisper auto-detects language (supports Spanish natively).
        Raises RuntimeError on config issues, httpx errors on API failure.
        """
        if not OPENAI_API_KEY:
            raise RuntimeError("OPENAI_API_KEY not configured")

        headers = {"Authorization": f"Bearer {OPENAI_API_KEY}"}

        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                f"{OPENAI_BASE_URL}/audio/transcriptions",
                headers=headers,
                files={"file": (filename, audio_bytes)},
                data={"model": WHISPER_MODEL, "response_format": "json"},
            )
            resp.raise_for_status()
            return resp.json()["text"]

    # ---- TTS text-to-speech ----------------------------------------------

    async def generate_speech(self, text: str, lang: str = "en") -> bytes:
        """Generate speech audio bytes using OpenAI TTS API.

        Selects voice based on language: Spanish uses TTS_VOICE_ES,
        English uses TTS_VOICE_EN (both support Sesame voices).
        """
        if not OPENAI_API_KEY:
            raise RuntimeError("OPENAI_API_KEY not configured")

        # TTS has a ~4096 char limit
        truncated = text[:4096]
        voice = TTS_VOICE_ES if lang == "es" else TTS_VOICE_EN

        headers = {
            "Authorization": f"Bearer {OPENAI_API_KEY}",
            "Content-Type": "application/json",
        }

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{OPENAI_BASE_URL}/audio/speech",
                json={
                    "model": TTS_MODEL,
                    "input": truncated,
                    "voice": voice,
                },
                headers=headers,
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
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
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


# ---------------------------------------------------------------------------
# Singleton instances
# ---------------------------------------------------------------------------

conversation_engine = ConversationEngine()


# ---------------------------------------------------------------------------
# Legacy helpers used by app.py routes (matching, recipes, etc.)
# ---------------------------------------------------------------------------

async def legacy_ai_request(endpoint: str, payload: dict) -> dict:
    """Call DeepSeek/OpenAI for legacy routes (recipes, storage tips, etc.)."""
    return await _ai_request(endpoint, payload)
