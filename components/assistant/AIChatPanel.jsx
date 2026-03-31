import React, { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAIChat } from '../../utils/hooks/useAIChat.js'
import VoiceOutput from './VoiceOutput.jsx'
import { transcribeAudio, textToSpeech, playAudioBlob } from '../../utils/openaiVoice.js'

// ─── Quick action presets ─────────────────────────────
const QUICK_ACTIONS_EN = [
  { label: '🔍 Find food near me', message: 'What food is available near me?' },
  { label: '📦 My pickups', message: 'What are my upcoming pickups?' },
  { label: '🍳 Suggest a recipe', message: 'Can you suggest a recipe from available food?' },
  { label: '🤝 Share food', message: 'I want to share some food' },
  { label: '📅 Upcoming events', message: 'What distribution events are coming up?' },
  { label: '❓ How it works', message: 'How does DoGoods work?' },
]

const QUICK_ACTIONS_ES = [
  { label: '🔍 Buscar comida', message: '¿Qué comida hay disponible cerca de mí?' },
  { label: '📦 Mis recogidas', message: '¿Cuáles son mis próximas recogidas?' },
  { label: '🍳 Sugerir receta', message: '¿Puedes sugerirme una receta con comida disponible?' },
  { label: '🤝 Compartir comida', message: 'Quiero compartir comida' },
  { label: '📅 Eventos', message: '¿Qué eventos de distribución hay próximamente?' },
  { label: '❓ Cómo funciona', message: '¿Cómo funciona DoGoods?' },
]

