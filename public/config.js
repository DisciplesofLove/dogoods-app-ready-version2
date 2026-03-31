// Browser environment configuration
// IMPORTANT: Replace placeholder values with your actual keys
// Do NOT commit real API keys to version control
window.__ENV__ = {
    // OpenAI Configuration
    OPENAI_API_KEY: '', // Set your OpenAI API key here or in .env.local
    OPENAI_API_ENDPOINT: 'https://api.openai.com/v1',
    OPENAI_CHAT_MODEL: 'gpt-4o-mini',
    
    // Mapbox Configuration
    VITE_MAPBOX_TOKEN: '', // Set your Mapbox token here
    
    // API Settings
    API_TIMEOUT: '30000',
    API_MAX_RETRIES: '3',
    
    // Rate Limiting
    RATE_LIMIT_MAX_REQUESTS: '50',
    RATE_LIMIT_PREMIUM_MAX_REQUESTS: '100',
    RATE_LIMIT_TIME_WINDOW: '60000',
    
    // Feature Flags
    ENABLE_MOCK_RESPONSES: 'false',
    DEBUG_MODE: 'false'
}; 