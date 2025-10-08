const axios = require('axios');
const https = require('https');
const { config } = require('./env');

// Keep-alive agent to reuse TCP/TLS connections for performance
const keepAliveAgent = new https.Agent({ keepAlive: true, maxSockets: 50 });

const instance = axios.create({
  timeout: config.HTTP_TIMEOUT_MS || 20000,
  httpsAgent: keepAliveAgent,
  headers: {
    'User-Agent': `vani-server/1.0`
  }
});

// Simple interceptor to handle 429 Retry-After and convert it into a structured error
instance.interceptors.response.use(
  (res) => res,
  async (err) => {
    if (err && err.response && err.response.status === 429) {
      const retryAfter = err.response.headers['retry-after'];
      const retryAfterMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : null;
      const e = new Error('Rate limited');
      e.isRetryable = true;
      e.retryAfterMs = retryAfterMs;
      e.response = err.response;
      throw e;
    }
    throw err;
  }
);

module.exports = { instance, keepAliveAgent };
