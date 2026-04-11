import { reportError } from '../helpers.js'

/**
 * AI Chat Service — talks to the FastAPI backend at /api/ai/*
 *
 * The backend handles: system prompt, conversation history persistence,
 * tool calling, language detection, TTS, and OpenAI communication.
 * The frontend only sends user messages + user_id.
 */

const API_BASE = '/api/ai'
const REQUEST_TIMEOUT = 35000 // slightly above backend's 30s timeout

class AIChatService {
  /**
   * Send a chat message via the FastAPI backend.
   * Backend handles: GPT-4o, tools, history storage, language detection.
   *
   * @returns {{ response: string, lang: string, audioUrl: string|null, error: null }}
   */
  async sendMessage(message, { userId, includeAudio = false, latitude = null, longitude = null } = {}) {
    try {
      let lastError = null

      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const controller = new AbortController()
          const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)

          const payload = {
            user_id: userId,
            message,
            include_audio: includeAudio,
          }
          if (latitude != null && longitude != null) {
            payload.latitude = latitude
            payload.longitude = longitude
          }

          const response = await fetch(`${API_BASE}/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
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
    } catch (error) {
      console.error('AI chat service error:', error)
      reportError(error)
      throw error
    }
  }

  /**
   * Send voice audio to the FastAPI backend for transcription + chat response.
   *
   * @param {Blob} audioBlob - recorded audio
   * @param {string} userId
   * @param {boolean} includeAudio - return TTS audio in response
   * @returns {{ response: string, transcript: string, lang: string, audioUrl: string|null }}
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
   * Clear conversation history (not yet implemented in backend — stub).
   */
  async clearHistory(userId) {
    try {
      const response = await fetch(`${API_BASE}/history/${encodeURIComponent(userId)}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        throw new Error(`Clear history failed: ${response.status}`)
      }
    } catch (error) {
      console.error('Clear AI history error:', error)
      reportError(error)
      throw error
    }
  }

  /**
   * Submit feedback on an AI message (not yet implemented in backend — stub).
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

  /**
   * Send a food image for AI vision analysis.
   *
   * @param {string} imageDataUrl - base64 data URL (data:image/...) or https URL
   * @param {{ analysisType?: string, userQuestion?: string, userId?: string }} options
   * @returns {{ response: string, analysis: object, analysisType: string }}
   */
  async sendImage(imageDataUrl, { analysisType = 'identify', userQuestion = null, userId = null } = {}) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 45000)

      const response = await fetch(`${API_BASE}/vision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: imageDataUrl,
          analysis_type: analysisType,
          user_question: userQuestion,
          user_id: userId,
        }),
        signal: controller.signal,
      })
      clearTimeout(timeout)

      if (!response.ok) {
        const errorText = await response.text()
        console.error('AI vision error:', response.status, errorText)
        throw new Error(`Vision service error: ${response.status}`)
      }

      const data = await response.json()

      return {
        response: data.response,
        analysis: data.analysis || {},
        analysisType: data.analysis_type || analysisType,
        error: null,
      }
    } catch (error) {
      console.error('AI vision service error:', error)
      reportError(error)
      throw error
    }
  }
}

const aiChatService = new AIChatService()
export default aiChatService
