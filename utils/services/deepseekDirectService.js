import { getApiConfig } from '../config.js'

/**
 * Direct DeepSeek/OpenAI chat service — works without the FastAPI backend.
 * Used as a fallback when /api/ai endpoints are unreachable.
 *
 * Supports streaming responses for real-time typewriter effect.
 */

const DOGOODS_SYSTEM_PROMPT = `You are **Nouri**, the DoGoods AI Assistant — a warm, helpful, and knowledgeable community food sharing assistant. You help users find food, share surplus food, learn about food safety, and connect with their local community.

## Your Personality
- Warm, encouraging, empathetic, and solution-oriented
- Celebrate every food share as a positive community action
- Use phrases like "Great question!", "Happy to help!", "That's wonderful!"
- Never make food-insecure users feel judged or embarrassed
- Use occasional emojis sparingly (🍎🥬🤝📍🕐🌱)

## Platform Knowledge
DoGoods connects people with surplus food to those who need it. The platform reduces food waste, fights hunger, and builds stronger communities.

### User Roles
- **Donors/Sharers**: List surplus food (homemade meals, groceries, garden produce, bakery items) with pickup times & locations
- **Recipients/Claimers**: Browse, search by location/type/dietary needs, claim items, arrange pickup
- **Community Organizers**: Create/manage distribution events, coordinate food drives
- **Admins**: Manage users, moderate content, handle compliance
- **Sponsors**: Organizations supporting through donations and funding

### Key Processes
- **Sharing**: Share Food page → fill food name, description, category, quantity, expiry, pickup location/time → publish
- **Finding**: Find Food page → browse/filter by type, distance, dietary needs → Claim → arrange pickup
- **Matching**: AI scores listings by proximity, urgency (expiry), nutrition, seasonal availability, donor trust
- **Events**: Organizers create distribution events with date, location, capacity → members RSVP
- **Impact**: Every share logs water saved, CO2 prevented, land preserved → visible on dashboards
- **Reminders**: AI can set reminders for pickups, listing expirations, and events

### Food Categories
Produce, Dairy, Bakery, Prepared Meals, Canned Goods, Proteins, Grains, Beverages, Other

### Food Safety (CRITICAL)
- Check expiry dates — never share past use-by date
- Perishables: refrigerated <4°C (40°F) or frozen
- Home-cooked: share within 2 hours or refrigerate
- Label all ingredients for allergies
- Raw meat/seafood/eggs: proper packaging + cold chain
- Canned goods: safe unless dented, bulging, or rusted
- When in doubt, err on side of caution

## Response Style
- Concise but thorough (2-4 short paragraphs max)
- **Bold** for emphasis and key terms
- Bullet points for lists
- When suggesting actions, be specific: "Go to the **Share Food** page to list your items"
- If you don't know specific user data, suggest checking the relevant page

## Available Features You Can Suggest
1. **Find Food** — Browse available listings nearby
2. **Share Food** — Post surplus food for the community
3. **Recipes** — Get recipe suggestions from available ingredients
4. **Storage Tips** — Learn how to store food properly
5. **Meal Planning** — Generate meal plans from ingredients
6. **Nutrition Info** — Get nutritional analysis of food items
7. **Donation Tips** — Best practices for safe food donation
8. **Impact Stats** — See environmental impact (water, CO2, land saved)
9. **Distribution Events** — Find community food sharing events
10. **Set Reminders** — Reminders for pickups, events, and expirations

## Important Rules
- Never make up specific food listings or user data
- Always encourage food safety
- Be encouraging about community participation
- If asked about non-food topics, gently redirect to food/community themes
- Support both English and Spanish`

// In-memory conversation history for the session (max 20 messages for context window)
const MAX_HISTORY = 20
let conversationHistory = []

function trimHistory() {
  if (conversationHistory.length > MAX_HISTORY) {
    conversationHistory = conversationHistory.slice(-MAX_HISTORY)
  }
}

/**
 * Send a chat message directly to DeepSeek API with streaming.
 *
 * @param {string} message - User message text
 * @param {object} options
 * @param {string} options.userId
 * @param {function} options.onChunk - Called with each text chunk as it streams in
 * @param {AbortSignal} options.signal - AbortController signal to cancel request
 * @returns {Promise<{response: string, lang: string}>}
 */
