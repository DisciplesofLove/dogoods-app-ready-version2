// Browser environment configuration
// IMPORTANT: Replace placeholder values with your actual keys
// Do NOT commit real API keys to version control
window.__ENV__ = {
    // DeepSeek Configuration
    DEEPSEEK_API_KEY: '', // Set your DeepSeek API key here
    DEEPSEEK_API_ENDPOINT: 'https://api.deepseek.com/v1',
    DEEPSEEK_MODEL_VERSION: '1.0.0',
    
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