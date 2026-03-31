import React, { useState, useEffect, useCallback, useRef } from 'react'

const synth = typeof window !== 'undefined' ? window.speechSynthesis : null

/**
 * VoiceOutput — reads AI responses aloud using browser SpeechSynthesis.
 * Props:
 *   text — text to speak
 *   language — 'en' or 'es'
 *   autoSpeak — whether to auto-speak new text (default false)
 *   onSpeakingChange(isSpeaking) — callback when speaking state changes
 */
function VoiceOutput({ text, language = 'en', autoSpeak = false, onSpeakingChange }) {
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [supported, setSupported] = useState(false)
  const utteranceRef = useRef(null)
  const prevTextRef = useRef('')

  useEffect(() => {
    setSupported(!!synth)
    return () => {
      if (synth) synth.cancel()
    }
  }, [])

  // Auto-speak when new text arrives
  useEffect(() => {
    if (!autoSpeak || isMuted || !text || text === prevTextRef.current) return
    prevTextRef.current = text
    speak(text)
  }, [text, autoSpeak, isMuted])

  const speak = useCallback((textToSpeak) => {
    if (!synth || !textToSpeak) return

    // Cancel any current speech
    synth.cancel()

    // Clean text for speech (remove markdown, excessive punctuation)
    const cleanText = textToSpeak
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/[#*_~`]/g, '')
      .replace(/\n+/g, '. ')
      .replace(/\s+/g, ' ')
      .trim()

    if (!cleanText) return

    const utterance = new SpeechSynthesisUtterance(cleanText)
    utterance.lang = language === 'es' ? 'es-ES' : 'en-US'
    utterance.rate = 0.95
    utterance.pitch = 1.0

    // Try to pick a natural voice for the language
    const voices = synth.getVoices()
    const langCode = language === 'es' ? 'es' : 'en'
    const preferredVoice = voices.find(v =>
      v.lang.startsWith(langCode) && (v.name.includes('Google') || v.name.includes('Samantha') || v.name.includes('Microsoft'))
    ) || voices.find(v => v.lang.startsWith(langCode))

    if (preferredVoice) {
      utterance.voice = preferredVoice
    }

    utterance.onstart = () => {
      setIsSpeaking(true)
      onSpeakingChange?.(true)
    }

    utterance.onend = () => {
      setIsSpeaking(false)
      onSpeakingChange?.(false)
    }

    utterance.onerror = () => {
      setIsSpeaking(false)
      onSpeakingChange?.(false)
    }

    utteranceRef.current = utterance
    synth.speak(utterance)
  }, [language, onSpeakingChange])

  const stop = useCallback(() => {
    if (synth) {
      synth.cancel()
      setIsSpeaking(false)
      onSpeakingChange?.(false)
    }
  }, [onSpeakingChange])

  const toggleMute = useCallback(() => {
    if (isSpeaking) stop()
    setIsMuted(prev => !prev)
  }, [isSpeaking, stop])

  // Manual speak button handler
  const handleSpeak = useCallback(() => {
    if (isSpeaking) {
      stop()
    } else {
      speak(text)
    }
  }, [isSpeaking, text, speak, stop])

  if (!supported) return null

  return (
    <div className="inline-flex items-center gap-1">
      {/* Speak / Stop button */}
      <button
        type="button"
        onClick={handleSpeak}
        disabled={!text}
        className={`p-1 rounded transition-colors ${
          isSpeaking
            ? 'text-green-600 animate-pulse'
            : 'text-gray-400 hover:text-green-600'
        }`}
        title={isSpeaking ? 'Stop speaking' : 'Read aloud'}
        aria-label={isSpeaking ? 'Stop speaking' : 'Read message aloud'}
      >
        {isSpeaking ? (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM12.293 7.293a1 1 0 011.414 0L15 8.586l1.293-1.293a1 1 0 111.414 1.414L16.414 10l1.293 1.293a1 1 0 01-1.414 1.414L15 11.414l-1.293 1.293a1 1 0 01-1.414-1.414L13.586 10l-1.293-1.293a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z" clipRule="evenodd" />
          </svg>
        )}
      </button>

      {/* Mute toggle */}
      <button
        type="button"
        onClick={toggleMute}
        className={`p-1 rounded transition-colors ${
          isMuted ? 'text-red-400' : 'text-gray-300 hover:text-gray-500'
        }`}
        title={isMuted ? 'Unmute auto-read' : 'Mute auto-read'}
        aria-label={isMuted ? 'Unmute voice output' : 'Mute voice output'}
      >
        {isMuted ? (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM12.293 7.293a1 1 0 011.414 0L15 8.586l1.293-1.293a1 1 0 111.414 1.414L16.414 10l1.293 1.293a1 1 0 01-1.414 1.414L15 11.414l-1.293 1.293a1 1 0 01-1.414-1.414L13.586 10l-1.293-1.293a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217z" clipRule="evenodd" />
          </svg>
        )}
      </button>
    </div>
  )
}

export default VoiceOutput
