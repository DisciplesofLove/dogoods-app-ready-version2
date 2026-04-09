import { reportError } from '../helpers.js'
import { streamChat, directChat, clearChatHistory } from './deepseekDirectService.js'
import { API_CONFIG } from '../config.js'

/**
 * AI Chat Service — talks to the FastAPI backend at /api/ai/*
 * Falls back to direct DeepSeek API when backend is unreachable.
 *
 * The backend handles: system prompt, conversation history persistence,
 * tool calling (8 tools), language detection, TTS, and AI communication.
 * The frontend only sends user messages + user_id.
 */

// In production (Netlify), BACKEND_URL points to deployed backend (e.g. Railway)
// In development, empty string lets Vite proxy handle it
const API_BASE = `${API_CONFIG.BACKEND_URL || ''}/api/ai`
const REQUEST_TIMEOUT = 35000 // slightly above backend's 30s timeout

// Track backend availability to avoid repeated timeout delays
let _backendAvailable = null // null = not tested, true/false = tested
let _lastBackendCheck = 0
const BACKEND_CHECK_INTERVAL = 60000 // re-check every 60s

async function isBackendAvailable() {
  const now = Date.now()
  if (_backendAvailable !== null && now - _lastBackendCheck < BACKEND_CHECK_INTERVAL) {
    return _backendAvailable
  }
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2000)
    const resp = await fetch(`${API_BASE}/health`, { signal: controller.signal })
    clearTimeout(timeout)
    _backendAvailable = resp.ok
  } catch {
    _backendAvailable = false
  }
  _lastBackendCheck = now
  console.log(`[AI] Backend ${_backendAvailable ? '✅ available' : '❌ unavailable → using direct DeepSeek'}`)
  return _backendAvailable
}

class AIChatService {
  /**
   * Send a chat message — tries backend first, falls back to direct DeepSeek.
   *
   * @returns {{ response: string, lang: string, audioUrl: string|null }}
   */
  async sendMessage(message, { userId, includeAudio = false } = {}) {
    const backendUp = await isBackendAvailable()
    if (!backendUp) {
      return this._directFallback(message, { userId })
    }

    try {
      return await this._backendChat(message, { userId, includeAudio })
    } catch (error) {
      console.warn('Backend AI failed, falling back to direct DeepSeek:', error.message)
      _backendAvailable = false
      _lastBackendCheck = Date.now()
      return this._directFallback(message, { userId })
    }
  }

  /**
   * Stream a chat message — uses backend SSE streaming (with tool calling)
   * when available, falls back to direct DeepSeek streaming.
   *
   * Backend streaming gives: tool calling, conversation history persistence,
   * user profile context, system prompt from training data.
   *
   * @param {string} message
   * @param {object} options
   * @param {function} options.onChunk - called with (chunk, fullText) as tokens arrive
   * @param {function} [options.onToolCall] - called with ({name, status}) for tool call events
   * @param {AbortSignal} options.signal
   * @returns {Promise<{response: string, lang: string, tools: string[]}>}
   */
  async streamMessage(message, { userId, onChunk, onToolCall, signal } = {}) {
    const backendUp = await isBackendAvailable()

    if (backendUp) {
      try {
        return await this._backendStream(message, { userId, onChunk, onToolCall, signal })
      } catch (backendErr) {
        console.warn('Backend streaming failed, falling back to direct:', backendErr.message)
        _backendAvailable = false
        _lastBackendCheck = Date.now()
      }
    }

    // Fallback: direct DeepSeek streaming (no tool calling, no persistence)
    try {
      return await streamChat(message, { userId, onChunk, signal })
    } catch (streamError) {
      console.warn('Direct streaming failed:', streamError.message)
      // Last resort: backend non-streaming
      try {
        if (backendUp) {
          const result = await this._backendChat(message, { userId })
          onChunk?.(result.response, result.response)
          return result
        }
      } catch {}
      throw streamError
    }
  }

