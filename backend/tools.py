"""
DoGoods AI Tool Signatures & Implementations
----------------------------------------------
OpenAI function-calling tool definitions for the DoGoods AI assistant.
Implements: search_food_near_user, get_user_profile, get_pickup_schedule,
            create_reminder, get_mapbox_route, query_distribution_centers,
            get_user_dashboard, check_pickup_schedule.
"""

import json
import logging
import math
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx

logger = logging.getLogger("ai_tools")

MAPBOX_TOKEN = os.getenv("VITE_MAPBOX_TOKEN", "")
MAPBOX_DIRECTIONS_URL = "https://api.mapbox.com/directions/v5/mapbox"

# ---------------------------------------------------------------------------
# OpenAI function-calling tool definitions
# ---------------------------------------------------------------------------

TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "search_food_near_user",
            "description": (
                "Search for available food listings near a user's location. "
                "Returns food items that are currently available for pickup "
                "within the specified radius."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "user_id": {
                        "type": "string",
                        "description": "The UUID of the user to search near",
                    },
                    "radius_km": {
                        "type": "number",
                        "description": "Search radius in kilometers (default 10)",
                        "default": 10,
                    },
                    "food_type": {
                        "type": "string",
                        "description": (
                            "Optional food category filter: "
                            "proteins, grains, vegetables, fruits, dairy, prepared, bakery, other"
                        ),
                    },
                    "max_results": {
                        "type": "integer",
                        "description": "Maximum number of results to return (default 10)",
                        "default": 10,
                    },
                },
                "required": ["user_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_user_profile",
            "description": (
                "Retrieve a user's profile information including name, location, "
                "preferences, dietary restrictions, and activity history summary."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "user_id": {
                        "type": "string",
                        "description": "The UUID of the user",
                    },
                },
                "required": ["user_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_pickup_schedule",
            "description": (
                "Get upcoming food pickup or distribution event schedules. "
                "Can filter by user's claimed items or by community events."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "user_id": {
                        "type": "string",
                        "description": "The UUID of the user",
                    },
                    "include_community_events": {
                        "type": "boolean",
                        "description": "Whether to include community distribution events (default true)",
                        "default": True,
                    },
                    "days_ahead": {
                        "type": "integer",
                        "description": "Number of days to look ahead (default 7)",
                        "default": 7,
                    },
                },
                "required": ["user_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_reminder",
            "description": (
                "Create a reminder for the user. Can be used for pickup reminders, "
                "listing expiry alerts, distribution events, or general reminders."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "user_id": {
                        "type": "string",
                        "description": "The UUID of the user",
                    },
                    "message": {
                        "type": "string",
                        "description": "The reminder message text",
                    },
                    "trigger_time": {
                        "type": "string",
                        "description": "ISO 8601 datetime for when to send the reminder",
                    },
                    "reminder_type": {
                        "type": "string",
                        "enum": ["pickup", "listing_expiry", "distribution_event", "general"],
                        "description": "Type of reminder (default 'general')",
                        "default": "general",
                    },
                    "related_id": {
                        "type": "string",
                        "description": "Optional UUID of related entity (food listing, event, etc.)",
                    },
                },
                "required": ["user_id", "message", "trigger_time"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_mapbox_route",
            "description": (
                "Get walking or driving directions between two points. "
                "Returns step-by-step directions, distance, and estimated travel time. "
                "Useful when a user wants to know how to get to a food pickup location."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "origin_lng": {
                        "type": "number",
                        "description": "Origin longitude",
                    },
                    "origin_lat": {
                        "type": "number",
                        "description": "Origin latitude",
                    },
                    "dest_lng": {
                        "type": "number",
                        "description": "Destination longitude",
                    },
                    "dest_lat": {
                        "type": "number",
                        "description": "Destination latitude",
                    },
                    "profile": {
                        "type": "string",
                        "enum": ["driving", "walking", "cycling"],
                        "description": "Travel mode (default 'driving')",
                        "default": "driving",
                    },
                },
                "required": ["origin_lng", "origin_lat", "dest_lng", "dest_lat"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "query_distribution_centers",
            "description": (
                "Query upcoming community food distribution events and centers. "
                "Returns event details including location, hours, capacity, "
                "and registration status. Can filter by date range and status."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "days_ahead": {
                        "type": "integer",
                        "description": "Number of days ahead to search (default 14)",
                        "default": 14,
                    },
                    "status": {
                        "type": "string",
                        "enum": ["scheduled", "in_progress", "completed", "cancelled"],
                        "description": "Filter by event status (default 'scheduled')",
                        "default": "scheduled",
                    },
                    "max_results": {
                        "type": "integer",
                        "description": "Maximum results to return (default 10)",
                        "default": 10,
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_user_dashboard",
            "description": (
                "Get a comprehensive user dashboard including profile data, "
                "dietary restrictions, favorite food categories, active listings, "
                "pending claims, upcoming reminders, and impact stats. "
                "Use this to personalize conversations."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "user_id": {
                        "type": "string",
                        "description": "The UUID of the user",
                    },
                },
                "required": ["user_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "check_pickup_schedule",
            "description": (
                "Check a user's upcoming reminders and scheduled pickups "
                "from the ai_reminders table. Returns pending reminders "
                "organized by type (pickup, listing_expiry, distribution_event, general)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "user_id": {
                        "type": "string",
                        "description": "The UUID of the user",
                    },
                    "include_sent": {
                        "type": "boolean",
                        "description": "Include already-sent reminders (default false)",
                        "default": False,
                    },
                    "days_ahead": {
                        "type": "integer",
                        "description": "Number of days to look ahead (default 14)",
                        "default": 14,
                    },
                },
                "required": ["user_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "suggest_recipes",
            "description": (
                "Suggest recipes based on available ingredients. "
                "Returns structured recipe data including name, ingredients, "
                "instructions, prep time, cook time, and servings. "
                "Use when a user asks for recipe ideas or what to cook."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "ingredients": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "List of available ingredients",
                    },
                    "dietary_restrictions": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Dietary restrictions (e.g. vegan, gluten-free, halal)",
                    },
                    "cuisine_preference": {
                        "type": "string",
                        "description": "Preferred cuisine type (e.g. Mexican, Italian, Asian)",
                    },
                    "max_results": {
                        "type": "integer",
                        "description": "Number of recipes to suggest (default 3)",
                        "default": 3,
                    },
                },
                "required": ["ingredients"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_storage_tips",
            "description": (
                "Get food storage tips and shelf life information for a specific food item. "
                "Returns storage method, shelf life for fridge/freezer/pantry, "
                "and signs of spoilage. Use when a user asks how to store food."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "food_item": {
                        "type": "string",
                        "description": "The food item to get storage tips for",
                    },
                },
                "required": ["food_item"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "find_community_resources",
            "description": (
                "Find community food resources near a location — food banks, "
                "pantries, SNAP/WIC offices, soup kitchens, and other food "
                "assistance programs. Use when a user needs food but nothing "
                "is available on the platform, or asks about food assistance."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "latitude": {
                        "type": "number",
                        "description": "User's latitude",
                    },
                    "longitude": {
                        "type": "number",
                        "description": "User's longitude",
                    },
                    "radius_km": {
                        "type": "number",
                        "description": "Search radius in km (default 15)",
                        "default": 15,
                    },
                    "resource_type": {
                        "type": "string",
                        "enum": [
                            "food_bank", "pantry", "soup_kitchen",
                            "snap_office", "wic_office", "all",
                        ],
                        "description": "Type of resource to search for (default 'all')",
                        "default": "all",
                    },
                    "max_results": {
                        "type": "integer",
                        "description": "Maximum results to return (default 10)",
                        "default": 10,
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "analyze_food_image",
            "description": (
                "Analyze a food image using AI vision. Can identify foods, "
                "suggest recipes from visible ingredients, assess freshness, "
                "read labels, or estimate quantities. Called automatically when "
                "the user sends an image."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "image_url": {
                        "type": "string",
                        "description": "Public URL of the food image to analyze",
                    },
                    "analysis_type": {
                        "type": "string",
                        "enum": ["identify", "recipe", "safety", "nutrition", "label"],
                        "description": "Type of analysis to perform (default 'identify')",
                        "default": "identify",
                    },
                    "user_question": {
                        "type": "string",
                        "description": "Optional specific question about the image",
                    },
                },
                "required": ["image_url"],
            },
        },
    },
    # ── New hunger-fighting tools ──────────────────────────
    {
        "type": "function",
        "function": {
            "name": "check_benefits_eligibility",
            "description": (
                "Check eligibility for government food assistance programs "
                "like SNAP (food stamps), WIC, school meals, TEFAP, CSFP, "
                "and Meals on Wheels. Provide household info to get a "
                "personalized eligibility estimate with application steps."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "household_size": {
                        "type": "integer",
                        "description": "Number of people in the household",
                    },
                    "monthly_income": {
                        "type": "number",
                        "description": "Gross monthly household income in USD",
                    },
                    "state": {
                        "type": "string",
                        "description": "US state abbreviation (e.g. 'CA', 'TX', 'NY')",
                    },
                    "has_children_under_5": {
                        "type": "boolean",
                        "description": "Whether household has children under 5 years old",
                    },
                    "has_school_age_children": {
                        "type": "boolean",
                        "description": "Whether household has children 5-18 in school",
                    },
                    "has_seniors_60_plus": {
                        "type": "boolean",
                        "description": "Whether household has members 60 or older",
                    },
                    "is_pregnant_or_postpartum": {
                        "type": "boolean",
                        "description": "Whether anyone in household is pregnant or postpartum (within 1 year)",
                    },
                },
                "required": ["household_size", "monthly_income"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_emergency_food_request",
            "description": (
                "Create an urgent food assistance request when someone needs "
                "food immediately. Marks the request as high-priority and "
                "alerts nearby donors. Use when someone says they have no food, "
                "are hungry, or need emergency help feeding their family."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "user_id": {
                        "type": "string",
                        "description": "The UUID of the user requesting help",
                    },
                    "urgency_level": {
                        "type": "string",
                        "enum": ["critical", "high", "moderate"],
                        "description": (
                            "critical = need food within 24 hours, "
                            "high = within 1-3 days, "
                            "moderate = within a week"
                        ),
                    },
                    "family_size": {
                        "type": "integer",
                        "description": "Number of people who need food",
                    },
                    "dietary_needs": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Dietary restrictions (e.g. halal, vegetarian, gluten-free, nut-free)",
                    },
                    "message": {
                        "type": "string",
                        "description": "Additional details about the situation",
                    },
                    "latitude": {
                        "type": "number",
                        "description": "User's latitude for matching nearby donors",
                    },
                    "longitude": {
                        "type": "number",
                        "description": "User's longitude for matching nearby donors",
                    },
                },
                "required": ["user_id", "urgency_level", "family_size"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "generate_meal_plan",
            "description": (
                "Generate a budget-friendly weekly meal plan based on available "
                "budget, family size, and dietary restrictions. Returns meals "
                "with estimated costs, grocery lists, and prep instructions. "
                "Optimized for families on limited budgets."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "budget_per_day": {
                        "type": "number",
                        "description": "Daily food budget in USD per person (e.g. 5.0)",
                    },
                    "family_size": {
                        "type": "integer",
                        "description": "Number of people to feed",
                    },
                    "days": {
                        "type": "integer",
                        "description": "Number of days to plan for (default 7)",
                        "default": 7,
                    },
                    "dietary_restrictions": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Dietary restrictions (vegan, halal, diabetic-friendly, etc.)",
                    },
                    "cooking_equipment": {
                        "type": "string",
                        "enum": ["full_kitchen", "microwave_only", "hot_plate", "no_kitchen"],
                        "description": "Available cooking equipment (default full_kitchen)",
                        "default": "full_kitchen",
                    },
                    "snap_eligible": {
                        "type": "boolean",
                        "description": "Whether the user receives SNAP benefits (affects shopping guidance)",
                    },
                },
                "required": ["budget_per_day", "family_size"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "analyze_nutrition",
            "description": (
                "Analyze the nutritional content of a meal or list of foods. "
                "Returns estimated calories, macronutrients, key micronutrients, "
                "and identifies potential nutritional gaps. Can suggest "
                "affordable foods to fill nutrient deficiencies."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "foods": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "List of foods/meals eaten (e.g. ['rice and beans', 'banana', 'milk'])",
                    },
                    "servings": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Optional serving sizes for each food (e.g. ['2 cups', '1 medium', '1 cup'])",
                    },
                    "identify_gaps": {
                        "type": "boolean",
                        "description": "Whether to identify nutritional gaps and suggest affordable foods to fill them",
                        "default": True,
                    },
                    "health_conditions": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Health conditions for personalized advice (diabetes, hypertension, anemia, etc.)",
                    },
                },
                "required": ["foods"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_food_preservation_guide",
            "description": (
                "Get detailed food preservation guidance including canning, "
                "freezing, dehydrating, and pickling instructions. Especially "
                "useful when someone receives a large food donation and needs "
                "to make it last. Includes batch cooking instructions."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "food_item": {
                        "type": "string",
                        "description": "The food item to preserve",
                    },
                    "quantity": {
                        "type": "string",
                        "description": "Amount of food (e.g. '10 lbs', '5 kg', 'a large bag')",
                    },
                    "available_equipment": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Equipment available (freezer, canning jars, dehydrator, vacuum sealer)",
                    },
                    "preservation_method": {
                        "type": "string",
                        "enum": ["freeze", "can", "dehydrate", "pickle", "ferment", "best_option"],
                        "description": "Preferred method or 'best_option' for AI recommendation",
                        "default": "best_option",
                    },
                },
                "required": ["food_item"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "find_child_senior_programs",
            "description": (
                "Find nutrition programs for children and seniors — school meal "
                "programs, summer feeding sites, after-school snacks, Meals on Wheels, "
                "senior congregate meals, Head Start, and CSFP. Can search by "
                "age group and location."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "age_group": {
                        "type": "string",
                        "enum": [
                            "infant_0_1", "toddler_1_3", "child_3_5",
                            "school_age_5_18", "senior_60_plus", "all",
                        ],
                        "description": "Age group to find programs for",
                    },
                    "latitude": {
                        "type": "number",
                        "description": "User's latitude for location-based results",
                    },
                    "longitude": {
                        "type": "number",
                        "description": "User's longitude for location-based results",
                    },
                    "include_summer_programs": {
                        "type": "boolean",
                        "description": "Include summer feeding programs (default true)",
                        "default": True,
                    },
                    "state": {
                        "type": "string",
                        "description": "US state abbreviation for state-specific programs",
                    },
                },
                "required": ["age_group"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "check_food_safety",
            "description": (
                "Check food safety for a specific food item. Provides guidance "
                "on whether food is still safe to eat, proper temperatures, "
                "signs of spoilage, allergen cross-contamination risks, and "
                "safe handling. Includes special guidance for vulnerable groups "
                "(pregnant, elderly, immunocompromised)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "food_item": {
                        "type": "string",
                        "description": "The food item to check safety for",
                    },
                    "concern": {
                        "type": "string",
                        "enum": ["expiry", "spoilage", "temperature", "allergens", "handling", "general"],
                        "description": "Specific safety concern (default general)",
                        "default": "general",
                    },
                    "days_since_opened": {
                        "type": "integer",
                        "description": "Number of days since the food was opened/prepared",
                    },
                    "storage_method": {
                        "type": "string",
                        "enum": ["fridge", "freezer", "pantry", "counter", "unknown"],
                        "description": "How the food was stored",
                    },
                    "vulnerable_consumer": {
                        "type": "boolean",
                        "description": "Whether food is for pregnant, elderly, or immunocompromised person",
                    },
                },
                "required": ["food_item"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "find_dietary_alternatives",
            "description": (
                "Find safe food alternatives for people with allergies, "
                "intolerances, religious dietary laws, or medical diets. "
                "Suggests affordable substitutes and DoGoods listings that "
                "match the user's dietary profile."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "original_food": {
                        "type": "string",
                        "description": "The food item to find alternatives for",
                    },
                    "restrictions": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Dietary restrictions (e.g. 'dairy-free', 'gluten-free', 'halal', 'kosher', 'low-sodium', 'renal-diet')",
                    },
                    "budget_conscious": {
                        "type": "boolean",
                        "description": "Whether to prioritize affordable alternatives (default true)",
                        "default": True,
                    },
                    "user_id": {
                        "type": "string",
                        "description": "User ID to search DoGoods listings for matching alternatives",
                    },
                },
                "required": ["original_food", "restrictions"],
            },
        },
    },
]


# ---------------------------------------------------------------------------
# Tool execution dispatcher
# ---------------------------------------------------------------------------

async def execute_tool(name: str, arguments: dict) -> dict:
    """Route a tool call to its handler and return the result."""
    handlers = {
        "search_food_near_user": _search_food_near_user,
        "get_user_profile": _get_user_profile,
        "get_pickup_schedule": _get_pickup_schedule,
        "create_reminder": _create_reminder,
        "get_mapbox_route": _get_mapbox_route,
        "query_distribution_centers": _query_distribution_centers,
        "get_user_dashboard": _get_user_dashboard,
        "check_pickup_schedule": _check_pickup_schedule,
        "suggest_recipes": _suggest_recipes,
        "get_storage_tips": _get_storage_tips,
        "find_community_resources": _find_community_resources,
        "analyze_food_image": _analyze_food_image,
        "check_benefits_eligibility": _check_benefits_eligibility,
        "create_emergency_food_request": _create_emergency_food_request,
        "generate_meal_plan": _generate_meal_plan,
        "analyze_nutrition": _analyze_nutrition,
        "get_food_preservation_guide": _get_food_preservation_guide,
        "find_child_senior_programs": _find_child_senior_programs,
        "check_food_safety": _check_food_safety,
        "find_dietary_alternatives": _find_dietary_alternatives,
    }

    handler = handlers.get(name)
    if handler is None:
        logger.warning("Unknown tool requested: %s", name)
        return {"error": f"Unknown tool: {name}"}

    try:
        return await handler(**arguments)
    except Exception as exc:
        logger.error("Tool %s failed: %s", name, exc)
        return {"error": f"Tool execution failed: {str(exc)}"}


# ---------------------------------------------------------------------------
# Haversine distance helper
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Tool implementations
# ---------------------------------------------------------------------------

async def _search_food_near_user(
    user_id: str,
    radius_km: float = 10,
    food_type: Optional[str] = None,
    max_results: int = 10,
) -> dict:
    """Search available food listings near the user's location.

    1. Fetch the user's location from the users table
    2. Query food_listings with status in [approved, active], not expired
    3. Filter by Haversine distance and optional food_type
    4. Format natural-language-friendly results
    """
    from backend.ai_engine import supabase_get

    logger.info(
        "search_food_near_user: user=%s radius=%skm type=%s",
        user_id, radius_km, food_type,
    )

    # --- 1. Get user location ---
    user_lat, user_lng = None, None
    try:
        user_rows = await supabase_get("users", {
            "id": f"eq.{user_id}",
            "select": "id,name,organization,location,created_at",
        })
        if user_rows:
            profile = user_rows[0]
            loc = profile.get("location")
            if isinstance(loc, dict):
                user_lat = loc.get("latitude")
                user_lng = loc.get("longitude")
            elif isinstance(loc, str):
                # location might be stored as text; try parsing
                try:
                    parsed = json.loads(loc)
                    user_lat = parsed.get("latitude")
                    user_lng = parsed.get("longitude")
                except (ValueError, TypeError):
                    pass
    except Exception as exc:
        logger.error("User lookup failed: %s", exc)

    # --- 2. Query food_listings ---
    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    params: dict = {
        "select": (
            "id,title,description,category,quantity,unit,"
            "latitude,longitude,full_address,donor_name,"
            "expiry_date,pickup_by,status,"
            "dietary_tags,allergens,created_at"
        ),
        "status": "in.(approved,active)",
        "expiry_date": f"gte.{today_str}",
        "order": "created_at.desc",
        "limit": "100",
    }
    if food_type:
        params["category"] = f"eq.{food_type}"

    try:
        listings = await supabase_get("food_listings", params)
    except Exception as exc:
        logger.error("Food listings fetch failed: %s", exc)
        return {"results": [], "total": 0, "error": f"Database query failed: {exc}"}

    # --- 3. Filter by distance ---
    results = []
    for listing in listings:
        lat = listing.get("latitude")
        lng = listing.get("longitude")

        if lat is not None and lng is not None and user_lat is not None and user_lng is not None:
            try:
                dist = _haversine(user_lat, user_lng, float(lat), float(lng))
            except (ValueError, TypeError):
                dist = None
        else:
            dist = None

        # Include listing if within radius, or if no location data available
        if dist is not None and dist > radius_km:
            continue

        result = {
            "id": listing.get("id"),
            "title": listing.get("title"),
            "description": listing.get("description", "")[:200],
            "category": listing.get("category"),
            "quantity": listing.get("quantity"),
            "unit": listing.get("unit"),
            "address": listing.get("full_address") or listing.get("location", ""),
            "donor_name": listing.get("donor_name"),
            "expiry_date": listing.get("expiry_date"),
            "pickup_by": listing.get("pickup_by"),
            "dietary_tags": listing.get("dietary_tags", []),
            "allergens": listing.get("allergens", []),
            "distance_km": round(dist, 1) if dist is not None else None,
            "latitude": lat,
            "longitude": lng,
        }
        results.append(result)

    # Sort by distance (nearest first), nulls last
    results.sort(key=lambda r: r["distance_km"] if r["distance_km"] is not None else 9999)
    results = results[:max_results]

    # --- 4. Format natural response summary ---
    if results:
        summary_parts = []
        for i, r in enumerate(results, 1):
            dist_str = f"{r['distance_km']} km away" if r["distance_km"] is not None else "distance unknown"
            summary_parts.append(
                f"{i}. **{r['title']}** ({r['category'] or 'uncategorized'}) — "
                f"{r['quantity']} {r['unit'] or 'items'}, {dist_str}. "
                f"Pickup: {r['address'] or 'contact donor'}."
            )
        summary = f"Found {len(results)} food item(s) near you:\n" + "\n".join(summary_parts)
    else:
        summary = (
            "No available food listings found within your area right now. "
            "Try expanding your search radius or check back later!"
        )

    return {
        "results": results,
        "total": len(results),
        "radius_km": radius_km,
        "user_location_available": user_lat is not None,
        "summary": summary,
    }


async def _get_user_profile(user_id: str) -> dict:
    """Retrieve user profile with activity summary."""
    from backend.ai_engine import supabase_get

    logger.info("get_user_profile: user=%s", user_id)
    try:
        rows = await supabase_get("users", {
            "id": f"eq.{user_id}",
            "select": (
                "id,name,email,phone,"
                "is_admin,avatar_url,role,account_type,organization,"
                "created_at"
            ),
        })
        if not rows:
            return {"user_id": user_id, "profile": None, "message": "User not found."}

        profile = rows[0]

        # Count listings and claims
        listings_count, claims_count = 0, 0
        try:
            listing_rows = await supabase_get("food_listings", {
                "user_id": f"eq.{user_id}",
                "select": "id",
            })
            listings_count = len(listing_rows)
        except Exception:
            pass
        try:
            claim_rows = await supabase_get("food_claims", {
                "claimer_id": f"eq.{user_id}",
                "select": "id",
            })
            claims_count = len(claim_rows)
        except Exception:
            pass

        return {
            "user_id": user_id,
            "profile": {
                "name": profile.get("name") or profile.get("email"),
                "email": profile.get("email"),
                "role": profile.get("role", "member"),
                "account_type": profile.get("account_type"),
                "organization": profile.get("organization"),
                "is_admin": profile.get("is_admin", False),
                "member_since": profile.get("created_at"),
            },
            "activity": {
                "listings_shared": listings_count,
                "food_claimed": claims_count,
            },
        }
    except Exception as exc:
        logger.error("Profile fetch failed: %s", exc)
        return {"user_id": user_id, "profile": None, "error": str(exc)}


async def _get_pickup_schedule(
    user_id: str,
    include_community_events: bool = True,
    days_ahead: int = 7,
) -> dict:
    """Get upcoming pickup and distribution schedules."""
    from backend.ai_engine import supabase_get

    logger.info(
        "get_pickup_schedule: user=%s events=%s days=%d",
        user_id, include_community_events, days_ahead,
    )

    now = datetime.now(timezone.utc)
    future = now + timedelta(days=days_ahead)

    # --- Pending pickups (user's claimed food) ---
    pickups = []
    try:
        claims = await supabase_get("food_claims", {
            "claimer_id": f"eq.{user_id}",
            "status": "in.(pending,approved)",
            "select": "id,food_id,status,pickup_date,notes,created_at",
            "order": "pickup_date.asc",
        })
        for claim in claims:
            # Fetch linked food listing summary
            food_title = "Food item"
            try:
                food_rows = await supabase_get("food_listings", {
                    "id": f"eq.{claim['food_id']}",
                    "select": "title,full_address,location",
                })
                if food_rows:
                    food_title = food_rows[0].get("title", food_title)
                    claim["address"] = (
                        food_rows[0].get("full_address")
                        or food_rows[0].get("location", "")
                    )
            except Exception:
                pass

            pickups.append({
                "claim_id": claim.get("id"),
                "food_title": food_title,
                "status": claim.get("status"),
                "pickup_date": claim.get("pickup_date"),
                "address": claim.get("address", ""),
                "notes": claim.get("notes"),
            })
    except Exception as exc:
        logger.error("Claims fetch failed: %s", exc)

    # --- Community distribution events ---
    events = []
    if include_community_events:
        try:
            today_str = now.strftime("%Y-%m-%d")
            future_str = future.strftime("%Y-%m-%d")
            event_rows = await supabase_get("distribution_events", {
                "event_date": f"gte.{today_str}",
                "status": "eq.scheduled",
                "select": (
                    "id,title,description,location,event_date,"
                    "start_time,end_time,capacity,registered_count"
                ),
                "order": "event_date.asc",
                "limit": "10",
            })
            for ev in event_rows:
                spots_left = (ev.get("capacity") or 0) - (ev.get("registered_count") or 0)
                events.append({
                    "event_id": ev.get("id"),
                    "title": ev.get("title"),
                    "description": (ev.get("description") or "")[:200],
                    "location": ev.get("location"),
                    "date": ev.get("event_date"),
                    "start_time": ev.get("start_time"),
                    "end_time": ev.get("end_time"),
                    "spots_available": max(spots_left, 0),
                })
        except Exception as exc:
            logger.error("Events fetch failed: %s", exc)

    return {
        "pickups": pickups,
        "events": events,
        "days_ahead": days_ahead,
    }


async def _create_reminder(
    user_id: str,
    message: str,
    trigger_time: str,
    reminder_type: str = "general",
    related_id: Optional[str] = None,
) -> dict:
    """Create a reminder in the ai_reminders table."""
    from backend.ai_engine import supabase_post

    logger.info(
        "create_reminder: user=%s type=%s time=%s",
        user_id, reminder_type, trigger_time,
    )

    # Validate trigger_time is in the future
    try:
        trigger_dt = datetime.fromisoformat(trigger_time.replace("Z", "+00:00"))
        if trigger_dt < datetime.now(timezone.utc):
            return {
                "created": False,
                "error": "Trigger time must be in the future.",
            }
    except (ValueError, TypeError):
        return {
            "created": False,
            "error": "Invalid trigger_time format. Use ISO 8601.",
        }

    data = {
        "user_id": user_id,
        "message": message,
        "trigger_time": trigger_time,
        "reminder_type": reminder_type,
        "sent": False,
    }
    if related_id:
        data["related_id"] = related_id

    try:
        rows = await supabase_post("ai_reminders", data)
        return {
            "created": True,
            "reminder_id": rows[0].get("id") if rows else None,
            "trigger_time": trigger_time,
            "message": f"Reminder set for {trigger_time}.",
        }
    except Exception as exc:
        logger.error("Reminder creation failed: %s", exc)
        return {"created": False, "error": str(exc)}


# ---------------------------------------------------------------------------
# NEW: get_mapbox_route — proxy Mapbox Directions API
# ---------------------------------------------------------------------------

async def _get_mapbox_route(
    origin_lng: float,
    origin_lat: float,
    dest_lng: float,
    dest_lat: float,
    profile: str = "driving",
) -> dict:
    """Proxy Mapbox Directions API and return a human-friendly summary.

    Returns step-by-step directions, total distance, and estimated travel time.
    """
    logger.info(
        "get_mapbox_route: (%s,%s)->(%s,%s) profile=%s",
        origin_lat, origin_lng, dest_lat, dest_lng, profile,
    )

    if not MAPBOX_TOKEN:
        return {
            "error": "Mapbox token not configured.",
            "fallback": (
                f"Straight-line distance: ~{_haversine(origin_lat, origin_lng, dest_lat, dest_lng):.1f} km. "
                "Configure VITE_MAPBOX_TOKEN for turn-by-turn directions."
            ),
        }

    # Validate profile
    if profile not in ("driving", "walking", "cycling"):
        profile = "driving"

    coords = f"{origin_lng},{origin_lat};{dest_lng},{dest_lat}"
    url = f"{MAPBOX_DIRECTIONS_URL}/{profile}/{coords}"

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(url, params={
                "access_token": MAPBOX_TOKEN,
                "geometries": "geojson",
                "overview": "simplified",
                "steps": "true",
                "language": "en",
            })
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPStatusError as exc:
        logger.error("Mapbox API error: %s", exc.response.text[:300])
        return {"error": f"Mapbox API error: HTTP {exc.response.status_code}"}
    except Exception as exc:
        logger.error("Mapbox request failed: %s", exc)
        return {"error": f"Mapbox request failed: {exc}"}

    routes = data.get("routes", [])
    if not routes:
        return {"error": "No route found between these locations."}

    route = routes[0]
    duration_sec = route.get("duration", 0)
    distance_m = route.get("distance", 0)

    # Build step-by-step directions
    steps = []
    legs = route.get("legs", [])
    for leg in legs:
        for step in leg.get("steps", []):
            maneuver = step.get("maneuver", {})
            instruction = maneuver.get("instruction", "")
            step_dist = step.get("distance", 0)
            step_dur = step.get("duration", 0)
            if instruction:
                steps.append({
                    "instruction": instruction,
                    "distance_m": round(step_dist),
                    "duration_sec": round(step_dur),
                })

    # Human-friendly summary
    dist_km = distance_m / 1000
    if duration_sec < 60:
        time_str = f"{int(duration_sec)} seconds"
    elif duration_sec < 3600:
        time_str = f"{int(duration_sec // 60)} minutes"
    else:
        hours = int(duration_sec // 3600)
        mins = int((duration_sec % 3600) // 60)
        time_str = f"{hours}h {mins}min"

    summary = (
        f"Route by {profile}: {dist_km:.1f} km, approximately {time_str}. "
        f"{len(steps)} navigation step(s)."
    )

    return {
        "profile": profile,
        "distance_km": round(dist_km, 2),
        "duration_minutes": round(duration_sec / 60, 1),
        "duration_text": time_str,
        "steps": steps[:20],  # cap to avoid huge payloads
        "summary": summary,
    }


# ---------------------------------------------------------------------------
# NEW: query_distribution_centers — community events + locations
# ---------------------------------------------------------------------------

async def _query_distribution_centers(
    days_ahead: int = 14,
    status: str = "scheduled",
    max_results: int = 10,
) -> dict:
    """Query upcoming distribution events from the distribution_events table.

    Returns event details: title, location, hours, capacity/availability.
    """
    from backend.ai_engine import supabase_get

    logger.info(
        "query_distribution_centers: days=%d status=%s max=%d",
        days_ahead, status, max_results,
    )

    now = datetime.now(timezone.utc)
    today_str = now.strftime("%Y-%m-%d")
    future_str = (now + timedelta(days=days_ahead)).strftime("%Y-%m-%d")

    try:
        rows = await supabase_get("distribution_events", {
            "event_date": f"gte.{today_str}",
            "status": f"eq.{status}",
            "select": (
                "id,title,description,location,event_date,"
                "start_time,end_time,capacity,registered_count,status"
            ),
            "order": "event_date.asc",
            "limit": str(max_results),
        })
    except Exception as exc:
        logger.error("Distribution events query failed: %s", exc)
        return {"centers": [], "total": 0, "error": str(exc)}

    centers = []
    for ev in rows:
        capacity = ev.get("capacity") or 0
        registered = ev.get("registered_count") or 0
        spots_left = max(capacity - registered, 0)

        hours_str = ""
        if ev.get("start_time") and ev.get("end_time"):
            hours_str = f"{ev['start_time']} - {ev['end_time']}"
        elif ev.get("start_time"):
            hours_str = f"Starts at {ev['start_time']}"

        centers.append({
            "event_id": ev.get("id"),
            "title": ev.get("title"),
            "description": (ev.get("description") or "")[:300],
            "location": ev.get("location"),
            "date": ev.get("event_date"),
            "hours": hours_str,
            "capacity": capacity,
            "registered": registered,
            "spots_available": spots_left,
            "status": ev.get("status"),
        })

    # Natural summary
    if centers:
        parts = []
        for i, c in enumerate(centers, 1):
            spots_info = (
                f"{c['spots_available']} spots left"
                if c["capacity"] > 0
                else "open capacity"
            )
            parts.append(
                f"{i}. **{c['title']}** — {c['date']}, {c['hours']}. "
                f"Location: {c['location'] or 'TBA'}. {spots_info}."
            )
        summary = (
            f"Found {len(centers)} upcoming distribution event(s):\n"
            + "\n".join(parts)
        )
    else:
        summary = (
            f"No {status} distribution events found in the next {days_ahead} days. "
            "Check back soon or contact your community organizer!"
        )

    return {
        "centers": centers,
        "total": len(centers),
        "days_searched": days_ahead,
        "summary": summary,
    }


# ---------------------------------------------------------------------------
# get_user_dashboard — comprehensive dashboard for personalization
# ---------------------------------------------------------------------------

async def _get_user_dashboard(user_id: str) -> dict:
    """Return a rich user dashboard: profile, restrictions, favorites,
    active listings, pending claims, upcoming reminders, and impact stats."""
    from backend.ai_engine import supabase_get

    logger.info("get_user_dashboard: user=%s", user_id)

    dashboard: dict = {
        "user_id": user_id,
        "profile": None,
        "dietary_restrictions": None,
        "favorites": [],
        "active_listings": [],
        "pending_claims": [],
        "upcoming_reminders": [],
        "impact_summary": {},
    }

    # --- Profile + dietary info ---
    try:
        rows = await supabase_get("users", {
            "id": f"eq.{user_id}",
            "select": (
                "id,name,email,phone,location,"
                "is_admin,role,account_type,organization,"
                "dietary_restrictions,sms_opt_in,sms_notifications_enabled,created_at"
            ),
        })
        if rows:
            p = rows[0]
            dashboard["profile"] = {
                "name": p.get("name") or p.get("email", ""),
                "email": p.get("email"),
                "phone": p.get("phone"),
                "location": p.get("location"),
                "role": p.get("role", "member"),
                "account_type": p.get("account_type"),
                "organization": p.get("organization"),
                "is_admin": p.get("is_admin", False),
                "sms_opt_in": p.get("sms_opt_in", False),
                "sms_notifications_enabled": p.get("sms_notifications_enabled", False),
                "member_since": p.get("created_at"),
            }
            dashboard["dietary_restrictions"] = p.get("dietary_restrictions")
    except Exception as exc:
        logger.error("Dashboard profile fetch failed: %s", exc)

    # --- Favorite categories (top categories from claimed food) ---
    try:
        claims = await supabase_get("food_claims", {
            "claimer_id": f"eq.{user_id}",
            "select": "food_id",
            "limit": "50",
        })
        if claims:
            food_ids = [c["food_id"] for c in claims if c.get("food_id")]
            category_counts: dict[str, int] = {}
            for fid in food_ids[:30]:  # limit lookups
                try:
                    food_rows = await supabase_get("food_listings", {
                        "id": f"eq.{fid}",
                        "select": "category",
                    })
                    if food_rows and food_rows[0].get("category"):
                        cat = food_rows[0]["category"]
                        category_counts[cat] = category_counts.get(cat, 0) + 1
                except Exception:
                    pass
            # Sort by frequency
            sorted_cats = sorted(category_counts.items(), key=lambda x: x[1], reverse=True)
            dashboard["favorites"] = [
                {"category": cat, "claim_count": cnt}
                for cat, cnt in sorted_cats[:5]
            ]
    except Exception as exc:
        logger.error("Dashboard favorites fetch failed: %s", exc)

    # --- Active listings (user's own) ---
    try:
        listings = await supabase_get("food_listings", {
            "user_id": f"eq.{user_id}",
            "status": "in.(approved,active,pending)",
            "select": "id,title,category,quantity,unit,status,expiry_date,created_at",
            "order": "created_at.desc",
            "limit": "10",
        })
        dashboard["active_listings"] = [
            {
                "id": l.get("id"),
                "title": l.get("title"),
                "category": l.get("category"),
                "quantity": l.get("quantity"),
                "unit": l.get("unit"),
                "status": l.get("status"),
                "expiry_date": l.get("expiry_date"),
            }
            for l in listings
        ]
    except Exception as exc:
        logger.error("Dashboard listings fetch failed: %s", exc)

    # --- Pending claims ---
    try:
        pending = await supabase_get("food_claims", {
            "claimer_id": f"eq.{user_id}",
            "status": "in.(pending,approved)",
            "select": "id,food_id,status,pickup_date,created_at",
            "order": "created_at.desc",
            "limit": "10",
        })
        for claim in pending:
            title = "Food item"
            try:
                food_rows = await supabase_get("food_listings", {
                    "id": f"eq.{claim['food_id']}",
                    "select": "title,full_address,location",
                })
                if food_rows:
                    title = food_rows[0].get("title", title)
                    claim["address"] = (
                        food_rows[0].get("full_address")
                        or food_rows[0].get("location", "")
                    )
            except Exception:
                pass
            dashboard["pending_claims"].append({
                "claim_id": claim.get("id"),
                "food_title": title,
                "status": claim.get("status"),
                "pickup_date": claim.get("pickup_date"),
                "address": claim.get("address", ""),
            })
    except Exception as exc:
        logger.error("Dashboard claims fetch failed: %s", exc)

    # --- Upcoming reminders ---
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        reminders = await supabase_get("ai_reminders", {
            "user_id": f"eq.{user_id}",
            "sent": "eq.false",
            "trigger_time": f"gte.{now_iso}",
            "select": "id,message,trigger_time,reminder_type,created_at",
            "order": "trigger_time.asc",
            "limit": "10",
        })
        dashboard["upcoming_reminders"] = [
            {
                "id": r.get("id"),
                "message": r.get("message"),
                "trigger_time": r.get("trigger_time"),
                "type": r.get("reminder_type"),
            }
            for r in reminders
        ]
    except Exception as exc:
        logger.error("Dashboard reminders fetch failed: %s", exc)

    # --- Impact summary ---
    try:
        # Count total completed shares
        completed_listings = await supabase_get("food_listings", {
            "user_id": f"eq.{user_id}",
            "status": "in.(completed,claimed)",
            "select": "id",
        })
        completed_claims = await supabase_get("food_claims", {
            "claimer_id": f"eq.{user_id}",
            "status": "eq.approved",
            "select": "id",
        })
        dashboard["impact_summary"] = {
            "food_shared_count": len(completed_listings),
            "food_received_count": len(completed_claims),
            "total_contributions": len(completed_listings) + len(completed_claims),
        }
    except Exception as exc:
        logger.error("Dashboard impact fetch failed: %s", exc)

    return dashboard


# ---------------------------------------------------------------------------
# check_pickup_schedule — reads ai_reminders + food_claims
# ---------------------------------------------------------------------------

async def _check_pickup_schedule(
    user_id: str,
    include_sent: bool = False,
    days_ahead: int = 14,
) -> dict:
    """Check user's reminders table and pending pickups, organized by type."""
    from backend.ai_engine import supabase_get

    logger.info(
        "check_pickup_schedule: user=%s include_sent=%s days=%d",
        user_id, include_sent, days_ahead,
    )

    now = datetime.now(timezone.utc)
    future = now + timedelta(days=days_ahead)
    now_iso = now.isoformat()
    future_iso = future.isoformat()

    # --- Reminders from ai_reminders table ---
    reminder_params: dict = {
        "user_id": f"eq.{user_id}",
        "trigger_time": f"lte.{future_iso}",
        "select": "id,message,trigger_time,reminder_type,sent,sent_at,related_id,created_at",
        "order": "trigger_time.asc",
        "limit": "50",
    }
    if not include_sent:
        reminder_params["sent"] = "eq.false"

    reminders_by_type: dict[str, list] = {
        "pickup": [],
        "listing_expiry": [],
        "distribution_event": [],
        "general": [],
    }

    try:
        reminders = await supabase_get("ai_reminders", reminder_params)
        for r in reminders:
            rtype = r.get("reminder_type", "general")
            if rtype not in reminders_by_type:
                rtype = "general"
            reminders_by_type[rtype].append({
                "id": r.get("id"),
                "message": r.get("message"),
                "trigger_time": r.get("trigger_time"),
                "sent": r.get("sent", False),
                "sent_at": r.get("sent_at"),
                "related_id": r.get("related_id"),
            })
    except Exception as exc:
        logger.error("Reminders fetch failed: %s", exc)

    # --- Pending pickups from food_claims ---
    pickups = []
    try:
        claims = await supabase_get("food_claims", {
            "claimer_id": f"eq.{user_id}",
            "status": "in.(pending,approved)",
            "select": "id,food_id,status,pickup_date,notes,created_at",
            "order": "pickup_date.asc",
            "limit": "20",
        })
        for claim in claims:
            food_info = {"title": "Food item", "address": ""}
            try:
                food_rows = await supabase_get("food_listings", {
                    "id": f"eq.{claim['food_id']}",
                    "select": "title,full_address,location,pickup_by,expiry_date",
                })
                if food_rows:
                    f = food_rows[0]
                    food_info = {
                        "title": f.get("title", "Food item"),
                        "address": f.get("full_address") or f.get("location", ""),
                        "pickup_by": f.get("pickup_by"),
                        "expiry_date": f.get("expiry_date"),
                    }
            except Exception:
                pass

            pickups.append({
                "claim_id": claim.get("id"),
                "food_title": food_info.get("title"),
                "status": claim.get("status"),
                "pickup_date": claim.get("pickup_date"),
                "pickup_by": food_info.get("pickup_by"),
                "address": food_info.get("address", ""),
                "expiry_date": food_info.get("expiry_date"),
                "notes": claim.get("notes"),
            })
    except Exception as exc:
        logger.error("Pickup claims fetch failed: %s", exc)

    # --- Summary ---
    total_pending = sum(len(v) for v in reminders_by_type.values())
    summary_parts = []
    if pickups:
        summary_parts.append(f"{len(pickups)} pending food pickup(s)")
    if reminders_by_type["pickup"]:
        summary_parts.append(f"{len(reminders_by_type['pickup'])} pickup reminder(s)")
    if reminders_by_type["distribution_event"]:
        summary_parts.append(
            f"{len(reminders_by_type['distribution_event'])} event reminder(s)"
        )
    if reminders_by_type["listing_expiry"]:
        summary_parts.append(
            f"{len(reminders_by_type['listing_expiry'])} listing expiry alert(s)"
        )
    if reminders_by_type["general"]:
        summary_parts.append(
            f"{len(reminders_by_type['general'])} general reminder(s)"
        )

    if summary_parts:
        summary = "Your upcoming schedule: " + ", ".join(summary_parts) + "."
    else:
        summary = "You have no pending pickups or reminders right now."

    return {
        "pickups": pickups,
        "reminders": reminders_by_type,
        "total_reminders": total_pending,
        "total_pickups": len(pickups),
        "days_ahead": days_ahead,
        "summary": summary,
    }


# ---------------------------------------------------------------------------
# suggest_recipes — AI-powered recipe suggestions
# ---------------------------------------------------------------------------

async def _suggest_recipes(
    ingredients: list[str],
    dietary_restrictions: list[str] | None = None,
    cuisine_preference: str | None = None,
    max_results: int = 3,
) -> dict:
    """Generate recipe suggestions using the backend AI."""
    from backend.ai_engine import legacy_ai_request, DEFAULT_MODEL, _extract_content

    logger.info(
        "suggest_recipes: ingredients=%s restrictions=%s cuisine=%s",
        ingredients, dietary_restrictions, cuisine_preference,
    )

    restrictions_str = ""
    if dietary_restrictions:
        restrictions_str = f" The recipes MUST be {', '.join(dietary_restrictions)}."
    cuisine_str = ""
    if cuisine_preference:
        cuisine_str = f" Prefer {cuisine_preference} cuisine."

    prompt = (
        f"Suggest {max_results} creative recipes using some or all of these "
        f"ingredients: {', '.join(ingredients)}.{restrictions_str}{cuisine_str} "
        "For each recipe provide: name, full ingredients list with quantities, "
        "step-by-step instructions, prep time, cook time, servings, and "
        "difficulty (Easy/Medium/Hard). "
        "Return valid JSON array of recipe objects."
    )

    try:
        data = await legacy_ai_request("/chat/completions", {
            "model": DEFAULT_MODEL,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You are a culinary expert for a community food sharing platform. "
                        "You suggest practical, nutritious recipes. Return ONLY a valid JSON "
                        "array of recipe objects with keys: name, ingredients (array), "
                        "instructions (string), prepTime, cookTime, servings, difficulty."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.8,
            "max_tokens": 2000,
        })
        content = _extract_content(data)

        # Try parsing JSON from the response
        recipes = content
        try:
            parsed = json.loads(content)
            if isinstance(parsed, list):
                recipes = parsed
            elif isinstance(parsed, dict) and "recipes" in parsed:
                recipes = parsed["recipes"]
        except (json.JSONDecodeError, TypeError):
            # Try extracting JSON array from markdown code blocks
            import re as _re
            match = _re.search(r"\[[\s\S]*\]", content)
            if match:
                try:
                    recipes = json.loads(match.group())
                except json.JSONDecodeError:
                    pass

        if isinstance(recipes, list):
            return {
                "recipes": recipes[:max_results],
                "total": len(recipes[:max_results]),
                "ingredients_used": ingredients,
                "summary": f"Here are {len(recipes[:max_results])} recipe(s) you can make!",
            }
        else:
            return {
                "recipes": [{"name": "Recipe Suggestion", "instructions": str(recipes)}],
                "total": 1,
                "ingredients_used": ingredients,
                "summary": content,
            }

    except Exception as exc:
        logger.error("Recipe generation failed: %s", exc)
        return {
            "recipes": [],
            "total": 0,
            "error": str(exc),
            "summary": "I couldn't generate recipes right now. Try asking me directly!",
        }


# ---------------------------------------------------------------------------
# get_storage_tips — food preservation advice
# ---------------------------------------------------------------------------

async def _get_storage_tips(food_item: str) -> dict:
    """Get storage and preservation tips for a food item."""
    from backend.ai_engine import legacy_ai_request, DEFAULT_MODEL, _extract_content

    logger.info("get_storage_tips: food=%s", food_item)

    try:
        data = await legacy_ai_request("/chat/completions", {
            "model": DEFAULT_MODEL,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You are a food preservation expert. Return ONLY valid JSON with keys: "
                        "food, storage_method, shelf_life (object with fridge, freezer, pantry durations), "
                        "tips (array of strings), signs_of_spoilage (array of strings), "
                        "safety_notes (string)."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Provide detailed storage tips for {food_item}. Include: "
                        "optimal temperature, container type, shelf life for "
                        "fridge/freezer/pantry, signs of spoilage, and safety notes."
                    ),
                },
            ],
            "temperature": 0.5,
            "max_tokens": 1000,
        })
        content = _extract_content(data)

        try:
            parsed = json.loads(content)
            return {"storage_info": parsed, "summary": content}
        except (json.JSONDecodeError, TypeError):
            return {
                "storage_info": {"food": food_item, "tips": [content]},
                "summary": content,
            }
    except Exception as exc:
        logger.error("Storage tips failed: %s", exc)
        return {
            "storage_info": {"food": food_item},
            "error": str(exc),
            "summary": f"I couldn't look up storage tips for {food_item} right now.",
        }


# ---------------------------------------------------------------------------
# find_community_resources — food banks, pantries, SNAP/WIC offices
# ---------------------------------------------------------------------------

async def _find_community_resources(
    latitude: float | None = None,
    longitude: float | None = None,
    radius_km: float = 15,
    resource_type: str = "all",
    max_results: int = 10,
) -> dict:
    """Query the community_resources table for nearby food assistance."""
    from backend.ai_engine import supabase_get

    logger.info(
        "find_community_resources: lat=%s lng=%s radius=%s type=%s",
        latitude, longitude, radius_km, resource_type,
    )

    params: dict = {
        "select": (
            "id,name,type,address,latitude,longitude,phone,hours_json,"
            "services,website,verified,last_updated"
        ),
        "verified": "eq.true",
        "order": "name.asc",
        "limit": str(max_results * 3),  # fetch extra for distance filtering
    }
    if resource_type and resource_type != "all":
        params["type"] = f"eq.{resource_type}"

    try:
        rows = await supabase_get("community_resources", params)
    except Exception as exc:
        logger.error("Community resources query failed: %s", exc)
        # Return helpful guidance even if DB query fails
        return {
            "resources": [],
            "total": 0,
            "guidance": (
                "I couldn't search our database right now, but here are resources "
                "you can try:\n"
                "- **211**: Call or text 211 for local food assistance\n"
                "- **Feeding America**: feedingamerica.org/find-your-local-foodbank\n"
                "- **SNAP**: fns.usda.gov/snap to check eligibility\n"
                "- **WIC**: fns.usda.gov/wic for mothers and children\n"
                "- **Google Maps**: Search 'food bank near me'"
            ),
            "summary": "Database unavailable, but I can share general food assistance resources.",
        }

    # Filter by distance if user location is available
    results = []
    for row in rows:
        r_lat = row.get("latitude")
        r_lng = row.get("longitude")

        dist = None
        if latitude and longitude and r_lat and r_lng:
            try:
                dist = _haversine(latitude, longitude, float(r_lat), float(r_lng))
            except (ValueError, TypeError):
                pass
            if dist is not None and dist > radius_km:
                continue

        results.append({
            "id": row.get("id"),
            "name": row.get("name"),
            "type": row.get("type"),
            "address": row.get("address"),
            "phone": row.get("phone"),
            "hours": row.get("hours_json"),
            "services": row.get("services"),
            "website": row.get("website"),
            "distance_km": round(dist, 1) if dist is not None else None,
        })

    # Sort by distance (nearest first)
    results.sort(key=lambda r: r["distance_km"] if r["distance_km"] is not None else 9999)
    results = results[:max_results]

    # Natural summary
    if results:
        parts = []
        for i, r in enumerate(results, 1):
            dist_str = f"{r['distance_km']} km away" if r['distance_km'] else "distance unknown"
            type_label = (r['type'] or 'resource').replace('_', ' ').title()
            parts.append(
                f"{i}. **{r['name']}** ({type_label}) — {r['address']}. "
                f"📞 {r['phone'] or 'N/A'}. {dist_str}."
            )
        summary = (
            f"Found {len(results)} community food resource(s) near you:\n"
            + "\n".join(parts)
        )
    else:
        summary = (
            "No community food resources found in our database for your area yet. "
            "Here are some ways to find help:\n"
            "- **211**: Call or text 211 for local food assistance\n"
            "- **Feeding America**: feedingamerica.org/find-your-local-foodbank\n"
            "- **SNAP benefits**: fns.usda.gov/snap\n"
            "- **WIC program**: fns.usda.gov/wic (for mothers and children)\n"
            "- Search 'food bank near me' on Google Maps"
        )

    return {
        "resources": results,
        "total": len(results),
        "radius_km": radius_km,
        "summary": summary,
    }


# ---------------------------------------------------------------------------
# check_benefits_eligibility — SNAP/WIC/TEFAP/CSFP eligibility calculator
# ---------------------------------------------------------------------------

# Federal Poverty Level monthly guidelines (2024-2025, 48 contiguous states)
# Source: https://aspe.hhs.gov/topics/poverty-economic-mobility/poverty-guidelines
_FPL_MONTHLY = {
    1: 1_255, 2: 1_705, 3: 2_155, 4: 2_605,
    5: 3_055, 6: 3_505, 7: 3_955, 8: 4_405,
}


def _get_fpl(household_size: int) -> int:
    """Get monthly FPL for household size (extra $450/month per additional member)."""
    if household_size <= 8:
        return _FPL_MONTHLY.get(household_size, 2_605)
    return _FPL_MONTHLY[8] + (household_size - 8) * 450


async def _check_benefits_eligibility(
    household_size: int,
    monthly_income: float,
    state: str | None = None,
    has_children_under_5: bool = False,
    has_school_age_children: bool = False,
    has_seniors_60_plus: bool = False,
    is_pregnant_or_postpartum: bool = False,
) -> dict:
    """Check eligibility for government food assistance programs."""
    logger.info(
        "check_benefits_eligibility: size=%d income=$%s state=%s",
        household_size, monthly_income, state,
    )

    fpl = _get_fpl(household_size)
    income_pct_fpl = (monthly_income / fpl * 100) if fpl > 0 else 999

    programs: list[dict] = []

    # SNAP — generally ≤130% FPL gross income (≤200% in some states with broad-based categorical eligibility)
    snap_eligible = income_pct_fpl <= 130
    snap_maybe = not snap_eligible and income_pct_fpl <= 200
    programs.append({
        "name": "SNAP (Food Stamps / EBT)",
        "eligible": "likely" if snap_eligible else ("possible" if snap_maybe else "unlikely"),
        "reason": (
            f"Your gross income is ~{income_pct_fpl:.0f}% of the Federal Poverty Level. "
            f"SNAP generally requires ≤130% FPL. "
            + ("Some states extend to ~200% FPL through expanded eligibility." if snap_maybe else "")
        ),
        "monthly_benefit_estimate": (
            f"~${max(23, int(234 * household_size * 0.85 - monthly_income * 0.3))}/month"
            if snap_eligible else "N/A"
        ),
        "how_to_apply": (
            f"Apply online at your state's SNAP portal"
            + (f" ({state}.gov)" if state else "")
            + " or call 1-800-221-5689. You can also apply at your local Department of Social Services."
        ),
        "website": "https://www.fns.usda.gov/snap/recipient/eligibility",
    })

    # WIC — pregnant/postpartum/breastfeeding women + children under 5, ≤185% FPL
    if has_children_under_5 or is_pregnant_or_postpartum:
        wic_eligible = income_pct_fpl <= 185
        programs.append({
            "name": "WIC (Women, Infants & Children)",
            "eligible": "likely" if wic_eligible else "unlikely",
            "reason": (
                f"WIC serves pregnant/postpartum women and children under 5 with income ≤185% FPL. "
                f"Your income is ~{income_pct_fpl:.0f}% FPL."
                + (" You automatically qualify if you receive SNAP, Medicaid, or TANF." if snap_eligible else "")
            ),
            "benefits": "Monthly food packages: milk, eggs, cheese, cereal, fruits/vegetables, whole grains, infant formula, baby food",
            "how_to_apply": "Find your nearest WIC clinic at https://www.fns.usda.gov/wic/wic-how-apply or call your state WIC office.",
            "website": "https://www.fns.usda.gov/wic",
        })

    # School Meals — children 5-18
    if has_school_age_children:
        free_meals = income_pct_fpl <= 130
        reduced_meals = not free_meals and income_pct_fpl <= 185
        programs.append({
            "name": "National School Lunch & Breakfast Program",
            "eligible": "likely" if (free_meals or reduced_meals) else "possible",
            "meal_type": "Free meals" if free_meals else ("Reduced-price meals ($0.30-$0.40)" if reduced_meals else "Full-price meals"),
            "reason": (
                f"Free meals: ≤130% FPL. Reduced-price: 130-185% FPL. "
                f"Your income is ~{income_pct_fpl:.0f}% FPL."
                + (" Children automatically qualify if family receives SNAP." if snap_eligible else "")
            ),
            "how_to_apply": "Contact your child's school. Many schools now offer community eligibility (free for all students).",
            "summer_meals": "When school is out, call 211 or text 'FOOD' to 304-304 to find free summer meal sites.",
            "website": "https://www.fns.usda.gov/cn",
        })

    # CSFP — seniors 60+
    if has_seniors_60_plus:
        csfp_eligible = income_pct_fpl <= 130
        programs.append({
            "name": "CSFP (Commodity Supplemental Food Program)",
            "eligible": "likely" if csfp_eligible else "unlikely",
            "reason": f"For seniors 60+ with income ≤130% FPL. Your income is ~{income_pct_fpl:.0f}% FPL.",
            "benefits": "Monthly food boxes: canned fruits/vegetables, juice, cereal, rice, pasta, cheese, peanut butter, dry milk",
            "how_to_apply": "Contact your local food bank or Area Agency on Aging to sign up.",
            "website": "https://www.fns.usda.gov/csfp",
        })
        programs.append({
            "name": "Meals on Wheels",
            "eligible": "likely",
            "reason": "Available to most adults 60+ regardless of income — contact your local program.",
            "benefits": "Hot meals delivered to your home, Monday-Friday. Some programs also provide weekend meals.",
            "how_to_apply": "Find your local Meals on Wheels at https://www.mealsonwheelsamerica.org/find-meals or call 1-888-998-6325.",
            "website": "https://www.mealsonwheelsamerica.org",
        })

    # TEFAP — always available through food banks
    programs.append({
        "name": "TEFAP (Emergency Food Assistance)",
        "eligible": "likely",
        "reason": "TEFAP is available through local food banks to individuals with low income. Few documentation requirements.",
        "benefits": "Free groceries distributed through local food banks and pantries",
        "how_to_apply": "Find your nearest food bank at https://www.feedingamerica.org/find-your-local-foodbank or call 211.",
        "website": "https://www.fns.usda.gov/tefap",
    })

    # National hotlines
    hotlines = [
        {"name": "National Hunger Hotline", "number": "1-866-3-HUNGRY (1-866-348-6479)", "hours": "Mon-Fri 7am-10pm ET"},
        {"name": "211 (United Way)", "number": "211", "hours": "24/7", "description": "Local food + social services referral"},
    ]

    return {
        "household_size": household_size,
        "monthly_income": monthly_income,
        "income_as_pct_fpl": round(income_pct_fpl, 1),
        "programs": programs,
        "hotlines": hotlines,
        "disclaimer": (
            "This is an estimate based on federal guidelines. Actual eligibility "
            "may vary by state. Apply to confirm — you can't be penalized for applying."
        ),
    }


# ---------------------------------------------------------------------------
# create_emergency_food_request — urgent food need
# ---------------------------------------------------------------------------

async def _create_emergency_food_request(
    user_id: str,
    urgency_level: str = "high",
    family_size: int = 1,
    dietary_needs: list[str] | None = None,
    message: str | None = None,
    latitude: float | None = None,
    longitude: float | None = None,
) -> dict:
    """Create an emergency food request and attempt to find immediate help."""
    from backend.ai_engine import supabase_post, supabase_get

    logger.info(
        "create_emergency_food_request: user=%s urgency=%s family=%d",
        user_id, urgency_level, family_size,
    )

    # Try to save to database (graceful if table doesn't exist)
    request_id = None
    try:
        import uuid
        request_id = str(uuid.uuid4())
        await supabase_post("emergency_food_requests", {
            "id": request_id,
            "user_id": user_id,
            "urgency_level": urgency_level,
            "family_size": family_size,
            "dietary_needs": dietary_needs or [],
            "message": message or "",
            "latitude": latitude,
            "longitude": longitude,
            "status": "pending",
        })
    except Exception as exc:
        logger.warning("Could not save emergency request to DB: %s", exc)
        request_id = "pending"

    # Search for immediately available food
    available_food = []
    try:
        today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        listings = await supabase_get("food_listings", {
            "select": "id,title,category,quantity,unit,full_address,latitude,longitude,pickup_by",
            "status": "in.(approved,active)",
            "expiry_date": f"gte.{today_str}",
            "order": "created_at.desc",
            "limit": "20",
        })
        for listing in listings:
            item = {
                "id": listing["id"],
                "title": listing.get("title", "Food item"),
                "category": listing.get("category", ""),
                "quantity": f"{listing.get('quantity', '')} {listing.get('unit', '')}".strip(),
                "address": listing.get("full_address", "Contact for location"),
                "pickup_by": listing.get("pickup_by", "Contact donor"),
            }
            if latitude and longitude and listing.get("latitude") and listing.get("longitude"):
                dist = _haversine(latitude, longitude, float(listing["latitude"]), float(listing["longitude"]))
                item["distance_km"] = round(dist, 1)
            available_food.append(item)

        # Sort by distance if available
        available_food.sort(key=lambda x: x.get("distance_km", 999))
        available_food = available_food[:5]
    except Exception as exc:
        logger.warning("Could not fetch available food: %s", exc)

    # Find upcoming distribution events
    events = []
    try:
        event_rows = await supabase_get("distribution_events", {
            "select": "id,title,event_date,location,address,status",
            "status": "eq.scheduled",
            "order": "event_date.asc",
            "limit": "3",
        })
        events = [
            {
                "title": e.get("title", "Distribution Event"),
                "date": e.get("event_date", ""),
                "location": e.get("address") or e.get("location", ""),
            }
            for e in event_rows
        ]
    except Exception:
        pass

    immediate_resources = [
        {
            "name": "National Hunger Hotline",
            "contact": "1-866-3-HUNGRY (1-866-348-6479)",
            "hours": "Mon-Fri 7am-10pm ET",
            "action": "Call now for immediate local food referrals",
        },
        {
            "name": "Dial 211",
            "contact": "211",
            "hours": "24/7",
            "action": "Free referral to local food pantries and emergency food",
        },
        {
            "name": "Feeding America Food Bank Locator",
            "contact": "feedingamerica.org/find-your-local-foodbank",
            "action": "Find the closest food bank — most don't require ID or proof of income",
        },
        {
            "name": "Text for Summer/School Meals",
            "contact": "Text 'FOOD' or 'COMIDA' to 304-304",
            "action": "Find free meal sites for children and teens near you",
        },
    ]

    return {
        "request_id": request_id,
        "status": "created",
        "urgency_level": urgency_level,
        "family_size": family_size,
        "available_food_nearby": available_food,
        "upcoming_events": events,
        "immediate_resources": immediate_resources,
        "message": (
            f"Your emergency food request has been logged. "
            f"{'There are ' + str(len(available_food)) + ' food items available near you right now. ' if available_food else ''}"
            f"If you need food immediately, please call 211 or the National Hunger Hotline at 1-866-348-6479."
        ),
    }


# ---------------------------------------------------------------------------
# generate_meal_plan — budget-friendly weekly meal planning
# ---------------------------------------------------------------------------

async def _generate_meal_plan(
    budget_per_day: float,
    family_size: int,
    days: int = 7,
    dietary_restrictions: list[str] | None = None,
    cooking_equipment: str = "full_kitchen",
    snap_eligible: bool | None = None,
) -> dict:
    """Generate a budget-friendly meal plan using AI."""
    from backend.ai_engine import legacy_ai_request, _extract_content

    logger.info(
        "generate_meal_plan: budget=$%s/day family=%d days=%d equip=%s",
        budget_per_day, family_size, days, cooking_equipment,
    )

    total_daily = budget_per_day * family_size
    restrictions_str = ", ".join(dietary_restrictions) if dietary_restrictions else "none"

    equipment_desc = {
        "full_kitchen": "full kitchen (stove, oven, microwave, fridge, freezer)",
        "microwave_only": "microwave only (no stove or oven)",
        "hot_plate": "hot plate and microwave (no oven)",
        "no_kitchen": "NO cooking equipment — only foods that can be eaten cold or at room temperature",
    }

    prompt = (
        f"Create a {days}-day meal plan for a family of {family_size} "
        f"with a budget of ${total_daily:.2f}/day total (${budget_per_day:.2f} per person per day). "
        f"Dietary restrictions: {restrictions_str}. "
        f"Available equipment: {equipment_desc.get(cooking_equipment, cooking_equipment)}. "
        f"{'The family receives SNAP benefits — include tips for maximizing EBT value (farmers markets, SNAP Match programs).' if snap_eligible else ''}\n\n"
        "Requirements:\n"
        "- Prioritize nutritious, filling meals that prevent hunger\n"
        "- Include breakfast, lunch, dinner for each day\n"
        "- Use overlapping ingredients to reduce waste\n"
        "- Include a consolidated grocery list with estimated costs\n"
        "- Suggest batch cooking opportunities\n"
        "- Note which items can be found at food banks for free\n\n"
        "Return valid JSON with this structure:\n"
        '{"meal_plan": [{"day": 1, "breakfast": "...", "lunch": "...", "dinner": "...", "snacks": "..."}], '
        '"grocery_list": [{"item": "...", "quantity": "...", "est_cost": "$X.XX", "food_bank_available": true/false}], '
        '"total_estimated_cost": "$XX.XX", '
        '"batch_cooking_tips": ["..."], '
        '"nutrition_highlights": "...", '
        '"snap_tips": ["..."]}'
    )

    payload = {
        "model": "deepseek-chat",
        "messages": [
            {"role": "system", "content": (
                "You are a nutrition expert and budget meal planner helping families "
                "experiencing food insecurity. Create practical, affordable, and nutritious "
                "meal plans. Always consider food that can be obtained free from food banks."
            )},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.7,
        "max_tokens": 2500,
    }

    try:
        data = await legacy_ai_request("/chat/completions", payload)
        content = _extract_content(data)

        # Try to parse JSON
        result = content
        try:
            result = json.loads(content)
        except (json.JSONDecodeError, TypeError):
            import re as _re
            match = _re.search(r"\{[\s\S]*\}", content)
            if match:
                try:
                    result = json.loads(match.group())
                except json.JSONDecodeError:
                    pass

        if isinstance(result, dict):
            result["budget_summary"] = {
                "per_person_per_day": f"${budget_per_day:.2f}",
                "total_daily": f"${total_daily:.2f}",
                "total_weekly": f"${total_daily * days:.2f}",
                "family_size": family_size,
            }
            return result
        else:
            return {"meal_plan_text": result, "budget_summary": {
                "per_person_per_day": f"${budget_per_day:.2f}",
                "total_daily": f"${total_daily:.2f}",
                "family_size": family_size,
            }}

    except Exception as exc:
        logger.error("Meal plan generation failed: %s", exc)
        return {
            "error": "Could not generate meal plan right now",
            "fallback_tips": [
                "Rice + beans = complete protein for ~$0.50/serving",
                "Eggs are one of the most affordable protein sources (~$0.25/egg)",
                "Frozen vegetables are as nutritious as fresh and much cheaper",
                "Buy whole chickens instead of parts — use bones for soup stock",
                "Oatmeal with peanut butter is a filling breakfast for ~$0.30",
                "Visit your local food bank — most require no ID or proof of income",
                "Check if your SNAP card works at farmers markets for fresh produce",
            ],
        }


# ---------------------------------------------------------------------------
# analyze_nutrition — meal nutrition analysis + gap identification
# ---------------------------------------------------------------------------

async def _analyze_nutrition(
    foods: list[str],
    servings: list[str] | None = None,
    identify_gaps: bool = True,
    health_conditions: list[str] | None = None,
) -> dict:
    """Analyze nutritional content and identify gaps."""
    from backend.ai_engine import legacy_ai_request, _extract_content

    logger.info("analyze_nutrition: foods=%s conditions=%s", foods[:5], health_conditions)

    foods_str = "\n".join(
        f"- {food}" + (f" ({servings[i]})" if servings and i < len(servings) else "")
        for i, food in enumerate(foods)
    )
    conditions_str = ", ".join(health_conditions) if health_conditions else "none"

    prompt = (
        f"Analyze the nutrition of these foods:\n{foods_str}\n\n"
        f"Health conditions to consider: {conditions_str}\n\n"
        "Provide:\n"
        "1. Estimated total calories, protein, carbs, fat, fiber\n"
        "2. Key micronutrients (iron, calcium, vitamin C, vitamin D, B12, zinc, folate)\n"
        "3. Nutritional gaps — what's missing or low\n"
        "4. Affordable foods to fill those gaps (under $2/serving)\n"
        f"{'5. Specific dietary guidance for: ' + conditions_str if health_conditions else ''}\n\n"
        "Return valid JSON:\n"
        '{"totals": {"calories": X, "protein_g": X, "carbs_g": X, "fat_g": X, "fiber_g": X}, '
        '"micronutrients": {"iron_mg": X, "calcium_mg": X, "vitamin_c_mg": X, "vitamin_d_iu": X, "b12_mcg": X, "zinc_mg": X, "folate_mcg": X}, '
        '"daily_needs_met": {"calories": "X%", "protein": "X%", "iron": "X%", "calcium": "X%"}, '
        '"gaps": [{"nutrient": "...", "status": "low/deficient", "affordable_sources": ["..."]}], '
        '"health_notes": ["..."], '
        '"overall_assessment": "..."}'
    )

    payload = {
        "model": "deepseek-chat",
        "messages": [
            {"role": "system", "content": (
                "You are a registered dietitian helping people with limited food "
                "budgets maximize their nutrition. Provide practical, affordable "
                "guidance. Prioritize foods available at food banks (canned beans, "
                "peanut butter, fortified cereal, canned fish, dry milk)."
            )},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.4,
        "max_tokens": 1500,
    }

    try:
        data = await legacy_ai_request("/chat/completions", payload)
        content = _extract_content(data)

        result = content
        try:
            result = json.loads(content)
        except (json.JSONDecodeError, TypeError):
            import re as _re
            match = _re.search(r"\{[\s\S]*\}", content)
            if match:
                try:
                    result = json.loads(match.group())
                except json.JSONDecodeError:
                    pass

        return result if isinstance(result, dict) else {"analysis_text": result}

    except Exception as exc:
        logger.error("Nutrition analysis failed: %s", exc)
        return {
            "error": "Could not analyze nutrition right now",
            "general_advice": (
                "A balanced diet should include: protein (beans, eggs, peanut butter), "
                "whole grains (rice, oats, bread), fruits and vegetables, dairy or "
                "calcium-fortified alternatives. If on a tight budget, canned and "
                "frozen options are equally nutritious."
            ),
        }


# ---------------------------------------------------------------------------
# get_food_preservation_guide — canning, freezing, dehydrating
# ---------------------------------------------------------------------------

async def _get_food_preservation_guide(
    food_item: str,
    quantity: str | None = None,
    available_equipment: list[str] | None = None,
    preservation_method: str = "best_option",
) -> dict:
    """Get detailed food preservation instructions."""
    from backend.ai_engine import legacy_ai_request, _extract_content

    logger.info("get_food_preservation_guide: item=%s method=%s", food_item, preservation_method)

    equip_str = ", ".join(available_equipment) if available_equipment else "standard kitchen (freezer, basic pots)"

    prompt = (
        f"Provide detailed food preservation instructions for: {food_item}"
        + (f" (quantity: {quantity})" if quantity else "")
        + f"\n\nAvailable equipment: {equip_str}"
        + f"\nPreferred method: {preservation_method}\n\n"
        "Include:\n"
        "1. Best preservation method(s) for this food\n"
        "2. Step-by-step instructions\n"
        "3. How long it will last with each method\n"
        "4. Tips for batch cooking or preparing in advance\n"
        "5. Common mistakes to avoid\n"
        "6. How to tell when preserved food has gone bad\n\n"
        "Return valid JSON:\n"
        '{"food": "...", "methods": [{'
        '"method": "freeze/can/dehydrate/pickle/ferment", '
        '"steps": ["..."], '
        '"shelf_life": "...", '
        '"equipment_needed": ["..."], '
        '"difficulty": "easy/medium/hard"'
        '}], '
        '"batch_cooking_ideas": ["..."], '
        '"safety_warnings": ["..."], '
        '"portions_estimate": "..."}'
    )

    payload = {
        "model": "deepseek-chat",
        "messages": [
            {"role": "system", "content": (
                "You are a food preservation expert helping people make the most "
                "of their food — especially bulk donations from food banks. "
                "Give clear, safe instructions a beginner can follow. "
                "Always include safety warnings about botulism for canning."
            )},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.5,
        "max_tokens": 1500,
    }

    try:
        data = await legacy_ai_request("/chat/completions", payload)
        content = _extract_content(data)

        result = content
        try:
            result = json.loads(content)
        except (json.JSONDecodeError, TypeError):
            import re as _re
            match = _re.search(r"\{[\s\S]*\}", content)
            if match:
                try:
                    result = json.loads(match.group())
                except json.JSONDecodeError:
                    pass

        return result if isinstance(result, dict) else {"guide_text": result}

    except Exception as exc:
        logger.error("Preservation guide failed: %s", exc)
        return {
            "error": "Could not generate preservation guide",
            "basic_tips": {
                "freezing": "Most foods freeze well for 3-6 months. Use airtight containers or freezer bags. Label with date.",
                "refrigerating": "Most cooked foods last 3-4 days in the fridge at 40°F (4°C) or below.",
                "canning": "Use pressure canning for low-acid foods (meats, vegetables). Water bath for high-acid (fruits, pickles, tomatoes).",
            },
        }


# ---------------------------------------------------------------------------
# find_child_senior_programs — age-specific nutrition programs
# ---------------------------------------------------------------------------

async def _find_child_senior_programs(
    age_group: str,
    latitude: float | None = None,
    longitude: float | None = None,
    include_summer_programs: bool = True,
    state: str | None = None,
) -> dict:
    """Find nutrition programs for children and seniors."""
    logger.info("find_child_senior_programs: age=%s state=%s", age_group, state)

    programs: list[dict] = []

    # Children's programs
    if age_group in ("infant_0_1", "toddler_1_3", "child_3_5", "all"):
        programs.append({
            "name": "WIC (Women, Infants & Children)",
            "age_range": "Pregnant/postpartum women + children 0-5",
            "benefits": "Monthly food vouchers for milk, eggs, cheese, cereal, fruits/vegetables, infant formula, baby food",
            "eligibility": "Income ≤185% Federal Poverty Level. Auto-qualifies if on Medicaid, SNAP, or TANF.",
            "how_to_apply": "Find your WIC clinic: https://www.fns.usda.gov/wic/wic-how-apply",
            "phone": "Contact your state WIC office",
        })
        programs.append({
            "name": "Head Start / Early Head Start",
            "age_range": "Children 0-5 from low-income families",
            "benefits": "Free preschool + meals + health screenings + family support",
            "eligibility": "Income ≤100% FPL, or homeless, or foster care, or receiving public assistance",
            "how_to_apply": "https://www.acf.hhs.gov/ohs/about/head-start or call 1-866-763-6481",
        })

    if age_group in ("child_3_5", "school_age_5_18", "all"):
        programs.append({
            "name": "National School Lunch & Breakfast Program",
            "age_range": "Children 5-18 in school",
            "benefits": "Free or reduced-price breakfast and lunch at school",
            "eligibility": "Free: ≤130% FPL. Reduced ($0.30-$0.40): 130-185% FPL. Auto-qualifies if on SNAP.",
            "how_to_apply": "Contact your child's school office. Many schools offer universal free meals.",
        })
        if include_summer_programs:
            programs.append({
                "name": "Summer Food Service Program (SFSP)",
                "age_range": "Children and teens 18 and under",
                "benefits": "Free meals at parks, community centers, schools, and churches during summer",
                "how_to_find": "Text 'FOOD' or 'COMIDA' to 304-304, or call 1-866-348-6479",
                "note": "No signup required — just show up! No ID or proof of income needed.",
            })
        programs.append({
            "name": "Afterschool Snack/Supper Programs",
            "age_range": "Children in afterschool programs",
            "benefits": "Free snacks and/or suppers at qualifying afterschool programs",
            "how_to_find": "Ask your child's school or local community center",
        })

    if age_group in ("school_age_5_18", "all"):
        programs.append({
            "name": "Backpack Programs (Feeding America)",
            "age_range": "School-age children",
            "benefits": "Discreet backpacks of food sent home with children on Fridays for the weekend",
            "how_to_find": "Contact your local Feeding America food bank: feedingamerica.org",
        })

    # Senior programs
    if age_group in ("senior_60_plus", "all"):
        programs.append({
            "name": "Meals on Wheels",
            "age_range": "Adults 60+",
            "benefits": "Hot meals delivered to your home, typically Monday-Friday. Some programs offer frozen weekend meals.",
            "eligibility": "Available to most adults 60+ regardless of income",
            "how_to_apply": "https://www.mealsonwheelsamerica.org/find-meals or call 1-888-998-6325",
        })
        programs.append({
            "name": "Congregate Meal Programs",
            "age_range": "Adults 60+",
            "benefits": "Free or low-cost meals at senior centers, churches, and community buildings. Also provides social connection.",
            "how_to_find": "Contact your local Area Agency on Aging: eldercare.acl.gov or call 1-800-677-1116",
        })
        programs.append({
            "name": "CSFP (Commodity Supplemental Food Program)",
            "age_range": "Seniors 60+",
            "benefits": "Monthly food box: canned fruits/vegetables, juice, cereal, rice, pasta, peanut butter, cheese, dry milk",
            "eligibility": "Income ≤130% Federal Poverty Level",
            "how_to_apply": "Contact your local food bank",
        })
        programs.append({
            "name": "Senior Farmers Market Nutrition Program (SFMNP)",
            "age_range": "Seniors 60+",
            "benefits": "Coupons for fresh fruits, vegetables, herbs, and honey at farmers markets",
            "eligibility": "Income ≤185% FPL",
            "how_to_apply": "https://www.fns.usda.gov/sfmnp",
        })

    # Universal programs
    programs.append({
        "name": "SNAP (Food Stamps / EBT)",
        "age_range": "All ages",
        "benefits": "Monthly EBT card for groceries at most stores",
        "eligibility": "Income ≤130% FPL (varies by state)",
        "how_to_apply": "https://www.fns.usda.gov/snap or call the USDA hotline at 1-800-221-5689",
    })

    return {
        "age_group": age_group,
        "programs": programs,
        "total_programs_found": len(programs),
        "emergency_contacts": [
            {"name": "National Hunger Hotline", "number": "1-866-348-6479", "hours": "Mon-Fri 7am-10pm ET"},
            {"name": "211 (food + social services)", "number": "211", "hours": "24/7"},
            {"name": "Summer meals text line", "number": "Text FOOD to 304-304"},
        ],
        "note": "Most programs do NOT require citizenship or immigration status. You will NOT be reported for applying.",
    }


# ---------------------------------------------------------------------------
# check_food_safety — comprehensive food safety advisor
# ---------------------------------------------------------------------------

async def _check_food_safety(
    food_item: str,
    concern: str = "general",
    days_since_opened: int | None = None,
    storage_method: str | None = None,
    vulnerable_consumer: bool = False,
) -> dict:
    """Provide food safety guidance."""
    from backend.ai_engine import legacy_ai_request, _extract_content

    logger.info("check_food_safety: item=%s concern=%s", food_item, concern)

    vulnerable_note = (
        " The consumer is in a vulnerable group (pregnant, elderly, or immunocompromised) — "
        "apply stricter safety standards."
        if vulnerable_consumer else ""
    )

    prompt = (
        f"Provide food safety guidance for: {food_item}\n"
        f"Concern: {concern}\n"
        + (f"Days since opened/prepared: {days_since_opened}\n" if days_since_opened is not None else "")
        + (f"Storage method: {storage_method}\n" if storage_method else "")
        + vulnerable_note
        + "\n\nInclude:\n"
        "1. Is this food safe to eat right now? (yes/caution/no)\n"
        "2. Safe temperature range\n"
        "3. Signs of spoilage to watch for\n"
        "4. Maximum safe storage time\n"
        "5. Allergen warnings (common allergens in this food)\n"
        "6. Safe handling instructions\n"
        f"{'7. Special precautions for vulnerable consumers' if vulnerable_consumer else ''}\n\n"
        "Return valid JSON:\n"
        '{"food": "...", "safety_verdict": "safe/caution/unsafe", '
        '"explanation": "...", '
        '"safe_temp_f": "...", "safe_temp_c": "...", '
        '"max_storage": {"fridge_days": X, "freezer_months": X, "pantry_days": X}, '
        '"spoilage_signs": ["..."], '
        '"common_allergens": ["..."], '
        '"handling_tips": ["..."], '
        '"vulnerable_group_notes": "..."}'
    )

    payload = {
        "model": "deepseek-chat",
        "messages": [
            {"role": "system", "content": (
                "You are a food safety expert. When in doubt, always err on the "
                "side of caution — if food might be unsafe, say so clearly. "
                "User safety is the absolute priority. Always include the disclaimer: "
                "'When in doubt, throw it out.'"
            )},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.3,
        "max_tokens": 1000,
    }

    try:
        data = await legacy_ai_request("/chat/completions", payload)
        content = _extract_content(data)

        result = content
        try:
            result = json.loads(content)
        except (json.JSONDecodeError, TypeError):
            import re as _re
            match = _re.search(r"\{[\s\S]*\}", content)
            if match:
                try:
                    result = json.loads(match.group())
                except json.JSONDecodeError:
                    pass

        return result if isinstance(result, dict) else {"safety_text": result}

    except Exception as exc:
        logger.error("Food safety check failed: %s", exc)
        return {
            "safety_verdict": "caution",
            "explanation": (
                f"I couldn't fully analyze {food_item} right now. "
                "General rule: When in doubt, throw it out. "
                "Perishables should be refrigerated within 2 hours. "
                "If it smells off, looks discolored, or has mold, do not eat it."
            ),
        }


# ---------------------------------------------------------------------------
# find_dietary_alternatives — allergen-safe + religion-compliant substitutes
# ---------------------------------------------------------------------------

async def _find_dietary_alternatives(
    original_food: str,
    restrictions: list[str],
    budget_conscious: bool = True,
    user_id: str | None = None,
) -> dict:
    """Find safe dietary alternatives."""
    from backend.ai_engine import legacy_ai_request, _extract_content, supabase_get

    logger.info("find_dietary_alternatives: food=%s restrictions=%s", original_food, restrictions)

    restrictions_str = ", ".join(restrictions)
    budget_note = "Prioritize affordable alternatives. Include estimated costs." if budget_conscious else ""

    prompt = (
        f"Find safe alternatives for: {original_food}\n"
        f"Dietary restrictions: {restrictions_str}\n"
        f"{budget_note}\n\n"
        "For each alternative provide:\n"
        "- Name and description\n"
        "- Why it's safe for these restrictions\n"
        "- How to use it as a substitute (ratio, preparation)\n"
        "- Approximate cost\n"
        "- Where to find it (regular grocery, specialty store, food bank)\n"
        "- Nutritional comparison to the original\n\n"
        "Return valid JSON:\n"
        '{"original": "...", "restrictions": ["..."], '
        '"alternatives": [{"name": "...", "safe_for": ["..."], "usage": "...", '
        '"cost_estimate": "...", "where_to_find": "...", '
        '"nutrition_note": "..."}], '
        '"safety_note": "..."}'
    )

    payload = {
        "model": "deepseek-chat",
        "messages": [
            {"role": "system", "content": (
                "You are a dietitian specializing in food allergies, religious "
                "dietary laws, and medical diets. Provide safe, practical, "
                "affordable alternatives. Always warn about cross-contamination risks."
            )},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.4,
        "max_tokens": 1200,
    }

    try:
        data = await legacy_ai_request("/chat/completions", payload)
        content = _extract_content(data)

        result = content
        try:
            result = json.loads(content)
        except (json.JSONDecodeError, TypeError):
            import re as _re
            match = _re.search(r"\{[\s\S]*\}", content)
            if match:
                try:
                    result = json.loads(match.group())
                except json.JSONDecodeError:
                    pass

        # Try to find matching DoGoods listings
        if user_id and isinstance(result, dict):
            try:
                listings = await supabase_get("food_listings", {
                    "select": "id,title,category,dietary_tags",
                    "status": "in.(approved,active)",
                    "limit": "10",
                })
                # Simple filter: exclude items that match restrictions
                safe_listings = []
                restricted_terms = set(r.lower() for r in restrictions)
                for listing in listings:
                    tags = listing.get("dietary_tags") or []
                    title_lower = (listing.get("title") or "").lower()
                    # Basic safety check
                    is_safe = True
                    for r in restricted_terms:
                        if r in title_lower:
                            is_safe = False
                    if is_safe:
                        safe_listings.append({
                            "id": listing["id"],
                            "title": listing.get("title"),
                            "category": listing.get("category"),
                            "dietary_tags": tags,
                        })
                if safe_listings:
                    result["dogoods_safe_listings"] = safe_listings[:5]
            except Exception:
                pass

        return result if isinstance(result, dict) else {"alternatives_text": result}

    except Exception as exc:
        logger.error("Dietary alternatives failed: %s", exc)
        return {
            "error": "Could not find alternatives right now",
            "general_substitutes": {
                "dairy-free": "Oat milk, soy milk, coconut yogurt, nutritional yeast (for cheese flavor)",
                "gluten-free": "Rice, corn tortillas, potatoes, oats (certified GF), quinoa",
                "nut-free": "Sunflower seed butter, soy butter, pumpkin seeds",
                "egg-free": "Flaxseed meal + water, mashed banana, applesauce (in baking)",
                "halal": "Look for halal-certified labels. Avoid gelatin, lard, alcohol-based extracts.",
                "kosher": "Look for OU, OK, or Star-K certification symbols.",
            },
        }


# ---------------------------------------------------------------------------
# analyze_food_image — GPT-4o vision analysis
# ---------------------------------------------------------------------------


def _get_vision_api_key() -> str:
    """Get the OpenAI API key for vision (only OpenAI supports vision)."""
    from backend.ai_engine import OPENAI_API_KEY
    return OPENAI_API_KEY


async def _analyze_food_image(
    image_url: str,
    analysis_type: str = "identify",
    user_question: str | None = None,
) -> dict:
    """Analyze a food image using GPT-4o vision capabilities."""

    logger.info("analyze_food_image: type=%s url=%s", analysis_type, image_url[:80])

    api_key = _get_vision_api_key()
    if not api_key:
        return {
            "error": "Vision API not configured",
            "summary": (
                "Image analysis requires an OpenAI API key (GPT-4o vision). "
                "Please set OPENAI_API_KEY in your .env.local file to enable this feature."
            ),
        }

    type_prompts = {
        "identify": (
            "Identify all food items visible in this image. "
            "For each item, provide: name, estimated quantity, category "
            "(protein/grain/vegetable/fruit/dairy/prepared/bakery), "
            "and whether it appears fresh. Return a JSON object with key 'items' "
            "containing an array."
        ),
        "recipe": (
            "Look at the food/ingredients in this image and suggest 2-3 recipes "
            "that can be made with them. For each recipe provide: name, "
            "which visible ingredients it uses, any additional ingredients "
            "needed, and brief instructions. Return JSON with key 'recipes'."
        ),
        "safety": (
            "Assess the food safety of items in this image. Look for: "
            "signs of spoilage, improper storage, temperature concerns, "
            "packaging integrity. Rate overall safety as: safe, caution, "
            "or unsafe. Provide specific observations. Return JSON with "
            "keys: 'overall_safety', 'observations' (array), 'recommendations' (array)."
        ),
        "nutrition": (
            "Estimate the nutritional content of the food shown. "
            "Identify each item and provide approximate: calories, protein, "
            "carbs, fat, and key vitamins/minerals. Return JSON with key 'items'."
        ),
        "label": (
            "Read and interpret any food labels, nutrition facts, ingredient "
            "lists, or expiry dates visible in this image. Highlight allergens "
            "and important nutritional information. Return JSON with key 'label_info'."
        ),
    }

    system_prompt = (
        "You are a food analysis expert for a community food sharing platform. "
        "Analyze the food image provided. Be practical and helpful. "
        "If food appears unsafe, clearly say so — user safety is the top priority. "
        "Always add a disclaimer: 'This is an AI estimate. When in doubt about food safety, discard the item.' "
        + type_prompts.get(analysis_type, type_prompts["identify"])
    )

    if user_question:
        system_prompt += f"\n\nThe user specifically asks: {user_question}"

    messages = [
        {"role": "system", "content": system_prompt},
        {
            "role": "user",
            "content": [
                {
                    "type": "image_url",
                    "image_url": {"url": image_url, "detail": "low"},
                },
                {
                    "type": "text",
                    "text": user_question or f"Please analyze this food image ({analysis_type}).",
                },
            ],
        },
    ]

    try:
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                "https://api.openai.com/v1/chat/completions",
                json={
                    "model": "gpt-4o",
                    "messages": messages,
                    "max_tokens": 1500,
                    "temperature": 0.3,
                },
                headers=headers,
            )
            resp.raise_for_status()
            data = resp.json()

        content = data["choices"][0]["message"]["content"]

        # Try to extract structured data
        analysis = content
        try:
            parsed = json.loads(content)
            analysis = parsed
        except (json.JSONDecodeError, TypeError):
            import re as _re
            match = _re.search(r"\{[\s\S]*\}", content)
            if match:
                try:
                    analysis = json.loads(match.group())
                except json.JSONDecodeError:
                    pass

        return {
            "analysis_type": analysis_type,
            "analysis": analysis if isinstance(analysis, dict) else {"raw": analysis},
            "summary": content if isinstance(content, str) else json.dumps(analysis),
        }

    except httpx.HTTPStatusError as exc:
        logger.error("Vision API HTTP error: %s", exc.response.status_code)
        return {"error": f"Vision API error: {exc.response.status_code}", "summary": "Image analysis failed."}
    except Exception as exc:
        logger.error("Vision analysis failed: %s", exc)
        return {"error": str(exc), "summary": "I couldn't analyze this image right now."}
