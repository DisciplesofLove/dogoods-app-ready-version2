import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuthContext } from '../AuthContext.jsx'
import aiChatService from '../services/aiChatService.js'

const INITIAL_MESSAGE = {
  id: 'welcome',
  role: 'assistant',
  message: "Hey there! 👋 I'm **Nouri**, your DoGoods assistant. I can help you find food, share surplus, get recipes, check your pickups, and explore your community impact. What would you like to do?",
  timestamp: new Date().toISOString(),
}

const INITIAL_MESSAGE_ES = {
  id: 'welcome',
  role: 'assistant',
  message: '¡Hola! 👋 Soy **Nouri**, tu asistente de DoGoods. Puedo ayudarte a encontrar comida, compartir excedentes, obtener recetas, verificar tus recogidas y explorar tu impacto comunitario. ¿En qué puedo ayudarte?',
  timestamp: new Date().toISOString(),
}

export function useAIChat() {
  const { user, isAuthenticated } = useAuthContext()
  
  // Load language from localStorage on init
  const [language, setLanguageState] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('nouri_language') || 'en'
    }
    return 'en'
  })

  // Set initial message based on loaded language
  const initialMsg = language === 'es' ? INITIAL_MESSAGE_ES : INITIAL_MESSAGE
  const [messages, setMessages] = useState([initialMsg])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [activeTools, setActiveTools] = useState([]) // tools currently being called
  const abortRef = useRef(null)

  // Wrapper for setLanguage that persists to localStorage
  const setLanguage = useCallback((lang) => {
    setLanguageState(lang)
    if (typeof window !== 'undefined') {
      localStorage.setItem('nouri_language', lang)
    }
  }, [])

  // Update welcome message when language changes
  useEffect(() => {
    setMessages(prev => {
      if (prev.length === 0) return prev
      const firstMsg = prev[0]
      if (firstMsg.id !== 'welcome') return prev
      const newWelcome = language === 'es' ? INITIAL_MESSAGE_ES : INITIAL_MESSAGE
      return [newWelcome, ...prev.slice(1)]
    })
  }, [language])

  // Load conversation history from backend when user logs in
  useEffect(() => {
    if (!isAuthenticated || !user?.id || historyLoaded) return

    let cancelled = false
    const loadHistory = async () => {
      try {
        const history = await aiChatService.getHistory(user.id, 50)
        if (cancelled || !history?.length) return

        const formatted = history.map(msg => ({
          id: msg.id || `hist-${msg.created_at}`,
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

  const sendMessage = useCallback(async (text) => {
    if (!text?.trim() || isLoading) return

    const userMsg = {
      id: `user-${Date.now()}`,
      role: 'user',
      message: text.trim(),
      timestamp: new Date().toISOString(),
    }

    const assistantId = `assistant-${Date.now()}`

    setMessages(prev => [...prev, userMsg])
    setIsLoading(true)
    setIsStreaming(true)
    setError(null)

    // Create a placeholder assistant message for streaming
    const placeholderMsg = {
      id: assistantId,
      role: 'assistant',
      message: '',
      timestamp: new Date().toISOString(),
      isStreaming: true,
    }
    setMessages(prev => [...prev, placeholderMsg])

    // Abort previous request if any
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const result = await aiChatService.streamMessage(text.trim(), {
        userId: user?.id || 'anonymous',
        onChunk: (_chunk, fullText) => {
          setMessages(prev =>
            prev.map(m => m.id === assistantId ? { ...m, message: fullText } : m)
          )
        },
        onToolCall: ({ name, status }) => {
          if (status === 'calling') {
            setActiveTools(prev => [...prev, name])
          } else if (status === 'done') {
            setActiveTools(prev => prev.filter(t => t !== name))
          }
        },
        signal: controller.signal,
      })

      // Update language from detection
      if (result.lang && result.lang !== language) {
        setLanguage(result.lang)
      }

      // Finalize the streaming message
      setMessages(prev =>
        prev.map(m => m.id === assistantId
          ? { ...m, message: result.response, isStreaming: false }
          : m
        )
      )
    } catch (err) {
      if (err.name === 'AbortError') return

      // Remove the empty placeholder and add error message
      setMessages(prev => {
        const filtered = prev.filter(m => m.id !== assistantId)
        return [...filtered, {
          id: `error-${Date.now()}`,
          role: 'assistant',
          message: language === 'es'
            ? 'Estoy teniendo un pequeño problema. ¿Puedes intentar de nuevo en un momento?'
            : "I'm having a little trouble right now. Please try again in a moment.",
          isError: true,
          timestamp: new Date().toISOString(),
        }]
      })
      setError(err.message)
    } finally {
      setIsLoading(false)
      setIsStreaming(false)
      setActiveTools([])
      abortRef.current = null
    }
  }, [isLoading, language, user?.id])

  const sendVoice = useCallback(async (audioBlob) => {
    if (isLoading || !audioBlob) return

    setIsLoading(true)
    setError(null)

    try {
      const result = await aiChatService.sendVoice(audioBlob, {
        userId: user?.id || 'anonymous',
        includeAudio: true,
      })

      if (result.lang && result.lang !== language) {
        setLanguage(result.lang)
      }

      // Show the transcript as the user message
      if (result.transcript) {
        setMessages(prev => [...prev, {
          id: `user-${Date.now()}`,
          role: 'user',
          message: result.transcript,
          timestamp: new Date().toISOString(),
        }])
      }

      const assistantMsg = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        message: result.response,
        audioUrl: result.audioUrl,
        timestamp: new Date().toISOString(),
      }

      setMessages(prev => [...prev, assistantMsg])
    } catch (err) {
      const errorMsg = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        message: language === 'es'
          ? 'No pude procesar tu audio. Por favor usa el campo de texto.'
          : "I couldn't process your voice message. Please try typing instead.",
        isError: true,
        timestamp: new Date().toISOString(),
      }

      setMessages(prev => [...prev, errorMsg])
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }, [isLoading, language, user?.id])

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
    sendVoice,
    isLoading,
    isStreaming,
    activeTools,
    error,
    language,
    setLanguage,
    clearHistory,
    submitFeedback,
    isAuthenticated,
  }
}
