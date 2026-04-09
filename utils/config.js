// Load environment variables from window.__ENV__ if available
const ENV = (typeof window !== 'undefined' && window.__ENV__) || {};

// Also check Vite env (loaded from .env.local)
const VITE_ENV = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {};

// Backend URL — used by aiChatService.js for all /api/ai/* calls
// In development: empty string (Vite proxy handles it)
// In production: set VITE_BACKEND_URL to deployed backend (e.g. https://dogoods-api.railway.app)
const BACKEND_URL = VITE_ENV.VITE_BACKEND_URL || ENV.VITE_BACKEND_URL || '';

// API Configuration
const DEEPSEEK_API_KEY = ENV.DEEPSEEK_API_KEY || VITE_ENV.VITE_DEEPSEEK_API_KEY || '';
const API_CONFIG = {
    OPENAI: {
        API_KEY: DEEPSEEK_API_KEY || ENV.OPENAI_API_KEY || VITE_ENV.VITE_OPENAI_API_KEY || VITE_ENV.OPENAI_API_KEY || '',
        API_ENDPOINT: DEEPSEEK_API_KEY ? 'https://api.deepseek.com/v1' : (ENV.OPENAI_API_ENDPOINT || 'https://api.openai.com/v1'),
        TIMEOUT: parseInt(ENV.API_TIMEOUT) || 30000, // 30 seconds
        MAX_RETRIES: parseInt(ENV.API_MAX_RETRIES) || 3,
        MODELS: {
            CHAT: ENV.OPENAI_CHAT_MODEL || (DEEPSEEK_API_KEY ? 'deepseek-chat' : 'gpt-4o-mini'),
            COMPLETION: ENV.OPENAI_COMPLETION_MODEL || (DEEPSEEK_API_KEY ? 'deepseek-chat' : 'gpt-4o-mini')
        }
    },
    BACKEND_URL,
    MAPBOX: {
        ACCESS_TOKEN: ENV.VITE_MAPBOX_TOKEN || import.meta.env.VITE_MAPBOX_TOKEN || ''
    },
    RATE_LIMITS: {
        DEFAULT: {
            maxRequests: parseInt(ENV.RATE_LIMIT_MAX_REQUESTS) || 50,
            timeWindow: parseInt(ENV.RATE_LIMIT_TIME_WINDOW) || 60 * 1000, // 1 minute
        },
        PREMIUM: {
            maxRequests: parseInt(ENV.RATE_LIMIT_PREMIUM_MAX_REQUESTS) || 100,
            timeWindow: parseInt(ENV.RATE_LIMIT_TIME_WINDOW) || 60 * 1000,
        }
    }
};

// Validate API configuration
function validateApiConfig() {
    const { OPENAI } = API_CONFIG;
    
    if (!OPENAI.API_KEY || 
        OPENAI.API_KEY === 'your-openai-api-key-here' ||
        !OPENAI.API_KEY.startsWith('sk-')) {
        console.warn('⚠️ OpenAI API key not configured. Some AI features may be limited.');
        return false;
    }
    
    console.log('✅ OpenAI API key configured:', OPENAI.API_KEY.substring(0, 10) + '...');
    return true;
}

// Get API configuration
function getApiConfig() {
    return {
        ...API_CONFIG,
        isValid: validateApiConfig()
    };
}

export { API_CONFIG, getApiConfig }; 