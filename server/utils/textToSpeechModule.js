const sdk = require('microsoft-cognitiveservices-speech-sdk');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Azure Speech Service configuration
const SPEECH_KEY = process.env.AZURE_SPEECH_KEY;
const SPEECH_REGION = process.env.AZURE_SPEECH_REGION;
const SPEECH_ENDPOINT = process.env.AZURE_SPEECH_ENDPOINT || `https://${SPEECH_REGION}.api.cognitive.microsoft.com/sts/v1.0/issuetoken`;

console.log('Azure Speech Service Configuration (Text-to-Speech) [next]:');
console.log('Region:', SPEECH_REGION);
console.log('Endpoint:', SPEECH_ENDPOINT);
console.log('Key:', SPEECH_KEY ? '****' + SPEECH_KEY.slice(-4) : 'Not configured');

const voiceMap = {
  'en': 'en-US-JennyNeural',
  'hi': 'hi-IN-SwaraNeural',
  'es': 'es-ES-ElviraNeural',
  'fr': 'fr-FR-DeniseNeural',
  'de': 'de-DE-KatjaNeural',
  'it': 'it-IT-ElsaNeural',
  'ja': 'ja-JP-NanamiNeural',
  'ko': 'ko-KR-SunHiNeural',
  'pt': 'pt-BR-FranciscaNeural',
  'ru': 'ru-RU-SvetlanaNeural',
  'zh': 'zh-CN-XiaoxiaoNeural',
  'ar': 'ar-SA-ZariyahNeural',
  'ta': 'ta-IN-PallaviNeural',
  'te': 'te-IN-ShrutiNeural',
  'bn': 'bn-IN-TanishaaNeural',
  'gu': 'gu-IN-DhwaniNeural',
  'kn': 'kn-IN-SapnaNeural',
  'ml': 'ml-IN-SobhanaNeural',
  'mr': 'mr-IN-AarohiNeural',
  'pa': 'pa-IN-VaaniNeural',
  'ur': 'ur-IN-GulNeural'
};

const getVoiceFromLanguage = (languageCode) => {
  if (!languageCode) return null;
  const code = languageCode.toLowerCase().split('-')[0];
  return voiceMap[code] || null;
};

const testAzureSpeechConnection = async () => {
  try {
    if (!SPEECH_KEY || !SPEECH_REGION) {
      console.error('Azure Speech Service credentials not configured for connection test');
      return false;
    }

    const speechConfig = sdk.SpeechConfig.fromSubscription(SPEECH_KEY, SPEECH_REGION);
    speechConfig.speechSynthesisVoiceName = 'en-US-JennyNeural';
    const synthesizer = new sdk.SpeechSynthesizer(speechConfig);

    const result = await new Promise((resolve, reject) => {
      synthesizer.speakTextAsync('Test',
        result => {
          synthesizer.close();
          resolve(result);
        },
        error => {
          synthesizer.close();
          reject(error);
        }
      );
    });

    return result && result.reason === sdk.ResultReason.SynthesizingAudioCompleted;
  } catch (error) {
    console.error('Azure Speech Service connection test failed:', error);
    return false;
  }
};