  /**
   * Stream from backend SSE endpoint — gets tool calling + streaming.
   * @private
   */
  async _backendStream(message, { userId, onChunk, onToolCall, signal } = {}) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT * 2) // longer for tool calls

    // Link external signal
    if (signal) {
      signal.addEventListener('abort', () => controller.abort())
    }

    try {
      const response = await fetch(`${API_BASE}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, message }),
        signal: controller.signal,
      })
      clearTimeout(timeout)

      if (!response.ok) {
        throw new Error(`Backend stream error: ${response.status}`)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let fullText = ''
      let lang = 'en'
      let tools = []
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('data: ')) continue

          const data = trimmed.slice(6)
          if (data === '[DONE]') continue

          try {
            const parsed = JSON.parse(data)

            switch (parsed.type) {
              case 'meta':
                lang = parsed.lang || 'en'
                break
              case 'tool':
                tools.push(parsed.name)
                onToolCall?.({ name: parsed.name, status: parsed.status })
                break
              case 'text':
                fullText += parsed.content
                onChunk?.(parsed.content, fullText)
                break
              case 'error':
                console.error('Backend stream error event:', parsed.message)
                break
            }
          } catch {
            // Skip malformed lines
          }
        }
      }

      return { response: fullText, lang, tools }
    } finally {
      clearTimeout(timeout)
    }
  }

  async _backendChat(message, { userId, includeAudio = false } = {}) {
    let lastError = null

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)

        const response = await fetch(`${API_BASE}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: userId,
            message,
            include_audio: includeAudio,
          }),
          signal: controller.signal,
        })
        clearTimeout(timeout)

        if (!response.ok) {
          const errorText = await response.text()
          console.error('AI backend error:', response.status, errorText)
          throw new Error(`AI service error: ${response.status}`)
        }

        const data = await response.json()

        return {
          response: data.text,
          lang: data.lang || 'en',
          audioUrl: data.audio_url || null,
          error: null,
        }
      } catch (err) {
        lastError = err
        if (err.name === 'AbortError' || err.message?.includes('Failed to fetch') || err.message?.includes('network')) {
          console.warn(`AI request attempt ${attempt + 1} failed, retrying...`)
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
          continue
        }
        throw err
      }
    }
    throw lastError
  }

  async _directFallback(message, { userId } = {}) {
    try {
      const result = await directChat(message, { userId })
      return {
        response: result.response,
        lang: result.lang || 'en',
        audioUrl: null,
        error: null,
      }
    } catch (error) {
      console.error('Direct DeepSeek fallback also failed:', error)
      reportError(error)
      throw error
    }
  }

  /**
   * Send voice audio to the FastAPI backend for transcription + chat response.
   */
  async sendVoice(audioBlob, { userId, includeAudio = true } = {}) {
    try {
      const formData = new FormData()
      formData.append('audio', audioBlob, 'audio.webm')
      formData.append('user_id', userId)
      formData.append('include_audio', includeAudio.toString())

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 60000)

      const response = await fetch(`${API_BASE}/voice`, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      })
      clearTimeout(timeout)

      if (!response.ok) {
        const errorText = await response.text()
        console.error('AI voice error:', response.status, errorText)
        throw new Error(`Voice service error: ${response.status}`)
      }

      const data = await response.json()

      return {
        response: data.text,
        transcript: data.transcript || '',
        lang: data.lang || 'en',
        audioUrl: data.audio_url || null,
        error: null,
      }
    } catch (error) {
      console.error('AI voice service error:', error)
      reportError(error)
      throw error
    }
  }

  /**
   * Load conversation history from the backend.
   */
  async getHistory(userId, limit = 50) {
    try {
      const response = await fetch(`${API_BASE}/history/${encodeURIComponent(userId)}?limit=${limit}`)
      if (!response.ok) {
        throw new Error(`History fetch failed: ${response.status}`)
      }
      const data = await response.json()
      return data.messages || []
    } catch (error) {
      console.error('Get AI history error:', error)
      reportError(error)
      return []
    }
  }

  /**
   * Clear conversation history.
   */
  async clearHistory(userId) {
    clearChatHistory()
    try {
      const response = await fetch(`${API_BASE}/history/${encodeURIComponent(userId)}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        throw new Error(`Clear history failed: ${response.status}`)
      }
    } catch (error) {
      console.warn('Backend clear history failed (non-critical):', error.message)
    }
  }

  /**
   * Submit feedback on an AI message.
   */
  async submitFeedback(conversationId, userId, rating, comment = null) {
    try {
      const response = await fetch(`${API_BASE}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: conversationId,
          user_id: userId,
          rating,
          comment,
        }),
      })
      if (!response.ok) {
        throw new Error(`Feedback submission failed: ${response.status}`)
      }
    } catch (error) {
      console.error('Submit AI feedback error:', error)
      reportError(error)
      throw error
    }
  }

  // ================================================================
  //  NEW FEATURE METHODS
  // ================================================================

  /**
   * Get AI-powered nutrition analysis for food items.
   * @param {string[]} foodItems
   * @returns {Promise<{analysis: string}>}
   */
  async getNutritionAnalysis(foodItems) {
    try {
      const response = await fetch(`${API_BASE}/nutrition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ food_items: foodItems }),
      })
      if (!response.ok) throw new Error(`Nutrition API error: ${response.status}`)
      return await response.json()
    } catch (error) {
      console.error('Nutrition analysis error:', error)
      reportError(error)
      throw error
    }
  }

  /**
   * Generate a full meal plan from available ingredients.
   * @param {string[]} ingredients
   * @param {number} servings
   * @param {string} dietary - e.g. "vegan", "gluten-free", "none"
   * @returns {Promise<{meal_plan: string}>}
   */
  async getMealPlan(ingredients, servings = 2, dietary = 'none') {
    try {
      const response = await fetch(`${API_BASE}/meal-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingredients, servings, dietary }),
      })
      if (!response.ok) throw new Error(`Meal plan API error: ${response.status}`)
      return await response.json()
    } catch (error) {
      console.error('Meal plan error:', error)
      reportError(error)
      throw error
    }
  }

  /**
   * Get AI donation tips and food safety guidelines.
   * @param {string} foodType
   * @param {string} quantity
   * @returns {Promise<{tips: string}>}
   */
  async getDonationTips(foodType, quantity = 'some') {
    try {
      const response = await fetch(`${API_BASE}/donation-tips`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ food_type: foodType, quantity }),
      })
      if (!response.ok) throw new Error(`Donation tips API error: ${response.status}`)
      return await response.json()
    } catch (error) {
      console.error('Donation tips error:', error)
      reportError(error)
      throw error
    }
  }

  /**
   * Get AI-generated community insights and analytics.
   * @returns {Promise<{insights: string, stats: object}>}
   */
  async getCommunityInsights() {
    try {
      const response = await fetch(`${API_BASE}/community-insights`)
      if (!response.ok) throw new Error(`Community insights API error: ${response.status}`)
      return await response.json()
    } catch (error) {
      console.error('Community insights error:', error)
      reportError(error)
      throw error
    }
  }

  /**
   * Get personalized AI suggestions for a user.
   * @param {string} userId
   * @returns {Promise<{suggestions: string, user_id: string}>}
   */
  async getSmartSuggestions(userId) {
    try {
      const response = await fetch(`${API_BASE}/suggestions/${encodeURIComponent(userId)}`)
      if (!response.ok) throw new Error(`Suggestions API error: ${response.status}`)
      return await response.json()
    } catch (error) {
      console.error('Smart suggestions error:', error)
      reportError(error)
      throw error
    }
  }

  /**
   * Get user's reminders.
   * @param {string} userId
   * @param {boolean} includeSent
   * @returns {Promise<object>}
   */
  async getReminders(userId, includeSent = false) {
    try {
      const params = new URLSearchParams({ include_sent: includeSent })
      const response = await fetch(`${API_BASE}/reminders/${encodeURIComponent(userId)}?${params}`)
      if (!response.ok) throw new Error(`Reminders API error: ${response.status}`)
      return await response.json()
    } catch (error) {
      console.error('Get reminders error:', error)
      reportError(error)
      throw error
    }
  }

  /**
   * Delete/cancel a specific reminder.
   * @param {string} reminderId
   * @returns {Promise<{deleted: boolean}>}
   */
  async deleteReminder(reminderId) {
    try {
      const response = await fetch(`${API_BASE}/reminders/${encodeURIComponent(reminderId)}`, {
        method: 'DELETE',
      })
      if (!response.ok) throw new Error(`Delete reminder error: ${response.status}`)
      return await response.json()
    } catch (error) {
      console.error('Delete reminder error:', error)
      reportError(error)
      throw error
    }
  }

  /**
   * Get AI feature recipes from available ingredients.
   * @param {string[]} ingredients
   * @returns {Promise<{recipes: string}>}
   */
  async getRecipes(ingredients) {
    try {
      const response = await fetch('/api/recipes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingredients }),
      })
      if (!response.ok) throw new Error(`Recipes API error: ${response.status}`)
      return await response.json()
    } catch (error) {
      console.error('Recipes error:', error)
      reportError(error)
      throw error
    }
  }

  /**
   * Get food storage tips.
   * @param {string} food
   * @returns {Promise<{tips: string}>}
   */
  async getStorageTips(food) {
    try {
      const response = await fetch('/api/storage-tips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ food }),
      })
      if (!response.ok) throw new Error(`Storage tips API error: ${response.status}`)
      return await response.json()
    } catch (error) {
      console.error('Storage tips error:', error)
      reportError(error)
      throw error
    }
  }

  /**
   * Get food pairing suggestions.
   * @param {string} food
   * @returns {Promise<{pairings: string}>}
   */
  async getFoodPairings(food) {
    try {
      const response = await fetch('/api/food-pairings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ food }),
      })
      if (!response.ok) throw new Error(`Food pairings API error: ${response.status}`)
      return await response.json()
    } catch (error) {
      console.error('Food pairings error:', error)
      reportError(error)
      throw error
    }
  }

  /**
   * Calculate environmental impact.
   * @param {string} foodType
   * @param {number} quantity
   * @param {string} unit
   * @returns {Promise<object>}
   */
  async calculateImpact(foodType, quantity, unit) {
    try {
      const response = await fetch('/api/impact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ food_type: foodType, quantity, unit }),
      })
      if (!response.ok) throw new Error(`Impact API error: ${response.status}`)
      return await response.json()
    } catch (error) {
      console.error('Impact calculation error:', error)
      reportError(error)
      throw error
    }
  }

  /**
   * Get AI usage stats (admin).
   * @returns {Promise<object>}
   */
  async getAIStats() {
    try {
      const response = await fetch(`${API_BASE}/stats`)
      if (!response.ok) throw new Error(`AI stats error: ${response.status}`)
      return await response.json()
    } catch (error) {
      console.error('AI stats error:', error)
      reportError(error)
      throw error
    }
  }

  // ---- Vision / Safety / Matching / Analytics ----------------------------

  /**
   * Analyze a food image using GPT-4o vision.
   * @param {string} imageBase64 - Base64-encoded image data
   * @returns {Promise<object>}
   */
  async analyzeFoodImage(imageBase64) {
    const response = await fetch(`${API_BASE}/analyze-food-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_base64: imageBase64 }),
    })
    if (!response.ok) throw new Error(`Image analysis error: ${response.status}`)
    return await response.json()
  }

  /**
   * Verify food listing safety before publishing.
   * @param {object} listing - { title, description, category, expiry, ingredients, image_url, allergens }
   * @returns {Promise<object>}
   */
  async verifyListing(listing) {
    const response = await fetch(`${API_BASE}/verify-listing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(listing),
    })
    if (!response.ok) throw new Error(`Verification error: ${response.status}`)
    return await response.json()
  }

  /**
   * AI-enhanced food matching with re-ranking.
   * @param {object} params - { user_id, food_request, location, radius_km, dietary, max_results }
   * @returns {Promise<object>}
   */
  async advancedMatch(params) {
    const response = await fetch(`${API_BASE}/match-advanced`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
    if (!response.ok) throw new Error(`Matching error: ${response.status}`)
    return await response.json()
  }

  /**
   * Record outcome of a food match for learning.
   * @param {object} outcome - { match_id, user_id, listing_id, score, outcome }
   * @returns {Promise<object>}
   */
  async recordMatchOutcome(outcome) {
    const response = await fetch(`${API_BASE}/match-outcome`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(outcome),
    })
    if (!response.ok) throw new Error(`Match outcome error: ${response.status}`)
    return await response.json()
  }

  /**
   * Get community analytics.
   * @returns {Promise<object>}
   */
  async getAnalyticsCommunity() {
    const response = await fetch(`${API_BASE}/analytics/community`)
    if (!response.ok) throw new Error(`Community analytics error: ${response.status}`)
    return await response.json()
  }

  /**
   * Get per-user analytics.
   * @param {string} userId
   * @returns {Promise<object>}
   */
  async getAnalyticsUser(userId) {
    const response = await fetch(`${API_BASE}/analytics/user/${userId}`)
    if (!response.ok) throw new Error(`User analytics error: ${response.status}`)
    return await response.json()
  }

  /**
   * Get food waste reduction analytics.
   * @returns {Promise<object>}
   */
  async getAnalyticsFoodWaste() {
    const response = await fetch(`${API_BASE}/analytics/food-waste`)
    if (!response.ok) throw new Error(`Waste analytics error: ${response.status}`)
    return await response.json()
  }

  /**
   * Get matching system analytics.
   * @returns {Promise<object>}
   */
  async getAnalyticsMatching() {
    const response = await fetch(`${API_BASE}/analytics/matching`)
    if (!response.ok) throw new Error(`Matching analytics error: ${response.status}`)
    return await response.json()
  }
}

const aiChatService = new AIChatService()
export default aiChatService
