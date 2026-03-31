import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuthContext } from '../AuthContext.jsx'
import aiChatService from '../services/aiChatService.js'

const INITIAL_MESSAGE = {
  id: 'welcome',
  role: 'assistant',
  message: "Hi! I'm Nouri, your DoGoods assistant. I can help you find food, share food, check your pickups, get recipes, set reminders, and more. How can I help you today?",
  timestamp: new Date().toISOString(),
}

const INITIAL_MESSAGE_ES = {
  id: 'welcome',
  role: 'assistant',
  message: '¡Hola! Soy Nouri, tu asistente de DoGoods. Puedo ayudarte a encontrar comida, compartir comida, verificar tus recogidas, obtener recetas, crear recordatorios y más. ¿En qué puedo ayudarte hoy?',
  timestamp: new Date().toISOString(),
}

/**
 * Detect if text is likely Spanish
 */
function detectLanguage(text) {
  const spanishWords = /\b(hola|comida|encontrar|ayuda|cerca|buscar|quiero|necesito|dónde|cómo|gracias|por favor|buenos días|buenas tardes)\b/i
  return spanishWords.test(text) ? 'es' : 'en'
}

export function useAIChat() {
  const { user, isAuthenticated } = useAuthContext()
  const [messages, setMessages] = useState([INITIAL_MESSAGE])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)
  const [language, setLanguage] = useState('en')
  const [userLocation, setUserLocation] = useState(null)
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const abortRef = useRef(null)

  // Load conversation history when user logs in
  useEffect(() => {
    if (!isAuthenticated || !user?.id || historyLoaded) return

    let cancelled = false
    const loadHistory = async () => {
      try {
        const history = await aiChatService.getHistory(user.id, 50)
        if (cancelled || !history?.length) return

        const formatted = history.map(msg => ({
          id: msg.id,
          role: msg.role,
          message: msg.message,
          metadata: msg.metadata,
          timestamp: msg.created_at,
        }))

        setMessages([INITIAL_MESSAGE, ...formatted])
        setHistoryLoaded(true)
      } catch (err) {
        console.error('Failed to load AI history:', err)
      }
    }

    loadHistory()
    return () => { cancelled = true }
  }, [isAuthenticated, user?.id, historyLoaded])

  // Try to get user location
  useEffect(() => {
    if (!navigator.geolocation) return

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLocation({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        })
      },
      () => { /* location denied — that's fine */ },
      { timeout: 10000, maximumAge: 300000 }
    )
  }, [])

  const sendMessage = useCallback(async (text) => {
    if (!text?.trim() || isLoading) return

    const userMsg = {
      id: `user-${Date.now()}`,
      role: 'user',
      message: text.trim(),
      timestamp: new Date().toISOString(),
    }

    // Detect language from user input
    const detectedLang = detectLanguage(text)
    if (detectedLang !== language) {
      setLanguage(detectedLang)
    }

    setMessages(prev => [...prev, userMsg])
    setIsLoading(true)
    setError(null)

    try {
      // Prepare conversation history for context
      const conversationHistory = messages
        .filter(m => m.id !== 'welcome')
        .slice(-20)

      const result = await aiChatService.sendMessage(text.trim(), {
        conversationHistory,
        userLocation,
      })

      const assistantMsg = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        message: result.response,
        toolResults: result.toolResults,
        suggestedActions: result.suggestedActions,
        timestamp: new Date().toISOString(),
      }

      setMessages(prev => [...prev, assistantMsg])
    } catch (err) {
      const errorMsg = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        message: language === 'es'
          ? 'Estoy teniendo un pequeño problema. ¿Puedes intentar de nuevo en un momento?'
          : "I'm having a little trouble right now. Please try again in a moment.",
        isError: true,
        timestamp: new Date().toISOString(),
      }

      setMessages(prev => [...prev, errorMsg])
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }, [isLoading, messages, language, userLocation])

  const clearHistory = useCallback(async () => {
    try {
      if (isAuthenticated && user?.id) {
        await aiChatService.clearHistory(user.id)
      }
      const welcome = language === 'es' ? INITIAL_MESSAGE_ES : INITIAL_MESSAGE
      setMessages([welcome])
      setHistoryLoaded(false)
      setError(null)
    } catch (err) {
      console.error('Failed to clear AI history:', err)
    }
  }, [isAuthenticated, user?.id, language])

  const submitFeedback = useCallback(async (messageId, rating) => {
    if (!isAuthenticated || !user?.id) return
    try {
      await aiChatService.submitFeedback(messageId, user.id, rating)
    } catch (err) {
      console.error('Failed to submit feedback:', err)
    }
  }, [isAuthenticated, user?.id])

  return {
    messages,
    sendMessage,
    isLoading,
    error,
    language,
    setLanguage,
    userLocation,
    clearHistory,
    submitFeedback,
    isAuthenticated,
  }
}