export async function streamChat(message, { userId, onChunk, signal } = {}) {
  const config = getApiConfig()
  const apiKey = config.OPENAI.API_KEY
  const endpoint = config.OPENAI.API_ENDPOINT + '/chat/completions'
  const model = config.OPENAI.MODELS?.CHAT || 'deepseek-chat'

  if (!apiKey || !apiKey.startsWith('sk-')) {
    throw new Error('AI API key not configured. Add VITE_DEEPSEEK_API_KEY to .env.local')
  }

  // Detect language
  const isSpanish = detectSpanish(message)
  const lang = isSpanish ? 'es' : 'en'

  // Build messages array
  const messages = [
    { role: 'system', content: DOGOODS_SYSTEM_PROMPT },
  ]

  if (isSpanish) {
    messages.push({
      role: 'system',
      content: 'The user is writing in Spanish. Respond entirely in Spanish. Use a warm, friendly tone. Use "tú" for casual contexts.',
    })
  }

  // Add conversation history
  for (const msg of conversationHistory) {
    messages.push({ role: msg.role, content: msg.content })
  }

  // Add the new user message
  messages.push({ role: 'user', content: message })

  // Store user message in history
  conversationHistory.push({ role: 'user', content: message })
  trimHistory()

  const body = {
    model,
    messages,
    temperature: 0.7,
    max_tokens: 1024,
    stream: true,
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(`DeepSeek API error ${response.status}: ${errorText.slice(0, 200)}`)
  }

  // Stream the response
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let fullText = ''
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    // Process SSE lines
    const lines = buffer.split('\n')
    buffer = lines.pop() || '' // Keep incomplete line in buffer

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data: ')) continue

      const data = trimmed.slice(6)
      if (data === '[DONE]') continue

      try {
        const parsed = JSON.parse(data)
        const delta = parsed.choices?.[0]?.delta?.content
        if (delta) {
          fullText += delta
          onChunk?.(delta, fullText)
        }
      } catch {
        // Skip malformed JSON chunks
      }
    }
  }

  // Store assistant response in history
  conversationHistory.push({ role: 'assistant', content: fullText })
  trimHistory()

  return { response: fullText, lang }
}

/**
 * Non-streaming fallback for direct chat.
 */
export async function directChat(message, { userId } = {}) {
  const config = getApiConfig()
  const apiKey = config.OPENAI.API_KEY
  const endpoint = config.OPENAI.API_ENDPOINT + '/chat/completions'
  const model = config.OPENAI.MODELS?.CHAT || 'deepseek-chat'

  if (!apiKey || !apiKey.startsWith('sk-')) {
    throw new Error('AI API key not configured')
  }

  const isSpanish = detectSpanish(message)
  const lang = isSpanish ? 'es' : 'en'

  const messages = [{ role: 'system', content: DOGOODS_SYSTEM_PROMPT }]

  if (isSpanish) {
    messages.push({
      role: 'system',
      content: 'Respond entirely in Spanish. Use a warm, friendly tone.',
    })
  }

  for (const msg of conversationHistory) {
    messages.push({ role: msg.role, content: msg.content })
  }
  messages.push({ role: 'user', content: message })
  conversationHistory.push({ role: 'user', content: message })
  trimHistory()

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.7,
      max_tokens: 1024,
    }),
  })

  if (!response.ok) {
    throw new Error(`DeepSeek API error: ${response.status}`)
  }

  const data = await response.json()
  const text = data.choices?.[0]?.message?.content || ''

  conversationHistory.push({ role: 'assistant', content: text })
  trimHistory()

  return { response: text, lang }
}

export function clearChatHistory() {
  conversationHistory = []
}

// Lightweight Spanish detection
const SPANISH_MARKERS = new Set([
  'hola', 'gracias', 'por', 'favor', 'ayuda', 'comida', 'buscar',
  'quiero', 'necesito', 'dónde', 'donde', 'cómo', 'como',
  'cuándo', 'cuando', 'tengo', 'puedo', 'buenos', 'buenas',
  'qué', 'que', 'disponible', 'recoger', 'compartir',
  'alimentos', 'comunidad', 'recordatorio',
])

function detectSpanish(text) {
  const words = text.toLowerCase().split(/\W+/)
  const hits = words.filter(w => SPANISH_MARKERS.has(w)).length
  const hasSpanishChars = /[¿¡ñáéíóúü]/.test(text)
  return hits >= 2 || (hits >= 1 && hasSpanishChars)
}
