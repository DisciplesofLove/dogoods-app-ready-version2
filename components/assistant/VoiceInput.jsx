import React, { useState, useEffect, useCallback, useRef } from 'react'

const SpeechRecognition = typeof window !== 'undefined'
  ? window.SpeechRecognition || window.webkitSpeechRecognition
  : null

/**
 * VoiceInput — microphone button that converts speech to text using Web Speech API.
 * Props:
 *   onTranscript(text) — called when speech is recognized
 *   language — 'en' or 'es' (default 'en')
 *   disabled — disable the mic button
 */
function VoiceInput({ onTranscript, onListeningChange, language = 'en', disabled = false, large = false }) {
  const [isListening, setIsListening] = useState(false)
  const [supported, setSupported] = useState(false)
  const recognitionRef = useRef(null)
  const transcriptRef = useRef('')

  useEffect(() => {
    setSupported(!!SpeechRecognition)
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort()
        recognitionRef.current = null
      }
    }
  }, [])

  const startListening = useCallback(() => {
    if (!SpeechRecognition || disabled) return

    // Stop any existing recognition
    if (recognitionRef.current) {
      recognitionRef.current.abort()
    }

    const recognition = new SpeechRecognition()
    recognition.lang = language === 'es' ? 'es-ES' : 'en-US'
    recognition.interimResults = false
    recognition.continuous = false
    recognition.maxAlternatives = 1

    transcriptRef.current = ''

    recognition.onstart = () => {
      setIsListening(true)
      onListeningChange?.(true)
    }

    recognition.onresult = (event) => {
      const result = event.results[event.results.length - 1]
      if (result.isFinal) {
        const text = result[0].transcript.trim()
        transcriptRef.current = text
      }
    }

    recognition.onend = () => {
      setIsListening(false)
      onListeningChange?.(false)
      if (transcriptRef.current && onTranscript) {
        onTranscript(transcriptRef.current)
      }
      recognitionRef.current = null
    }

    recognition.onerror = (event) => {
      console.error('Speech recognition error:', event.error)
      setIsListening(false)
      onListeningChange?.(false)
      recognitionRef.current = null
    }

    recognitionRef.current = recognition
    recognition.start()
  }, [language, disabled, onTranscript])

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop()
    }
  }, [])

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening()
    } else {
      startListening()
    }
  }, [isListening, startListening, stopListening])

  if (!supported) return null

  if (large) {
    return (
      <div className={`relative ${isListening ? 'voice-listening' : ''}`}>
        <button
          type="button"
          onClick={toggleListening}
          disabled={disabled}
          className={`relative z-10 w-20 h-20 rounded-full transition-all duration-300 flex items-center justify-center ${
            isListening
              ? 'bg-gradient-to-br from-red-500 to-rose-600 text-white shadow-lg shadow-red-500/40 scale-110'
              : disabled
                ? 'bg-slate-700/50 text-slate-500 cursor-not-allowed'
                : 'bg-gradient-to-br from-cyan-500 to-blue-600 text-white shadow-lg shadow-cyan-500/30 hover:shadow-cyan-400/50 hover:scale-105'
          }`}
          title={isListening ? 'Stop listening' : 'Speak to Nouri'}
          aria-label={isListening ? 'Stop voice input' : 'Start voice input'}
        >
          {isListening ? (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" viewBox="0 0 20 20" fill="currentColor">
              <rect x="5" y="5" width="10" height="10" rx="2" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
            </svg>
          )}
        </button>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={toggleListening}
      disabled={disabled}
      className={`p-2 rounded-full transition-all duration-200 ${
        isListening
          ? 'bg-red-500 text-white animate-pulse shadow-lg shadow-red-300'
          : disabled
            ? 'text-gray-300 cursor-not-allowed'
            : 'text-gray-500 hover:text-green-600 hover:bg-green-50'
      }`}
      title={isListening ? 'Stop listening' : 'Speak to Nouri'}
      aria-label={isListening ? 'Stop voice input' : 'Start voice input'}
    >
      {isListening ? (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
          <rect x="5" y="5" width="10" height="10" rx="1" />
        </svg>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
        </svg>
      )}
    </button>
  )
}

export default VoiceInput