// ─── Typing indicator ─────────────────────────────────
function TypingIndicator() {
  return (
    <div className="flex items-center gap-2 px-4 py-3">
      <div className="w-6 h-6 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center flex-shrink-0 shadow-sm shadow-cyan-400/30">
        <span className="text-[10px]">🤖</span>
      </div>
      <div className="flex items-center gap-1 bg-slate-700/50 backdrop-blur-sm rounded-2xl px-3 py-2 border border-cyan-500/20">
        <span className="w-2 h-2 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
        <span className="w-2 h-2 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
        <span className="w-2 h-2 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
      <span className="text-xs text-cyan-300/60 ml-1">Nouri is thinking...</span>
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
              📍 {item.distance_miles} mi · {item.category} · {item.pickup_time || 'Contact for pickup'}
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
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div className={`max-w-[85%] ${isUser ? '' : 'flex items-start gap-2'}`}>
        {/* Nouri avatar */}
        {!isUser && (
          <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center mt-1 shadow-sm shadow-cyan-400/30">
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
            className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
              isUser
                ? 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white rounded-br-md shadow-sm shadow-cyan-500/20'
                : msg.isError
                  ? 'bg-red-900/30 text-red-300 border border-red-500/30 rounded-bl-md backdrop-blur-sm'
                  : 'bg-slate-700/50 text-slate-100 rounded-bl-md border border-slate-600/30 backdrop-blur-sm'
            }`}
          >
            <p className="whitespace-pre-wrap">{msg.message}</p>
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
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)
  const panelRef = useRef(null)
  const mediaRecorderRef = useRef(null)
  const currentAudioRef = useRef(null)
  const lastSpokenIdRef = useRef(null)

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

  const enterVoiceMode = useCallback(() => {
    setVoiceMode(true)
  }, [])

  const exitVoiceMode = useCallback(() => {
    setVoiceMode(false)
    setIsVoiceSpeaking(false)
    setIsVoiceListening(false)
    if (mediaRecorderRef.current) {
      const { mediaRecorder, stream, audioCtx } = mediaRecorderRef.current
      if (mediaRecorder.state === 'recording') mediaRecorder.stop()
      stream.getTracks().forEach(t => t.stop())
      audioCtx.close().catch(() => {})
      mediaRecorderRef.current = null
    }
    if (currentAudioRef.current) {
      currentAudioRef.current()
      currentAudioRef.current = null
    }
  }, [])

  // Auto-listen: record audio via MediaRecorder → send to OpenAI Whisper
  const startVoiceListening = useCallback(async () => {
    try {
      // Stop any existing recording
      if (mediaRecorderRef.current) {
        const { mediaRecorder, stream, audioCtx } = mediaRecorderRef.current
        if (mediaRecorder.state === 'recording') mediaRecorder.stop()
        stream.getTracks().forEach(t => t.stop())
        audioCtx.close().catch(() => {})
        mediaRecorderRef.current = null
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })

      // AudioContext for silence detection
      const audioCtx = new AudioContext()
      const source = audioCtx.createMediaStreamSource(stream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 512
      source.connect(analyser)

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
      })
      const chunks = []

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data)
      }

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        audioCtx.close().catch(() => {})
        mediaRecorderRef.current = null
        setIsVoiceListening(false)

        if (chunks.length === 0) return
        const audioBlob = new Blob(chunks, { type: mediaRecorder.mimeType })
        try {
          const transcript = await transcribeAudio(audioBlob, language)
          if (transcript.trim()) sendMessage(transcript.trim())
        } catch (err) {
          console.error('Whisper transcription failed:', err)
        }
      }

      mediaRecorder.start()
      setIsVoiceListening(true)
      mediaRecorderRef.current = { mediaRecorder, stream, audioCtx, analyser }

      // Silence detection via RMS analysis
      const dataArray = new Uint8Array(analyser.frequencyBinCount)
      let silenceStart = null
      let hasSpoken = false
      const SILENCE_THRESHOLD = 8
      const SILENCE_DURATION = 1500
      let animFrameId = null

      const checkSilence = () => {
        if (!mediaRecorderRef.current || mediaRecorder.state !== 'recording') return
        analyser.getByteTimeDomainData(dataArray)
        let sum = 0
        for (let i = 0; i < dataArray.length; i++) {
          const val = (dataArray[i] - 128) / 128
          sum += val * val
        }
        const rms = Math.sqrt(sum / dataArray.length) * 100

        if (rms > SILENCE_THRESHOLD) {
          hasSpoken = true
          silenceStart = null
        } else if (hasSpoken) {
          if (!silenceStart) silenceStart = Date.now()
          else if (Date.now() - silenceStart > SILENCE_DURATION) {
            mediaRecorder.stop()
            return
          }
        }
        animFrameId = requestAnimationFrame(checkSilence)
      }

      setTimeout(() => { animFrameId = requestAnimationFrame(checkSilence) }, 300)

      // Safety timeout: 30s max recording
      setTimeout(() => {
        if (mediaRecorder.state === 'recording') mediaRecorder.stop()
      }, 30000)

    } catch (err) {
      console.error('Microphone access failed:', err)
      setIsVoiceListening(false)
    }
  }, [language, sendMessage])

  // Auto-start listening when entering voice mode
  useEffect(() => {
    if (voiceMode && !isVoiceSpeaking && !isLoading && !isVoiceListening) {
      const timer = setTimeout(() => startVoiceListening(), 500)
      return () => clearTimeout(timer)
    }
  }, [voiceMode, isVoiceSpeaking, isLoading])

  // OpenAI TTS: speak latest assistant message in voice mode
  useEffect(() => {
    if (!voiceMode || !lastAssistantMessage || isLoading) return
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

        setIsVoiceSpeaking(true)
        const audioBlob = await textToSpeech(cleanText, { voice: 'nova' })
        const { play, stop } = playAudioBlob(
          audioBlob,
          () => setIsVoiceSpeaking(true),
          () => setIsVoiceSpeaking(false)
        )
        currentAudioRef.current = stop
        await play
        currentAudioRef.current = null
      } catch (err) {
        console.error('OpenAI TTS failed:', err)
        setIsVoiceSpeaking(false)
      }
    }
    speakWithOpenAI()
  }, [voiceMode, lastAssistantMessage, isLoading])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current) {
        const { mediaRecorder, stream, audioCtx } = mediaRecorderRef.current
        if (mediaRecorder.state === 'recording') mediaRecorder.stop()
        stream.getTracks().forEach(t => t.stop())
        audioCtx.close().catch(() => {})
        mediaRecorderRef.current = null
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
            <h3 className="font-semibold text-sm text-white">Nouri AI Assistant</h3>
            <p className="text-cyan-300/60 text-[10px]">
              {isAuthenticated ? 'Your AI food assistant' : 'Sign in for full features'}
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

      {/* ─── Voice Mode Panel (audio-only assistant) ─────── */}
      {voiceMode ? (
        <div className="flex-1 flex flex-col items-center justify-center px-6 py-4 overflow-hidden relative">
          {/* Ambient background glow */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-72 h-72 rounded-full blur-3xl transition-all duration-1000 ${
              isVoiceSpeaking ? 'bg-cyan-500/15 scale-110' : isVoiceListening ? 'bg-blue-500/10 scale-105' : 'bg-cyan-500/5 scale-100'
            } animate-voice-ambient`} />
          </div>

          {/* Back to chat */}
          <button
            onClick={exitVoiceMode}
            className="absolute top-3 left-3 flex items-center gap-1.5 text-xs text-cyan-300/50 hover:text-cyan-300 px-2.5 py-1.5 rounded-lg hover:bg-cyan-500/10 transition-colors z-10"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
            </svg>
            {language === 'es' ? 'Chat' : 'Chat'}
          </button>

          {/* Robot avatar — animates based on state */}
          <div className="relative mb-6">
            {/* Outer glow ring */}
            <div className={`absolute -inset-4 rounded-full transition-all duration-700 ${
              isVoiceSpeaking ? 'bg-cyan-400/20 animate-voice-speaking' : isVoiceListening ? 'bg-blue-400/15 animate-pulse' : 'bg-transparent'
            }`} />
            <div className={`relative w-28 h-28 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center shadow-xl transition-all duration-500 ${
              isVoiceSpeaking ? 'shadow-cyan-400/50 scale-105' : isVoiceListening ? 'shadow-blue-400/40 scale-100' : 'shadow-cyan-500/30 scale-100'
            }`}>
              <svg viewBox="0 0 100 100" className="w-18 h-18" style={{width: '4.5rem', height: '4.5rem'}}>
                <circle cx="50" cy="52" r="36" fill="#f0f4f8" />
                <rect x="26" y="38" rx="12" ry="12" width="48" height="24" fill="#1e293b" opacity="0.85" />
                {isVoiceSpeaking ? (
                  <>
                    <circle cx="38" cy="50" r="4" fill="#67e8f9" className="animate-pulse" />
                    <circle cx="62" cy="50" r="4" fill="#67e8f9" className="animate-pulse" />
                    <ellipse cx="50" cy="66" rx="6" ry="3" fill="#67e8f9" opacity="0.6" className="animate-pulse" />
                  </>
                ) : isVoiceListening ? (
                  <>
                    <circle cx="38" cy="50" r="5" fill="#67e8f9" />
                    <circle cx="62" cy="50" r="5" fill="#67e8f9" />
                  </>
                ) : (
                  <>
                    <path d="M35 53 Q38 46 41 53" stroke="#67e8f9" strokeWidth="4" strokeLinecap="round" fill="none" />
                    <path d="M59 53 Q62 46 65 53" stroke="#67e8f9" strokeWidth="4" strokeLinecap="round" fill="none" />
                  </>
                )}
              </svg>
            </div>
            {/* Status dot */}
            <span className={`absolute bottom-1 right-1 w-4 h-4 rounded-full border-2 border-slate-900 ${
              isVoiceSpeaking ? 'bg-cyan-400 animate-pulse' : isVoiceListening ? 'bg-blue-400 animate-pulse' : 'bg-green-400'
            }`} />
          </div>

          {/* Audio wave visualizer — shown when AI is speaking or processing */}
          <div className={`voice-eq flex items-end gap-1.5 h-10 mb-5 transition-opacity duration-500 ${
            isVoiceSpeaking || isLoading ? 'opacity-100' : 'opacity-0'
          }`}>
            <span className="voice-eq-bar w-1 bg-cyan-400/80 rounded-full" />
            <span className="voice-eq-bar w-1 bg-cyan-300/70 rounded-full" style={{animationDelay: '0.08s'}} />
            <span className="voice-eq-bar w-1.5 bg-cyan-400/90 rounded-full" style={{animationDelay: '0.16s'}} />
            <span className="voice-eq-bar w-1 bg-cyan-300/70 rounded-full" style={{animationDelay: '0.24s'}} />
            <span className="voice-eq-bar w-1.5 bg-cyan-400/80 rounded-full" style={{animationDelay: '0.32s'}} />
            <span className="voice-eq-bar w-1 bg-cyan-300/70 rounded-full" style={{animationDelay: '0.40s'}} />
            <span className="voice-eq-bar w-1 bg-cyan-400/80 rounded-full" style={{animationDelay: '0.48s'}} />
            <span className="voice-eq-bar w-1 bg-cyan-300/70 rounded-full" style={{animationDelay: '0.56s'}} />
            <span className="voice-eq-bar w-1.5 bg-cyan-400/90 rounded-full" style={{animationDelay: '0.64s'}} />
          </div>

          {/* Status label */}
          <p className={`text-xs transition-all duration-500 ${
            isVoiceSpeaking ? 'text-cyan-300/70' : isVoiceListening ? 'text-blue-300/70' : isLoading ? 'text-slate-400' : 'text-slate-500/50'
          }`}>
            {isVoiceSpeaking
              ? (language === 'es' ? 'Hablando...' : 'Speaking...')
              : isLoading
                ? (language === 'es' ? 'Pensando...' : 'Thinking...')
                : isVoiceListening
                  ? (language === 'es' ? 'Escuchando...' : 'Listening...')
                  : ''}
          </p>

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

        {isLoading && <TypingIndicator />}

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
            placeholder={language === 'es' ? '¿En qué puedo ayudarte?' : 'Ask me anything...'}
            className="w-full resize-none rounded-xl border border-slate-600/50 bg-slate-800/60 text-slate-100 placeholder-slate-500 focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30 px-3 py-2 text-sm max-h-24 outline-none transition-colors"
            rows={1}
            disabled={isLoading}
            aria-label="Message input"
          />
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

        /* Voice panel animations */
        @keyframes voice-ambient {
          0%, 100% { opacity: 0.3; transform: translate(-50%, -50%) scale(1); }
          50% { opacity: 0.6; transform: translate(-50%, -50%) scale(1.2); }
        }
        .animate-voice-ambient { animation: voice-ambient 4s ease-in-out infinite; }

        @keyframes voice-ring-expand {
          0% { transform: scale(0.6); opacity: 0.6; border-color: rgba(34,211,238,0.5); }
          100% { transform: scale(1.2); opacity: 0; border-color: rgba(34,211,238,0); }
        }
        .voice-listening .voice-ring-1 { animation: voice-ring-expand 1.5s ease-out infinite; }
        .voice-listening .voice-ring-2 { animation: voice-ring-expand 1.5s ease-out 0.3s infinite; }
        .voice-listening .voice-ring-3 { animation: voice-ring-expand 1.5s ease-out 0.6s infinite; }

        @keyframes voice-fade-in {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-voice-fade-in { animation: voice-fade-in 0.4s ease-out; }

        @keyframes voice-speaking-glow {
          0%, 100% { box-shadow: 0 0 20px rgba(34,211,238,0.3); }
          50% { box-shadow: 0 0 40px rgba(34,211,238,0.6); }
        }
        .animate-voice-speaking { animation: voice-speaking-glow 1s ease-in-out infinite; }

        /* Voice EQ bars */
        @keyframes voice-eq-bounce {
          0%, 100% { height: 4px; }
          50% { height: 16px; }
        }
        .voice-eq-bar { animation: voice-eq-bounce 0.6s ease-in-out infinite; }
      `}</style>
    </div>
  )
}

export default AIChatPanel
