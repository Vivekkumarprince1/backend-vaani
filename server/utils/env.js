// Centralized env loader and validation
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Load .env.local or .env if present — load early and only once
const dotenvPath = (() => {
  const local = path.resolve(process.cwd(), '.env.local');
  const env = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(local)) return local;
  if (fs.existsSync(env)) return env;
  return null;
})();

if (dotenvPath) {
  const parsed = dotenv.config({ path: dotenvPath });
  if (parsed.error) {
    // continue; env may already be set in environment
  }
}

// Validate required environment variables early
const required = ['AZURE_SPEECH_KEY', 'AZURE_SPEECH_REGION'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  // Throw early — caller can catch when running in environments like tests
  const msg = `Missing required env vars: ${missing.join(', ')}`;
  // eslint-disable-next-line no-console
  console.error(msg);
  // Don't crash in dev where the file might be used for tooling; instead throw when accessed
}

const config = {
  AZURE_SPEECH_KEY: process.env.AZURE_SPEECH_KEY || '',
  AZURE_SPEECH_REGION: process.env.AZURE_SPEECH_REGION || '',
  AZURE_SPEECH_ENDPOINT: process.env.AZURE_SPEECH_ENDPOINT || '',
  AZURE_TRANSLATOR_KEY: process.env.AZURE_TRANSLATOR_KEY || '',
  AZURE_TRANSLATOR_REGION: process.env.AZURE_TRANSLATOR_REGION || '',
  AZURE_TRANSLATOR_ENDPOINT: process.env.AZURE_TRANSLATOR_ENDPOINT || 'https://api.cognitive.microsofttranslator.com',
  // MongoDB connection string
  MONGO_URI: process.env.MONGO_URI || 'mongodb://localhost:27017/vaani',

  // CORS Configuration
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['http://localhost:5173'],
  JWT_SECRET: process.env.JWT_SECRET || 'supersecretkey',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  PORT: parseInt(process.env.PORT || '3001', 10),
  SOCKET_PING_TIMEOUT: parseInt(process.env.SOCKET_PING_TIMEOUT || '30000', 10),
  SOCKET_PING_INTERVAL: parseInt(process.env.SOCKET_PING_INTERVAL || '10000', 10),
  SOCKET_MAX_HTTP_BUFFER_SIZE: parseInt(process.env.SOCKET_MAX_HTTP_BUFFER_SIZE || '10000000', 10), // 10MB

  
  // Optional flags
  CLIENT_TTS: (process.env.CLIENT_TTS || 'false').toLowerCase() === 'true',
  TTS_CONCURRENCY: parseInt(process.env.TTS_CONCURRENCY || '4', 10),
  TRANSLATION_CACHE_TTL_MS: parseInt(process.env.TRANSLATION_CACHE_TTL_MS || String(5 * 60 * 1000), 10),
  TRANSLATION_CACHE_MAX_ITEMS: parseInt(process.env.TRANSLATION_CACHE_MAX_ITEMS || '500', 10),
  HTTP_TIMEOUT_MS: parseInt(process.env.HTTP_TIMEOUT_MS || String(20 * 1000), 10),
 
};

// Small helper to require critical vars at runtime
function requireEnv(name) {
  if (!config[name]) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return config[name];
}

module.exports = { config, requireEnv };
