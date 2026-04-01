/**
 * Netlify serverless function — proxies /api/openai/* requests to OpenAI API.
 * Injects the API key server-side so it never reaches the browser in production.
 */
const handler = async (event) => {
  const apiKey = process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY;

  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'OPENAI_API_KEY not configured on server' }),
    };
  }

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
      },
    };
  }

  // Extract OpenAI API path from the original request URL
  const openaiPath = event.path.replace(/^\/?api\/openai/, '');
  const openaiUrl = `https://api.openai.com${openaiPath}`;

  const requestHeaders = {
    'Authorization': `Bearer ${apiKey}`,
  };

  const contentType = event.headers['content-type'] || event.headers['Content-Type'] || '';

  let body;
  if (event.httpMethod !== 'GET' && event.body) {
    if (contentType.includes('multipart/form-data')) {
      // Multipart (Whisper transcription) — forward raw binary
      requestHeaders['Content-Type'] = contentType;
      body = event.isBase64Encoded
        ? Buffer.from(event.body, 'base64')
        : Buffer.from(event.body, 'utf-8');
    } else {
      // JSON body (chat completions, TTS)
      requestHeaders['Content-Type'] = contentType || 'application/json';
      body = event.body;
    }
  }

  try {
    const response = await fetch(openaiUrl, {
      method: event.httpMethod,
      headers: requestHeaders,
      body,
    });

    const resContentType = response.headers.get('content-type') || '';

    // Binary response (TTS audio)
    if (resContentType.includes('audio') || resContentType.includes('octet-stream')) {
      const arrayBuffer = await response.arrayBuffer();
      return {
        statusCode: response.status,
        headers: {
          'Content-Type': resContentType,
          'Access-Control-Allow-Origin': '*',
        },
        body: Buffer.from(arrayBuffer).toString('base64'),
        isBase64Encoded: true,
      };
    }

    // JSON / text response
    const responseBody = await response.text();
    return {
      statusCode: response.status,
      headers: {
        'Content-Type': resContentType || 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: responseBody,
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Failed to proxy request to OpenAI', message: err.message }),
    };
  }
};

module.exports = { handler };
