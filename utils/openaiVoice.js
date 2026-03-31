import { getApiConfig } from './config.js'

/**
 * OpenAI Voice Services — Whisper STT + TTS
 */

function getApiKey() {
  const config = getApiConfig().OPENAI
  return config.API_KEY
}

/**
 * Transcribe audio using OpenAI Whisper API
 * @param {Blob} audioBlob - Audio blob (webm, mp4, wav, etc.)
 * @param {string} language - Language hint ('en' or 'es')
 * @returns {Promise<string>} - Transcribed text
 */
export async function transcribeAudio(audioBlob, language = 'en') {
  const apiKey = getApiKey()
  if (!apiKey) throw new Error('OpenAI API key not configured')

  const formData = new FormData()
  formData.append('file', audioBlob, 'audio.webm')
  formData.append('model', 'whisper-1')
  formData.append('language', language === 'es' ? 'es' : 'en')

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
    body: formData,
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Whisper API error: ${response.status} ${errorText}`)
  }

  const data = await response.json()
  return data.text || ''
}

/**
 * Generate speech audio from text using OpenAI TTS API
 * @param {string} text - Text to convert to speech
 * @param {Object} options - { voice, speed }
 * @returns {Promise<Blob>} - Audio blob (mp3)
 */
export async function textToSpeech(text, options = {}) {
  const apiKey = getApiKey()
  if (!apiKey) throw new Error('OpenAI API key not configured')

  const { voice = 'nova', speed = 1.0 } = options

  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'tts-1',
      input: text.slice(0, 4096),
      voice,
      speed,
      response_format: 'mp3',
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`TTS API error: ${response.status} ${errorText}`)
  }

  return await response.blob()
}

/**
 * Play an audio blob and return a promise that resolves when playback ends
 * @param {Blob} audioBlob - Audio blob to play
 * @param {Function} onStart - Called when playback starts
 * @param {Function} onEnd - Called when playback ends
 * @returns {{ play: Promise<void>, stop: Function }}
 */
export function playAudioBlob(audioBlob, onStart, onEnd) {
  const url = URL.createObjectURL(audioBlob)
  const audio = new Audio(url)

  const stop = () => {
    audio.pause()
    audio.currentTime = 0
    URL.revokeObjectURL(url)
    onEnd?.()
  }

  const play = new Promise((resolve) => {
    audio.onplay = () => onStart?.()
    audio.onended = () => {
      URL.revokeObjectURL(url)
      onEnd?.()
      resolve()
    }
    audio.onerror = () => {
      URL.revokeObjectURL(url)
      onEnd?.()
      resolve()
    }
    audio.play().catch(() => {
      onEnd?.()
      resolve()
    })
  })

  return { play, stop, audio }
}
