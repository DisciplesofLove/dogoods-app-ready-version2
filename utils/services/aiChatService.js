import supabase from '../supabaseClient.js'
import { reportError } from '../helpers.js'
import dataService from '../dataService.js'

class AIChatService {
  constructor() {
    this._supabaseUrl = null
  }

  _getSupabaseUrl() {
    if (!this._supabaseUrl) {
      this._supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
    }
    return this._supabaseUrl
  }

  /**
   * Send a message to the AI chat Edge Function
   * @param {string} message - User's message text
   * @param {Object} options - { conversationHistory, userLocation }
   * @returns {Promise<{response: string, tool_results: Array, suggested_actions: Array}>}
   */
  async sendMessage(message, { conversationHistory = [], userLocation = null } = {}) {
    try {
      const { data: { session } } = await supabase.auth.getSession()

      const headers = {
        'Content-Type': 'application/json',
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY || '',
      }

      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`
      }

      const response = await fetch(
        `${this._getSupabaseUrl()}/functions/v1/ai-chat`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            message,
            conversation_history: conversationHistory.slice(-20),
            user_location: userLocation,
          }),
        }
      )

      const data = await response.json()

      if (!response.ok && !data.response) {
        throw new Error(data.error || `AI service error: ${response.status}`)
      }

      return {
        response: data.response,
        toolResults: data.tool_results || [],
        suggestedActions: data.suggested_actions || [],
        error: data.error || null,
      }
    } catch (error) {
      console.error('AI chat service error:', error)
      reportError(error)
      throw error
    }
  }

  /**
   * Load conversation history for a user
   */
  async getHistory(userId, limit = 50) {
    try {
      return await dataService.getAIConversations(userId, limit)
    } catch (error) {
      console.error('Get AI history error:', error)
      reportError(error)
      return []
    }
  }

  /**
   * Clear all conversation history for a user
   */
  async clearHistory(userId) {
    try {
      return await dataService.deleteAIConversations(userId)
    } catch (error) {
      console.error('Clear AI history error:', error)
      reportError(error)
      throw error
    }
  }

  /**
   * Submit feedback (thumbs up/down) on an AI message
   */
  async submitFeedback(conversationId, userId, rating, comment = null) {
    try {
      return await dataService.saveAIFeedback(conversationId, userId, rating, comment)
    } catch (error) {
      console.error('Submit AI feedback error:', error)
      reportError(error)
      throw error
    }
  }

  /**
   * Get user's active reminders
   */
  async getReminders(userId) {
    try {
      return await dataService.getAIReminders(userId)
    } catch (error) {
      console.error('Get AI reminders error:', error)
      reportError(error)
      return []
    }
  }
}

const aiChatService = new AIChatService()
export default aiChatService