const textToSpeech = async (text, targetLanguage, maxRetries = 3) => {
  if (!text || typeof text !== 'string') {
    throw new Error('Invalid or empty text input');
  }

  text = text.trim();
  if (text.length === 0) throw new Error('Empty text input');
  if (text.length < 3 && !text.endsWith('.')) text = text + '.';

  let attempts = 0;
  let lastError = null;

  if (attempts === 0) {
    try {
      const ok = await testAzureSpeechConnection();
      if (!ok) console.warn('Azure Speech Service connection test failed before synthesis');
    } catch (e) {
      console.error('Error testing Azure connection:', e);
    }
  }

  while (attempts < maxRetries) {
    try {
      if (!SPEECH_KEY || !SPEECH_REGION) {
        throw new Error('Azure Speech Service credentials not configured');
      }

      const speechConfig = sdk.SpeechConfig.fromSubscription(SPEECH_KEY, SPEECH_REGION);
      speechConfig.setServiceProperty('endpoint', SPEECH_ENDPOINT, sdk.ServicePropertyChannel.UriQueryParameter);

      const standardizedLanguage = targetLanguage || 'en-US';
      const voiceName = getVoiceFromLanguage(standardizedLanguage);
      if (!voiceName) {
        console.warn(`No voice found for language: ${standardizedLanguage}, falling back to English`);
        speechConfig.speechSynthesisVoiceName = 'en-US-JennyNeural';
      } else {
        speechConfig.speechSynthesisVoiceName = voiceName;
      }
      console.log(`🔍 TTS: Using voice: ${speechConfig.speechSynthesisVoiceName}`);

      // Use a faster / lighter audio format for lower latency and smaller payloads.
      // Default to 24kHz @ 48Kbit/s mono MP3 which is a good balance of speed and quality.
      // Optionally override with AUDIO_FORMAT env var: '16k-32k' for Audio16Khz32KBitRateMonoMp3
      const preferredFormat = process.env.AZURE_TTS_AUDIO_FORMAT || '24k-48k';
      if (preferredFormat === '16k-32k') {
        speechConfig.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Audio16Khz32KBitRateMonoMp3;
      } else {
        speechConfig.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Audio24Khz48KBitRateMonoMp3;
      }

      // Use null audio config to receive audio in-memory via result.audioData
      const synthesizer = new sdk.SpeechSynthesizer(speechConfig, null);

      return await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          try { synthesizer.close(); } catch (e) {}
          reject(new Error('Text-to-speech operation timed out'));
        }, 10000);

        const ssmlLangCode = standardizedLanguage.includes('-') ? standardizedLanguage : (voiceName ? voiceName.split('-').slice(0,2).join('-') : standardizedLanguage + '-' + standardizedLanguage.toUpperCase());

        const ssml = `
          <speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${ssmlLangCode}">
            <voice name="${speechConfig.speechSynthesisVoiceName}">
              ${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}
            </voice>
          </speak>
        `;

        synthesizer.speakSsmlAsync(
          ssml,
          result => {
            clearTimeout(timeoutId);
            try { synthesizer.close(); } catch (e) {}

            console.log(`🔍 TTS: Synthesizer result callback called, result.reason: ${result && result.reason}`);

            if (result && result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
              try {
                // result.audioData is a Uint8Array-like; convert to Buffer
                const audioData = Buffer.from(result.audioData || []);
                if (audioData.length === 0) {
                  reject(new Error('Generated audio is empty'));
                } else {
                  console.log(`🔍 TTS: Generated ${audioData.length} bytes in-memory`);
                  resolve(audioData);
                }
              } catch (convErr) {
                reject(convErr);
              }
            } else {
              const details = result && result.errorDetails ? result.errorDetails : 'Unknown TTS error';
              reject(new Error(`TTS failed: ${details}`));
            }
          },
          error => {
            clearTimeout(timeoutId);
            try { synthesizer.close(); } catch (e) {}
            reject(error);
          }
        );
      });

    } catch (error) {
      lastError = error;
      attempts++;
      if (attempts < maxRetries) {
        const backoff = Math.min(1000 * Math.pow(2, attempts), 8000);
        await new Promise(r => setTimeout(r, backoff));
      } else {
        throw lastError || new Error('Text-to-speech failed after multiple attempts');
      }
    }
  }
};

// Simple in-memory cache for TTS results. Uses insertion-order Map as a
// lightweight LRU approximation: when cache exceeds MAX_CACHE_SIZE we
// delete the oldest entry.
const crypto = require('crypto');
const ttsCache = new Map();
const MAX_CACHE_SIZE = parseInt(process.env.AZURE_TTS_CACHE_SIZE || '100', 10);

// Normalize text for cache keys to avoid misses due to small differences.
const normalizeText = (t) => {
  if (!t) return '';
  // trim, collapse whitespace, lowercase, remove trailing punctuation
  return t.trim().replace(/\s+/g, ' ').replace(/[.?!]+$/g, '').toLowerCase();
};

const getCachedOrSynthesize = async (text, language) => {
  if (!text || typeof text !== 'string') throw new Error('Invalid text for TTS');

  const normalized = normalizeText(text);
  const keyPlain = `${language || 'en'}:${normalized}`;
  const key = crypto.createHash('sha1').update(keyPlain).digest('hex');

  if (ttsCache.has(key)) {
    const val = ttsCache.get(key);
    // update recency
    ttsCache.delete(key);
    ttsCache.set(key, val);
    console.log(`✅ TTS cache HIT (key=${key}, text="${normalized}") size=${ttsCache.size}`);
    return val;
  }

  console.log(`❌ TTS cache MISS (text="${normalized}") - synthesizing`);
  const audio = await textToSpeech(text, language);

  if (ttsCache.size >= MAX_CACHE_SIZE) {
    const firstKey = ttsCache.keys().next().value;
    try { ttsCache.delete(firstKey); } catch (e) {}
    console.log('🔁 TTS cache evicted key:', firstKey);
  }

  ttsCache.set(key, audio);
  console.log(`➕ TTS cached (key=${key}) new size=${ttsCache.size}`);
  return audio;
};

module.exports = {
  textToSpeech,
  testAzureSpeechConnection,
  // Cache-related helpers and objects
  getCachedOrSynthesize,
  ttsCache,
  MAX_CACHE_SIZE
};
