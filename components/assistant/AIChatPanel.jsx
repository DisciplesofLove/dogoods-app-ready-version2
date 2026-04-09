import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAIChat } from '../../utils/hooks/useAIChat.js'
import VoiceOutput from './VoiceOutput.jsx'
import { textToSpeech, playAudioBlob, transcribeAudio } from '../../utils/openaiVoice.js'

// ─── Quick action presets ─────────────────────────────
const QUICK_ACTIONS_EN = [
  { label: '🔍 Find food near me', message: 'What food is available near me right now?' },
  { label: '🍳 Recipe ideas', message: 'Suggest a creative recipe I can make with common surplus food' },
  { label: '📦 My pickups', message: 'What are my upcoming pickups and schedules?' },
  { label: '🤝 Share food', message: 'I have surplus food to share. How do I list it?' },
  { label: '🥗 Nutrition check', message: 'Analyze the nutrition of bananas, eggs, spinach, and rice' },
  { label: '📋 Meal planner', message: 'Create a meal plan using rice, beans, tomatoes, and onion for 4 people' },
  { label: '🌍 My impact', message: 'Show me my environmental and community impact stats' },
  { label: '📅 Events near me', message: 'What community distribution events are coming up?' },
  { label: '💡 Storage tips', message: 'Give me tips on how to store fresh produce to make it last longer' },
  { label: '🎁 Donation tips', message: 'I want to donate 10 loaves of bread. What should I know about food safety and packaging?' },
  { label: '❓ How it works', message: 'How does DoGoods work? Walk me through it step by step' },
]

const QUICK_ACTIONS_ES = [
  { label: '🔍 Buscar comida', message: '¿Qué comida hay disponible cerca de mí ahora?' },
  { label: '🍳 Ideas de recetas', message: 'Sugiere una receta creativa con alimentos excedentes comunes' },
  { label: '📦 Mis recogidas', message: '¿Cuáles son mis próximas recogidas y horarios?' },
  { label: '🤝 Compartir comida', message: 'Tengo comida excedente para compartir. ¿Cómo la publico?' },
  { label: '🥗 Nutrición', message: 'Analiza la nutrición de plátanos, huevos, espinacas y arroz' },
  { label: '📋 Plan de comidas', message: 'Crea un plan de comidas con arroz, frijoles, tomates y cebolla para 4 personas' },
  { label: '🌍 Mi impacto', message: 'Muéstrame mi impacto ambiental y comunitario' },
  { label: '📅 Eventos', message: '¿Qué eventos de distribución comunitaria hay próximamente?' },
  { label: '💡 Consejos', message: 'Dame consejos sobre cómo almacenar productos frescos para que duren más' },
  { label: '🎁 Donar comida', message: 'Quiero donar 10 barras de pan. ¿Qué debo saber sobre seguridad alimentaria y empaque?' },
  { label: '❓ Cómo funciona', message: '¿Cómo funciona DoGoods? Guíame paso a paso' },
]

// ─── Simple markdown renderer ─────────────────────────
function renderMarkdown(text) {
  if (!text) return null
  
  const lines = text.split('\n')
  const elements = []
  let listItems = []
  let listType = null // 'ul' or 'ol'
  
  const flushList = () => {
    if (listItems.length > 0) {
      const Tag = listType === 'ol' ? 'ol' : 'ul'
      const listClass = listType === 'ol'
        ? 'list-decimal list-inside space-y-0.5 my-1'
        : 'list-disc list-inside space-y-0.5 my-1'
      elements.push(
        <Tag key={`list-${elements.length}`} className={listClass}>
          {listItems.map((item, i) => <li key={i}>{formatInline(item)}</li>)}
        </Tag>
      )
      listItems = []
      listType = null
    }
  }
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    
    // Bullet list item
    const bulletMatch = line.match(/^[\s]*[-*•]\s+(.+)/)
    if (bulletMatch) {
      if (listType === 'ol') flushList()
      listType = 'ul'
      listItems.push(bulletMatch[1])
      continue
    }
    
    // Numbered list item
    const numMatch = line.match(/^[\s]*(\d+)[.)]\s+(.+)/)
    if (numMatch) {
      if (listType === 'ul') flushList()
      listType = 'ol'
      listItems.push(numMatch[2])
      continue
    }
    
    // Not a list item — flush any pending list
    flushList()
    
    // Empty line
    if (!line.trim()) {
      elements.push(<br key={`br-${i}`} />)
      continue
    }
    
    // Heading (## or ###)
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/)
    if (headingMatch) {
      const level = headingMatch[1].length
      const cls = level === 1 ? 'font-bold text-base mt-2 mb-1' :
                  level === 2 ? 'font-semibold text-sm mt-1.5 mb-0.5' :
                  'font-medium text-sm mt-1 mb-0.5'
      elements.push(<div key={`h-${i}`} className={cls}>{formatInline(headingMatch[2])}</div>)
      continue
    }
    
    // Regular paragraph
    elements.push(<p key={`p-${i}`} className="mb-0.5">{formatInline(line)}</p>)
  }
  
  flushList()
  return elements
}

function formatInline(text) {
  // Handle **bold**, *italic*, `code`, and emoji
  const parts = []
  let remaining = text
  let key = 0
  
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g
  let lastIndex = 0
  let match
  
  while ((match = regex.exec(remaining)) !== null) {
    // Text before the match
    if (match.index > lastIndex) {
      parts.push(remaining.slice(lastIndex, match.index))
    }
    
    if (match[2]) {
      // **bold**
      parts.push(<strong key={key++} className="font-semibold text-cyan-200">{match[2]}</strong>)
    } else if (match[3]) {
      // *italic*
      parts.push(<em key={key++} className="italic">{match[3]}</em>)
    } else if (match[4]) {
      // `code`
      parts.push(<code key={key++} className="bg-slate-600/50 px-1 py-0.5 rounded text-xs text-cyan-300 font-mono">{match[4]}</code>)
    }
    
    lastIndex = match.index + match[0].length
  }
  
  if (lastIndex < remaining.length) {
    parts.push(remaining.slice(lastIndex))
  }
  
  return parts.length > 0 ? parts : text
}

