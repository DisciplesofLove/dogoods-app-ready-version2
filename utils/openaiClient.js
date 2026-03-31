import { getApiConfig } from './config.js';

/**
 * OpenAI API Client
 * Handles communication with OpenAI's API with retry and timeout support
 */
class OpenAIClient {
    constructor() {
        // Don't cache config values - get them fresh each time
    }

    _getConfig() {
        const config = getApiConfig().OPENAI;
        return config;
    }

    async chat(messages, options = {}) {
        const config = this._getConfig();
        const {
            model = config.MODELS.CHAT,
            temperature = 0.7,
            max_tokens = 1000,
            stream = false
        } = options;

        return this._makeRequest('/chat/completions', {
            model,
            messages,
            temperature,
            max_tokens,
            stream
        });
    }

    async _makeRequest(endpoint, data) {
        const config = this._getConfig();
        const headers = {
            'Authorization': `Bearer ${config.API_KEY}`,
            'Content-Type': 'application/json'
        };

        for (let attempt = 0; attempt <= config.MAX_RETRIES; attempt++) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), config.TIMEOUT);

                const response = await fetch(`${config.API_ENDPOINT}${endpoint}`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(data),
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                    let errorDetails;
                    try {
                        errorDetails = await response.json();
                    } catch (parseError) {
                        errorDetails = await response.text();
                    }
                    
                    console.error('OpenAI API Error:', {
                        status: response.status,
                        statusText: response.statusText,
                        error: errorDetails,
                        endpoint: `${config.API_ENDPOINT}${endpoint}`
                    });
                    
                    throw new Error(errorDetails.error?.message || errorDetails.message || errorDetails || `API request failed: ${response.status}`);
                }

                return await response.json();
            } catch (error) {
                if (error.name === 'AbortError') {
                    throw new Error('Request timed out');
                }
                if (attempt === config.MAX_RETRIES) {
                    throw error;
                }
                // Exponential backoff with jitter
                const backoffTime = Math.pow(2, attempt) * 1000;
                const jitter = Math.random() * 1000;
                await new Promise(resolve => setTimeout(resolve, backoffTime + jitter));
            }
        }
    }

    async testConnection() {
        try {
            const testMessages = [
                { role: 'user', content: 'Hello, respond with just "OK".' }
            ];
            const response = await this.chat(testMessages, { max_tokens: 10 });
            const content = response.choices?.[0]?.message?.content || '';
            return content.toLowerCase().includes('ok');
        } catch (error) {
            console.error('OpenAI connection test failed:', error);
            return false;
        }
    }
}

// Export a singleton instance
const openaiClient = new OpenAIClient();
export default openaiClient;