// ─── Typing indicator ─────────────────────────────────
function TypingIndicator() {
  return (
    <div className="flex items-center gap-2 px-4 py-3 animate-fadeIn">
      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center flex-shrink-0 shadow-md shadow-cyan-400/30">
        <span className="text-[10px]">✨</span>
      </div>
      <div className="flex items-center gap-1.5 bg-slate-700/50 backdrop-blur-sm rounded-2xl px-4 py-2.5 border border-cyan-500/20">
        <span className="w-2 h-2 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
        <span className="w-2 h-2 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
        <span className="w-2 h-2 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
      <span className="text-xs text-cyan-300/60 ml-1 animate-pulse">Nouri is thinking...</span>
    </div>
  )
}

// ─── Tool result card ──────────────────────────────────
function ToolResultCard({ toolResult }) {
  if (!toolResult) return null

  const { tool, result } = toolResult

  if (tool === 'search_food_nearby' && result?.listings?.length > 0) {
    return (
      <div className="mt-2 space-y-2">
        {result.listings.slice(0, 3).map(item => (
          <div key={item.id} className="bg-emerald-900/30 border border-emerald-500/30 rounded-lg p-3 text-sm backdrop-blur-sm">
            <div className="font-medium text-emerald-300">{item.title}</div>
            <div className="text-emerald-400/70 text-xs mt-1">
              📍 {item.distance_miles} mi · {item.category} · {item.pickup_by || 'Contact for pickup'}
            </div>
            {item.dietary_tags?.length > 0 && (
              <div className="flex gap-1 mt-1 flex-wrap">
                {item.dietary_tags.map(tag => (
                  <span key={tag} className="bg-emerald-500/20 text-emerald-300 text-xs px-1.5 py-0.5 rounded border border-emerald-500/20">{tag}</span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    )
  }

  if (tool === 'create_reminder' && result?.success) {
    return (
      <div className="mt-2 bg-blue-900/30 border border-blue-400/30 rounded-lg p-3 text-sm backdrop-blur-sm">
        <div className="text-blue-300">✅ Reminder set!</div>
      </div>
    )
  }

  if (tool === 'claim_food' && result?.success) {
    return (
      <div className="mt-2 bg-emerald-900/30 border border-emerald-500/30 rounded-lg p-3 text-sm backdrop-blur-sm">
        <div className="text-emerald-300">✅ {result.message}</div>
      </div>
    )
  }

  if (tool === 'create_food_listing' && result?.success) {
    return (
      <div className="mt-2 bg-emerald-900/30 border border-emerald-500/30 rounded-lg p-3 text-sm backdrop-blur-sm">
        <div className="text-emerald-300">✅ {result.message}</div>
      </div>
    )
  }

  return null
}

// ─── Message bubble ────────────────────────────────────
function MessageBubble({ msg, onFeedback, language }) {
  const [feedbackGiven, setFeedbackGiven] = useState(null)
  const isUser = msg.role === 'user'

  const handleFeedback = (rating) => {
    setFeedbackGiven(rating)
    onFeedback?.(msg.id, rating)
  }

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3 animate-fadeIn`}>
      <div className={`max-w-[85%] ${isUser ? '' : 'flex items-start gap-2'}`}>
        {/* Nouri avatar */}
        {!isUser && (
          <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center mt-1 shadow-md shadow-cyan-400/30 ring-2 ring-cyan-400/20">
            <svg viewBox="0 0 100 100" className="w-5 h-5">
              <circle cx="50" cy="52" r="36" fill="#f0f4f8" />
              <rect x="26" y="38" rx="12" ry="12" width="48" height="24" fill="#1e293b" opacity="0.85" />
              <path d="M35 53 Q38 46 41 53" stroke="#67e8f9" strokeWidth="4" strokeLinecap="round" fill="none" />
              <path d="M59 53 Q62 46 65 53" stroke="#67e8f9" strokeWidth="4" strokeLinecap="round" fill="none" />
            </svg>
          </div>
        )}

        <div>
          <div
            className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed transition-all duration-200 ${
              isUser
                ? 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white rounded-br-md shadow-md shadow-cyan-500/20'
                : msg.isError
                  ? 'bg-red-900/30 text-red-300 border border-red-500/30 rounded-bl-md backdrop-blur-sm'
                  : 'bg-slate-700/50 text-slate-100 rounded-bl-md border border-slate-600/30 backdrop-blur-sm'
            }`}
          >
            {isUser ? (
              <p className="whitespace-pre-wrap">{msg.message}</p>
            ) : (
              <div className="whitespace-pre-wrap">
                {renderMarkdown(msg.message)}
                {msg.isStreaming && (
                  <span className="inline-block w-2 h-4 bg-cyan-400 ml-0.5 animate-blink rounded-sm" />
                )}
              </div>
            )}
          </div>

          {/* Tool result cards */}
          {msg.toolResults?.map((tr, i) => (
            <ToolResultCard key={i} toolResult={tr} />
          ))}

          {/* Suggested actions */}
          {msg.suggestedActions?.length > 0 && !isUser && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {msg.suggestedActions.map((action, i) => (
                <SuggestedActionButton key={i} action={action} />
              ))}
            </div>
          )}

          {/* Feedback + TTS for assistant messages */}
          {!isUser && !msg.isError && msg.id !== 'welcome' && (
            <div className="flex items-center gap-2 mt-1">
              <VoiceOutput text={msg.message} language={language} />
              {!feedbackGiven && (
                <div className="flex gap-1 ml-1">
                  <button
                    onClick={() => handleFeedback('helpful')}
                    className="text-slate-500 hover:text-cyan-400 transition-colors"
                    title="Helpful"
                    aria-label="Mark as helpful"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M2 10.5a1.5 1.5 0 113 0v6a1.5 1.5 0 01-3 0v-6zM6 10.333v5.43a2 2 0 001.106 1.79l.05.025A4 4 0 008.943 18h5.416a2 2 0 001.962-1.608l1.2-6A2 2 0 0015.56 8H12V4a2 2 0 00-2-2 1 1 0 00-1 1v.667a4 4 0 01-.8 2.4L6.8 7.933a4 4 0 00-.8 2.4z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleFeedback('not_helpful')}
                    className="text-slate-500 hover:text-red-400 transition-colors"
                    title="Not helpful"
                    aria-label="Mark as not helpful"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 rotate-180" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M2 10.5a1.5 1.5 0 113 0v6a1.5 1.5 0 01-3 0v-6zM6 10.333v5.43a2 2 0 001.106 1.79l.05.025A4 4 0 008.943 18h5.416a2 2 0 001.962-1.608l1.2-6A2 2 0 0015.56 8H12V4a2 2 0 00-2-2 1 1 0 00-1 1v.667a4 4 0 01-.8 2.4L6.8 7.933a4 4 0 00-.8 2.4z" />
                    </svg>
                  </button>
                </div>
              )}
              {feedbackGiven && (
                <span className="text-xs text-cyan-400/60">
                  {feedbackGiven === 'helpful' ? '👍' : '👎'} Thanks
                </span>
              )}
            </div>
          )}

          {/* Timestamp */}
          <div className={`text-[10px] mt-0.5 ${isUser ? 'text-right text-cyan-300/40' : 'text-slate-500'}`}>
            {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Suggested action button ───────────────────────────
function SuggestedActionButton({ action }) {
  const navigate = useNavigate()

  const handleClick = () => {
    if (action.action === 'navigate' && action.target) {
      navigate(action.target)
    }
    // 'send' and 'retry' actions are handled by the parent via quick actions
  }

  if (action.action === 'navigate') {
    return (
      <button
        onClick={handleClick}
        className="text-xs bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 px-2.5 py-1 rounded-full transition-colors border border-blue-400/20"
      >
        {action.label}
      </button>
    )
  }

  return null
}

// ─── Main Chat Panel ───────────────────────────────────
function AIChatPanel() {
  const {
    messages,
    sendMessage,
    isLoading,
    isStreaming,
    activeTools,
    error,
    language,
    clearHistory,
    submitFeedback,
    isAuthenticated,
  } = useAIChat()

  const [isOpen, setIsOpen] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const [inputText, setInputText] = useState('')
  const [showMenu, setShowMenu] = useState(false)
  const [voiceMode, setVoiceMode] = useState(false)
  const [isVoiceListening, setIsVoiceListening] = useState(false)
  const [isVoiceSpeaking, setIsVoiceSpeaking] = useState(false)
  const [voiceError, setVoiceError] = useState(null)
  const [voiceTranscript, setVoiceTranscript] = useState('')
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)
  const panelRef = useRef(null)
  const currentAudioRef = useRef(null)
  const lastSpokenIdRef = useRef(null)
  const voiceModeRef = useRef(false)
  const sendMessageRef = useRef(sendMessage)
  const mediaStreamRef = useRef(null)
  const mediaRecorderRef = useRef(null)
  const audioChunksRef = useRef([])
  const analyserRef = useRef(null)
  const silenceTimerRef = useRef(null)
  const vadFrameRef = useRef(null)

  // Keep sendMessage ref current to avoid stale closures
  useEffect(() => { sendMessageRef.current = sendMessage }, [sendMessage])

  // Last assistant message for voice mode auto-speak
  const lastAssistantMessage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant' && !messages[i].isError) return messages[i]
    }
    return null
  }, [messages])

  const quickActions = language === 'es' ? QUICK_ACTIONS_ES : QUICK_ACTIONS_EN

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, isOpen, isLoading])

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 200)
    }
  }, [isOpen])

  // Close menu on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (showMenu && panelRef.current && !panelRef.current.contains(e.target)) {
        setShowMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showMenu])

  const handleSend = useCallback((e) => {
    e?.preventDefault()
    if (!inputText.trim() || isLoading) return
    sendMessage(inputText)
    setInputText('')
  }, [inputText, isLoading, sendMessage])

  const handleQuickAction = useCallback((msg) => {
    sendMessage(msg)
  }, [sendMessage])

  // ─── Voice recording via MediaRecorder + Whisper STT ───────
  const stopRecording = useCallback(() => {
    if (vadFrameRef.current) { cancelAnimationFrame(vadFrameRef.current); vadFrameRef.current = null }
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop()
    }
  }, [])

  const startVoiceListening = useCallback(async () => {
    setVoiceError(null)
    setVoiceTranscript('')
    audioChunksRef.current = []

    try {
      // Get mic stream (reuse existing or request new)
      if (!mediaStreamRef.current || !mediaStreamRef.current.active) {
        mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true })
      }
      const stream = mediaStreamRef.current

      // Set up audio analyser for VAD (voice activity detection)
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)()
      const source = audioCtx.createMediaStreamSource(stream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 512
      analyser.smoothingTimeConstant = 0.3
      source.connect(analyser)
      analyserRef.current = analyser

      // Start MediaRecorder
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : ''
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream)

      audioChunksRef.current = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }

      recorder.onstop = async () => {
        // Clean up analyser
        if (vadFrameRef.current) { cancelAnimationFrame(vadFrameRef.current); vadFrameRef.current = null }
        source.disconnect()
        audioCtx.close().catch(() => {})

        const chunks = audioChunksRef.current
        if (!chunks.length) { setIsVoiceListening(false); return }

        const audioBlob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
        // Skip tiny recordings (< 0.5s of data, ~noise)
        if (audioBlob.size < 5000) {
          setIsVoiceListening(false)
          return
        }

        setIsVoiceListening(false)
        setVoiceTranscript(language === 'es' ? 'Transcribiendo...' : 'Transcribing...')

        try {
          const text = await transcribeAudio(audioBlob, language)
          const trimmed = text?.trim() || ''
          // Filter out noise: too short, or common Whisper hallucinations on silence/noise
          const NOISE_PHRASES = ['thank you', 'thanks', 'bye', 'you', 'the', 'i', 'a', 'um', 'uh',
            'thank you for watching', 'thanks for watching', 'subscribe', 'like and subscribe',
            'music', '...', '…', 'foreign', 'applause', 'laughter']
          const isNoise = trimmed.length < 3 || NOISE_PHRASES.includes(trimmed.toLowerCase())
          if (trimmed && !isNoise) {
            setVoiceTranscript(trimmed)
            sendMessageRef.current(trimmed)
          } else {
            console.log('[Voice] Filtered noise transcription:', trimmed)
            setVoiceTranscript('')
          }
        } catch (err) {
          console.error('[Voice] Whisper transcription failed:', err)
          setVoiceError(language === 'es' ? 'Error de transcripción' : 'Transcription failed')
          setVoiceTranscript('')
        }
      }

      recorder.start(250) // collect data every 250ms
      mediaRecorderRef.current = recorder
      setIsVoiceListening(true)

      // Voice Activity Detection — stop recording after silence
      let speechDetected = false
      let silenceStart = 0
      const SILENCE_THRESHOLD = 15  // RMS level below which = silence
      const SILENCE_DURATION = 1800 // ms of silence before auto-stop
      const MAX_DURATION = 30000    // max recording duration
      const dataArray = new Uint8Array(analyser.frequencyBinCount)
      const startTime = Date.now()

      const checkAudio = () => {
        if (!mediaRecorderRef.current || mediaRecorderRef.current.state !== 'recording') return

        // Auto-stop at max duration
        if (Date.now() - startTime > MAX_DURATION) {
          stopRecording()
          return
        }

        analyser.getByteFrequencyData(dataArray)
        let sum = 0
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i]
        const avg = sum / dataArray.length

        if (avg > SILENCE_THRESHOLD) {
          speechDetected = true
          silenceStart = 0
        } else if (speechDetected) {
          if (!silenceStart) silenceStart = Date.now()
          if (Date.now() - silenceStart > SILENCE_DURATION) {
            stopRecording()
            return
          }
        }

        vadFrameRef.current = requestAnimationFrame(checkAudio)
      }
      vadFrameRef.current = requestAnimationFrame(checkAudio)

    } catch (err) {
      console.error('[Voice] Mic access failed:', err)
      setIsVoiceListening(false)
      setVoiceError(
        err.name === 'NotAllowedError'
          ? (language === 'es' ? 'Permiso de micrófono denegado' : 'Microphone permission denied')
          : (language === 'es' ? 'No se pudo acceder al micrófono' : 'Could not access microphone')
      )
    }
  }, [language, stopRecording])

  const enterVoiceMode = useCallback(() => {
    setVoiceMode(true)
    voiceModeRef.current = true
    startVoiceListening()
  }, [startVoiceListening])

  const exitVoiceMode = useCallback(() => {
    setVoiceMode(false)
    voiceModeRef.current = false
    setIsVoiceSpeaking(false)
    setIsVoiceListening(false)
    setVoiceError(null)
    setVoiceTranscript('')
    stopRecording()
    // Release mic stream
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop())
      mediaStreamRef.current = null
    }
    if (currentAudioRef.current) {
      currentAudioRef.current()
      currentAudioRef.current = null
    }
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel()
    }
  }, [stopRecording])

  // Interrupt AI speech and start listening (barge-in)
  const interruptSpeaking = useCallback(() => {
    if (currentAudioRef.current) {
      currentAudioRef.current()
      currentAudioRef.current = null
    }
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel()
    }
    setIsVoiceSpeaking(false)
    startVoiceListening()
  }, [startVoiceListening])

  // Orb tap: interrupt when speaking, start listening when idle
  const handleOrbTap = useCallback(() => {
    if (isVoiceSpeaking) {
      interruptSpeaking()
    } else if (isVoiceListening) {
      // User taps while listening → stop recording early (send what we have)
      stopRecording()
    } else if (!isLoading) {
      startVoiceListening()
    }
  }, [isVoiceSpeaking, isVoiceListening, isLoading, interruptSpeaking, stopRecording, startVoiceListening])

  // Auto-start listening when idle in voice mode (delay after TTS to avoid echo)
  useEffect(() => {
    if (!voiceMode || isVoiceSpeaking || isLoading || isVoiceListening || voiceError) return
    const timer = setTimeout(() => {
      if (voiceModeRef.current && !voiceError) {
        startVoiceListening()
      }
    }, 1200)
    return () => clearTimeout(timer)
  }, [voiceMode, isVoiceSpeaking, isLoading, isVoiceListening, voiceError, startVoiceListening])

  // OpenAI TTS: speak latest assistant message in voice mode
  // Skip the initial welcome message — only speak new responses
  useEffect(() => {
    if (!voiceMode || !lastAssistantMessage || isLoading) return
    if (lastAssistantMessage.id === 'welcome') return
    if (lastAssistantMessage.id === lastSpokenIdRef.current) return
    lastSpokenIdRef.current = lastAssistantMessage.id

    const speakWithOpenAI = async () => {
      try {
        const cleanText = lastAssistantMessage.message
          .replace(/\*\*(.*?)\*\*/g, '$1')
          .replace(/[#*_~`]/g, '')
          .replace(/\n+/g, '. ')
          .replace(/\s+/g, ' ')
          .trim()
        if (!cleanText) return

        // Mute the mic stream to prevent feedback loop (AI voice → mic → Whisper → sends message)
        if (mediaStreamRef.current) {
          mediaStreamRef.current.getAudioTracks().forEach(t => { t.enabled = false })
        }

        setIsVoiceSpeaking(true)
        try {
          const audioBlob = await textToSpeech(cleanText, { lang: lastAssistantMessage.message?.match(/[\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1]/) ? 'es' : 'en' })
          const { play, stop } = playAudioBlob(
            audioBlob,
            () => setIsVoiceSpeaking(true),
            () => setIsVoiceSpeaking(false)
          )
          currentAudioRef.current = stop
          await play
          currentAudioRef.current = null
          return
        } catch (ttsErr) {
          console.warn('OpenAI TTS failed, falling back to browser speech:', ttsErr)
        }

        // Fallback: browser SpeechSynthesis
        if (typeof window !== 'undefined' && window.speechSynthesis) {
          await new Promise((resolve) => {
            const utterance = new SpeechSynthesisUtterance(cleanText.slice(0, 500))
            utterance.lang = lastAssistantMessage.message?.match(/[\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1]/) ? 'es-ES' : 'en-US'
            utterance.rate = 1.0
            utterance.onend = resolve
            utterance.onerror = resolve
            window.speechSynthesis.speak(utterance)
          })
        }
        setIsVoiceSpeaking(false)
      } catch (err) {
        console.error('Voice output failed:', err)
        setIsVoiceSpeaking(false)
      } finally {
        // Re-enable mic tracks after TTS finishes (with delay to avoid echo)
        setTimeout(() => {
          if (mediaStreamRef.current) {
            mediaStreamRef.current.getAudioTracks().forEach(t => { t.enabled = true })
          }
        }, 500)
      }
    }
    speakWithOpenAI()
  }, [voiceMode, lastAssistantMessage, isLoading])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      voiceModeRef.current = false
      if (vadFrameRef.current) cancelAnimationFrame(vadFrameRef.current)
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        try { mediaRecorderRef.current.stop() } catch {}
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(t => t.stop())
      }
      if (currentAudioRef.current) {
        currentAudioRef.current()
        currentAudioRef.current = null
      }
    }
  }, [])

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  // ─── Floating bubble (closed state) ──────
  if (!isOpen) {
    return (
      <div className="fixed bottom-20 right-5 z-40 group" style={{ perspective: '600px' }}>
        {/* Speech bubble with "?" */}
        <div className="absolute -top-14 -left-12 animate-float-slow opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none">
          <div className="relative bg-white rounded-2xl px-3 py-2 shadow-lg border border-cyan-200/50">
            <span className="text-cyan-500 font-bold text-lg">?</span>
            {/* Speech tail */}
            <div className="absolute -bottom-2 right-4 w-4 h-4 bg-white border-r border-b border-cyan-200/50 transform rotate-45" />
          </div>
        </div>

        {/* Glow ring behind robot */}
        <div className="absolute inset-0 m-auto w-16 h-16 rounded-full bg-cyan-400/20 blur-xl animate-pulse-glow" />

        <button
          onClick={() => setIsOpen(true)}
          className="relative w-[68px] h-[68px] rounded-full focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:ring-offset-2 animate-bob"
          aria-label="Open Nouri AI Assistant"
          style={{ transformStyle: 'preserve-3d' }}
        >
          {/* Robot SVG body */}
          <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-2xl" style={{ filter: 'drop-shadow(0 8px 16px rgba(0,200,255,0.3))' }}>
            {/* Body circle — glossy white */}
            <defs>
              <radialGradient id="bodyGrad" cx="40%" cy="35%" r="60%">
                <stop offset="0%" stopColor="#ffffff" />
                <stop offset="60%" stopColor="#f0f4f8" />
                <stop offset="100%" stopColor="#d1dbe6" />
              </radialGradient>
              <radialGradient id="eyeGrad" cx="50%" cy="40%" r="50%">
                <stop offset="0%" stopColor="#67e8f9" />
                <stop offset="100%" stopColor="#06b6d4" />
              </radialGradient>
              <radialGradient id="cheekGrad" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.6" />
                <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
              </radialGradient>
              <filter id="glow">
                <feGaussianBlur stdDeviation="2" result="coloredBlur" />
                <feMerge>
                  <feMergeNode in="coloredBlur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* Left antenna */}
            <line x1="30" y1="22" x2="22" y2="6" stroke="#b0bec5" strokeWidth="2.5" strokeLinecap="round" />
            <circle cx="22" cy="5" r="3.5" fill="url(#eyeGrad)" filter="url(#glow)" className="animate-antenna-glow" />

            {/* Right antenna */}
            <line x1="70" y1="22" x2="78" y2="6" stroke="#b0bec5" strokeWidth="2.5" strokeLinecap="round" />
            <circle cx="78" cy="5" r="3.5" fill="url(#eyeGrad)" filter="url(#glow)" className="animate-antenna-glow" />

            {/* Main body */}
            <circle cx="50" cy="52" r="36" fill="url(#bodyGrad)" stroke="#cfd8dc" strokeWidth="1" />

            {/* Screen / face visor */}
            <rect x="26" y="38" rx="12" ry="12" width="48" height="24" fill="#1e293b" opacity="0.85" />

            {/* Left eye — happy arc */}
            <path d="M35 53 Q38 46 41 53" stroke="url(#eyeGrad)" strokeWidth="3" strokeLinecap="round" fill="none" filter="url(#glow)" />
            {/* Right eye — happy arc */}
            <path d="M59 53 Q62 46 65 53" stroke="url(#eyeGrad)" strokeWidth="3" strokeLinecap="round" fill="none" filter="url(#glow)" />

            {/* Mouth — small smile */}
            <path d="M44 57 Q50 61 56 57" stroke="#67e8f9" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.7" />

            {/* Left ear / side detail */}
            <ellipse cx="14" cy="52" rx="5" ry="8" fill="#e2e8f0" stroke="#b0bec5" strokeWidth="0.8" />
            <ellipse cx="14" cy="52" rx="3" ry="5" fill="url(#eyeGrad)" opacity="0.4" />

            {/* Right ear / side detail */}
            <ellipse cx="86" cy="52" rx="5" ry="8" fill="#e2e8f0" stroke="#b0bec5" strokeWidth="0.8" />
            <ellipse cx="86" cy="52" rx="3" ry="5" fill="url(#eyeGrad)" opacity="0.4" />

            {/* Shine highlight */}
            <ellipse cx="38" cy="36" rx="10" ry="5" fill="white" opacity="0.5" />
          </svg>

          {/* Hover 3D tilt effect handled by CSS */}
          <div className="absolute inset-0 rounded-full ring-2 ring-cyan-300/0 group-hover:ring-cyan-300/40 transition-all duration-300" />
        </button>

        {/* Inline keyframes */}
        <style>{`
          @keyframes bob {
            0%, 100% { transform: translateY(0) rotateY(0deg); }
            25% { transform: translateY(-6px) rotateY(3deg); }
            50% { transform: translateY(-2px) rotateY(0deg); }
            75% { transform: translateY(-8px) rotateY(-3deg); }
          }
          @keyframes float-slow {
            0%, 100% { transform: translateY(0) scale(1); }
            50% { transform: translateY(-4px) scale(1.03); }
          }
          @keyframes pulse-glow {
            0%, 100% { opacity: 0.3; transform: scale(1); }
            50% { opacity: 0.6; transform: scale(1.3); }
          }
          @keyframes antenna-glow {
            0%, 100% { opacity: 0.7; }
            50% { opacity: 1; }
          }
          .animate-bob { animation: bob 3s ease-in-out infinite; }
          .animate-float-slow { animation: float-slow 2.5s ease-in-out infinite; }
          .animate-pulse-glow { animation: pulse-glow 2s ease-in-out infinite; }
          .animate-antenna-glow { animation: antenna-glow 1.5s ease-in-out infinite; }

          .group:hover .animate-bob {
            animation: bob 2s ease-in-out infinite;
            filter: drop-shadow(0 12px 24px rgba(0,200,255,0.45));
          }
        `}</style>
      </div>
    )
  }

  // ─── Chat panel (open state) ─────────────
  const panelClasses = isExpanded
    ? 'fixed inset-4 z-50 md:inset-8'
    : 'fixed bottom-20 right-4 z-50 w-[390px] max-w-[calc(100vw-2rem)] h-[620px] max-h-[calc(100vh-8rem)]'

  return (
    <div ref={panelRef} className={`${panelClasses} flex flex-col rounded-2xl shadow-2xl overflow-hidden transition-all duration-300 border border-slate-700/50`} style={{ background: 'linear-gradient(145deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)' }}>
      {/* Header */}
      <div className="bg-gradient-to-r from-slate-800 via-slate-800 to-slate-900 text-white px-4 py-3 flex items-center justify-between flex-shrink-0 border-b border-cyan-500/20">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center shadow-md shadow-cyan-500/30">
            <svg viewBox="0 0 100 100" className="w-6 h-6">
              <circle cx="50" cy="52" r="36" fill="#f0f4f8" />
              <rect x="26" y="38" rx="12" ry="12" width="48" height="24" fill="#1e293b" opacity="0.85" />
              <path d="M35 53 Q38 46 41 53" stroke="#67e8f9" strokeWidth="4" strokeLinecap="round" fill="none" />
              <path d="M59 53 Q62 46 65 53" stroke="#67e8f9" strokeWidth="4" strokeLinecap="round" fill="none" />
            </svg>
          </div>
          <div>
            <h3 className="font-semibold text-sm text-white">Nouri AI</h3>
            <p className="text-cyan-300/60 text-[10px]">
              {isStreaming ? 'Typing...' : isLoading ? 'Thinking...' : isAuthenticated ? 'Your food sharing assistant ✨' : 'Sign in for full features'}
            </p>
          </div>
          {/* Online indicator */}
          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse shadow-sm shadow-cyan-400/50" />
        </div>

        <div className="flex items-center gap-1">
          {/* Language toggle */}
          <button
            onClick={() => {
              const newLang = language === 'es' ? 'en' : 'es'
              sendMessage(newLang === 'es' ? 'Hola, habla en español por favor' : 'Hi, please speak in English')
            }}
            className="text-cyan-300/60 hover:text-cyan-300 text-xs px-2 py-1 rounded hover:bg-cyan-500/10 transition-colors border border-transparent hover:border-cyan-500/20"
            title={language === 'es' ? 'Switch to English' : 'Cambiar a Español'}
          >
            {language === 'es' ? 'EN' : 'ES'}
          </button>

          {/* Menu */}
          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="text-cyan-300/60 hover:text-cyan-300 p-1 rounded hover:bg-cyan-500/10 transition-colors"
              aria-label="Chat menu"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
              </svg>
            </button>
            {showMenu && (
              <div className="absolute right-0 top-full mt-1 bg-slate-800 rounded-lg shadow-xl border border-slate-700 py-1 w-44 z-10 backdrop-blur-sm">
                <button
                  onClick={() => { clearHistory(); setShowMenu(false) }}
                  className="w-full text-left px-4 py-2 text-sm text-slate-300 hover:bg-slate-700/50 hover:text-cyan-300 transition-colors"
                >
                  🗑️ Clear conversation
                </button>
                <button
                  onClick={() => { setIsExpanded(!isExpanded); setShowMenu(false) }}
                  className="w-full text-left px-4 py-2 text-sm text-slate-300 hover:bg-slate-700/50 hover:text-cyan-300 transition-colors"
                >
                  {isExpanded ? '🗗 Compact view' : '⬜ Full screen'}
                </button>
              </div>
            )}
          </div>

          {/* Expand / collapse */}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-cyan-300/60 hover:text-cyan-300 p-1 rounded hover:bg-cyan-500/10 transition-colors hidden md:block"
            aria-label={isExpanded ? 'Compact view' : 'Expand'}
          >
            {isExpanded ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M5 10a1 1 0 011-1h8a1 1 0 110 2H6a1 1 0 01-1-1z" clipRule="evenodd" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M3 4a1 1 0 011-1h4a1 1 0 010 2H6.414l2.293 2.293a1 1 0 11-1.414 1.414L5 6.414V8a1 1 0 01-2 0V4zm9 1a1 1 0 010-2h4a1 1 0 011 1v4a1 1 0 11-2 0V6.414l-2.293 2.293a1 1 0 11-1.414-1.414L13.586 5H12zm-9 7a1 1 0 012 0v1.586l2.293-2.293a1 1 0 111.414 1.414L5.414 15H7a1 1 0 110 2H3a1 1 0 01-1-1v-4zm13.707.707a1 1 0 00-1.414-1.414L13 13.586V12a1 1 0 10-2 0v4a1 1 0 001 1h4a1 1 0 100-2h-1.586l2.293-2.293z" clipRule="evenodd" />
              </svg>
            )}
          </button>

          {/* Close */}
          <button
            onClick={() => { setIsOpen(false); setIsExpanded(false); setShowMenu(false) }}
            className="text-cyan-300/60 hover:text-cyan-300 p-1 rounded hover:bg-red-500/20 transition-colors"
            aria-label="Close chat"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      </div>

      {/* ─── Voice Mode (ChatGPT-like immersive voice UI) ─────── */}
      {voiceMode ? (
        <div className="flex-1 flex flex-col items-center justify-between py-6 px-6 overflow-hidden relative" style={{ background: 'radial-gradient(ellipse at center, #0f172a 0%, #020617 100%)' }}>

          {/* Top: back to chat */}
          <div className="w-full flex justify-start z-10">
            <button
              onClick={exitVoiceMode}
              className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 px-3 py-2 rounded-lg hover:bg-white/5 transition-all"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
              </svg>
              {language === 'es' ? 'Chat' : 'Chat'}
            </button>
          </div>

          {/* Center: Animated Orb */}
          <div className="flex-1 flex items-center justify-center">
            <button
              onClick={handleOrbTap}
              className="relative focus:outline-none group"
              aria-label={isVoiceSpeaking ? (language === 'es' ? 'Toca para interrumpir' : 'Tap to interrupt') : (language === 'es' ? 'Toca para hablar' : 'Tap to speak')}
            >
              {/* Pulse rings — listening */}
              {isVoiceListening && (
                <>
                  <div className="absolute inset-0 -m-8 rounded-full border-2 border-blue-400/30 animate-voice-ring-1" />
                  <div className="absolute inset-0 -m-14 rounded-full border border-blue-400/15 animate-voice-ring-2" />
                  <div className="absolute inset-0 -m-20 rounded-full border border-blue-400/5 animate-voice-ring-3" />
                </>
              )}

              {/* Speaking ripple */}
              {isVoiceSpeaking && (
                <>
                  <div className="absolute inset-0 -m-6 rounded-full border-2 border-teal-400/25 animate-voice-speak-ring-1" />
                  <div className="absolute inset-0 -m-10 rounded-full border border-teal-400/10 animate-voice-speak-ring-2" />
                </>
              )}

              {/* Glow */}
              <div className={`absolute -inset-8 rounded-full blur-2xl transition-all duration-700 ${
                isVoiceSpeaking ? 'bg-teal-500/25' : isVoiceListening ? 'bg-blue-500/25' : isLoading ? 'bg-violet-500/20' : 'bg-slate-600/10'
              }`} />

              {/* Main orb */}
              <div className={`relative w-36 h-36 rounded-full transition-all duration-500 flex items-center justify-center cursor-pointer ${
                isVoiceListening
                  ? 'bg-gradient-to-br from-blue-400 via-indigo-500 to-violet-600 shadow-[0_0_60px_rgba(99,102,241,0.4)] scale-105'
                  : isVoiceSpeaking
                    ? 'bg-gradient-to-br from-teal-400 via-cyan-500 to-blue-500 shadow-[0_0_60px_rgba(20,184,166,0.4)] scale-110'
                    : isLoading
                      ? 'bg-gradient-to-br from-violet-400 via-purple-500 to-fuchsia-500 shadow-[0_0_40px_rgba(168,85,247,0.35)] scale-100'
                      : 'bg-gradient-to-br from-slate-500 via-slate-600 to-slate-700 shadow-[0_0_20px_rgba(100,116,139,0.25)] scale-95 group-hover:scale-100'
              }`}>
                {/* Gloss */}
                <div className="absolute inset-0 rounded-full bg-gradient-to-t from-transparent via-transparent to-white/15" />

                {/* Icon / visual based on state */}
                <div className="relative z-10">
                  {isVoiceSpeaking ? (
                    <div className="flex items-center gap-[3px]">
                      {[0,1,2,3,4].map(i => (
                        <span key={i} className="w-1.5 bg-white/90 rounded-full animate-voice-bar" style={{ animationDelay: `${i * 0.12}s` }} />
                      ))}
                    </div>
                  ) : isLoading ? (
                    <div className="flex items-center gap-2">
                      {[0,1,2].map(i => (
                        <span key={i} className="w-3 h-3 bg-white/80 rounded-full animate-voice-dot" style={{ animationDelay: `${i * 0.2}s` }} />
                      ))}
                    </div>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" className={`h-12 w-12 transition-colors ${
                      isVoiceListening ? 'text-white/90' : 'text-white/50 group-hover:text-white/80'
                    }`} viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                      <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                    </svg>
                  )}
                </div>
              </div>
            </button>
          </div>

          {/* Bottom: transcript + status + end button */}
          <div className="flex flex-col items-center gap-3 z-10 w-full">
            {/* Real-time transcript */}
            {voiceTranscript && (
              <p className={`text-sm italic text-center max-w-[280px] transition-colors duration-300 ${
                isVoiceListening ? 'text-white/70' : 'text-slate-400/50'
              }`}>
                "{voiceTranscript}"
              </p>
            )}

            {/* Status */}
            <p className={`text-[11px] font-medium tracking-wider uppercase transition-all duration-300 ${
              isVoiceSpeaking ? 'text-teal-300/50' : isVoiceListening ? 'text-blue-300/50' : isLoading ? 'text-violet-300/50' : voiceError ? 'text-red-400/60' : 'text-slate-500/30'
            }`}>
              {isVoiceSpeaking
                ? (language === 'es' ? 'Toca para interrumpir' : 'Tap to interrupt')
                : isLoading
                  ? (language === 'es' ? 'Pensando...' : 'Thinking...')
                  : isVoiceListening
                    ? (language === 'es' ? 'Escuchando — toca para enviar' : 'Listening — tap to send')
                    : voiceError
                      ? voiceError
                      : (language === 'es' ? 'Toca el orbe para hablar' : 'Tap to speak')}
            </p>

            {/* End voice mode */}
            <button
              onClick={exitVoiceMode}
              className="w-14 h-14 rounded-full bg-red-500/20 hover:bg-red-500/80 border border-red-500/30 hover:border-red-500 text-red-300 hover:text-white flex items-center justify-center transition-all hover:scale-105 active:scale-95 shadow-lg shadow-red-500/10 hover:shadow-red-500/30"
              aria-label={language === 'es' ? 'Terminar' : 'End'}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

        </div>
      ) : (
      <>
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-3 nourish-scrollbar" role="log" aria-label="Chat messages" aria-live="polite">
        {messages.map(msg => (
          <MessageBubble
            key={msg.id}
            msg={msg}
            onFeedback={submitFeedback}
            language={language}
          />
        ))}

        {isLoading && !isStreaming && <TypingIndicator />}

        {/* Tool calling indicator */}
        {activeTools && activeTools.length > 0 && (
          <div className="flex items-center gap-2 px-3 py-2 mb-2 animate-fadeIn">
            <div className="flex items-center gap-1.5 bg-cyan-500/10 border border-cyan-500/20 rounded-lg px-3 py-1.5">
              <svg className="w-3.5 h-3.5 text-cyan-400 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2v4m0 12v4m-7.07-3.93l2.83-2.83m8.49-8.49l2.83-2.83M2 12h4m12 0h4m-3.93 7.07l-2.83-2.83M6.34 6.34L3.51 3.51" />
              </svg>
              <span className="text-xs text-cyan-300">
                {activeTools.map(t => t.replace(/_/g, ' ')).join(', ')}
              </span>
            </div>
          </div>
        )}

        {/* Quick actions — show when only the welcome message is visible */}
        {messages.length <= 1 && !isLoading && (
          <div className="mt-4 animate-fadeIn">
            <p className="text-xs text-slate-500 mb-2 px-1">{language === 'es' ? 'Prueba preguntar:' : 'Try asking:'}</p>
            <div className="grid grid-cols-2 gap-2">
              {quickActions.slice(0, 8).map((action, i) => (
                <button
                  key={i}
                  onClick={() => handleQuickAction(action.message)}
                  className="text-left text-xs bg-slate-700/30 hover:bg-cyan-500/15 text-slate-300 hover:text-cyan-200 px-3 py-2.5 rounded-xl transition-all duration-200 border border-slate-600/20 hover:border-cyan-500/30 hover:shadow-sm hover:shadow-cyan-500/10"
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick actions — show when conversation just started */}
      {messages.length <= 2 && !isLoading && (
        <div className="px-4 pb-2 flex-shrink-0">
          <div className="flex flex-wrap gap-1.5">
            {quickActions.map((qa, i) => (
              <button
                key={i}
                onClick={() => handleQuickAction(qa.message)}
                className="text-xs bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 px-3 py-1.5 rounded-full transition-all border border-cyan-500/20 hover:border-cyan-400/40 hover:shadow-sm hover:shadow-cyan-500/10"
              >
                {qa.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input area */}
      <form onSubmit={handleSend} className="border-t border-cyan-500/20 px-3 py-2.5 flex items-end gap-2 flex-shrink-0 bg-slate-900/80 backdrop-blur-sm">
        <div className="flex-1 relative">
          <textarea
            ref={inputRef}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={language === 'es' ? 'Pregúntame lo que quieras... ✨' : 'Ask me anything... ✨'}
            className="w-full resize-none rounded-xl border border-slate-600/50 bg-slate-800/60 text-slate-100 placeholder-slate-500 focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/20 px-3.5 py-2.5 text-sm max-h-24 outline-none transition-all duration-200"
            rows={1}
            disabled={isLoading}
            aria-label="Message input"
          />
          {inputText.length > 0 && (
            <span className="absolute right-2 bottom-1.5 text-[10px] text-slate-600">{inputText.length}</span>
          )}
        </div>

        {/* Voice mode — AI speaks responses aloud */}
        <button
          type="button"
          onClick={enterVoiceMode}
          disabled={isLoading}
          className="p-2 rounded-full transition-all duration-200 text-slate-400 hover:text-cyan-400 hover:bg-cyan-500/10"
          title={language === 'es' ? 'Modo voz (Nouri habla)' : 'Voice mode (Nouri speaks)'}
          aria-label="Switch to voice mode"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z" clipRule="evenodd" />
          </svg>
        </button>

        {/* Send button */}
        <button
          type="submit"
          disabled={!inputText.trim() || isLoading}
          className={`p-2 rounded-full transition-all ${
            inputText.trim() && !isLoading
              ? 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white hover:from-cyan-400 hover:to-blue-400 shadow-md shadow-cyan-500/25'
              : 'bg-slate-700/50 text-slate-500 cursor-not-allowed'
          }`}
          aria-label="Send message"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
          </svg>
        </button>
      </form>
      </>
      )}

      {/* Futuristic scrollbar + ambient glow + voice panel animations */}
      <style>{`
        .nourish-scrollbar::-webkit-scrollbar { width: 4px; }
        .nourish-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .nourish-scrollbar::-webkit-scrollbar-thumb { background: rgba(34,211,238,0.2); border-radius: 4px; }
        .nourish-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(34,211,238,0.4); }

        /* Message fade-in */
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fadeIn { animation: fadeIn 0.3s ease-out; }

        /* Streaming cursor blink */
        @keyframes blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
        .animate-blink { animation: blink 0.8s step-end infinite; }

        /* Voice orb animations */
        @keyframes voice-ring-out {
          0% { transform: scale(1); opacity: 1; }
          100% { transform: scale(1.6); opacity: 0; }
        }
        .animate-voice-ring-1 { animation: voice-ring-out 2s ease-out infinite; }
        .animate-voice-ring-2 { animation: voice-ring-out 2s ease-out 0.4s infinite; }
        .animate-voice-ring-3 { animation: voice-ring-out 2s ease-out 0.8s infinite; }

        @keyframes voice-speak-ring {
          0% { transform: scale(1); opacity: 0.6; }
          100% { transform: scale(1.4); opacity: 0; }
        }
        .animate-voice-speak-ring-1 { animation: voice-speak-ring 1.5s ease-out infinite; }
        .animate-voice-speak-ring-2 { animation: voice-speak-ring 1.5s ease-out 0.3s infinite; }

        /* Speaking wave bars */
        @keyframes voice-bar-bounce {
          0%, 100% { height: 8px; }
          50% { height: 28px; }
        }
        .animate-voice-bar { animation: voice-bar-bounce 0.6s ease-in-out infinite; }

        /* Thinking dots */
        @keyframes voice-dot-pulse {
          0%, 100% { transform: scale(1); opacity: 0.5; }
          50% { transform: scale(1.4); opacity: 1; }
        }
        .animate-voice-dot { animation: voice-dot-pulse 0.8s ease-in-out infinite; }
      `}</style>
    </div>
  )
}

export default AIChatPanel
