const axios = require('axios');
const { translateSpeechDirect } = require('./speechTranslationSDK');

// // Azure Speech Service configuration
// const SPEECH_KEY = process.env.AZURE_SPEECH_KEY;
// const SPEECH_REGION = process.env.AZURE_SPEECH_REGION;

// // Language code mapping for Azure Speech Service
// // Maps short codes (fr, en) to full locale codes (fr-FR, en-US)
// const languageCodeMap = {
//   // Major languages
//   'en': 'en-US',
//   'es': 'es-ES',
//   'fr': 'fr-FR',
//   'de': 'de-DE',
//   'it': 'it-IT',
//   'pt': 'pt-BR',
//   'pt-pt': 'pt-PT',
//   'ru': 'ru-RU',
//   'ja': 'ja-JP',
//   'ko': 'ko-KR',
//   'zh': 'zh-CN',
//   'zh-Hans': 'zh-CN',  // Simplified Chinese
//   'zh-Hant': 'zh-TW',  // Traditional Chinese
//   'ar': 'ar-SA',
//   'nl': 'nl-NL',
//   'pl': 'pl-PL',
//   'tr': 'tr-TR',
//   'sv': 'sv-SE',
//   'no': 'no-NO',
//   'da': 'da-DK',
//   'fi': 'fi-FI',
//   'el': 'el-GR',
//   'cs': 'cs-CZ',
//   'hu': 'hu-HU',
//   'ro': 'ro-RO',
//   'th': 'th-TH',
//   'vi': 'vi-VN',
//   'id': 'id-ID',
//   'ms': 'ms-MY',
  
//   // Indian languages
//   'hi': 'hi-IN',
//   'bn': 'bn-IN',  // Bengali
//   'pa': 'pa-IN',  // Punjabi
//   'mr': 'mr-IN',  // Marathi
//   'gu': 'gu-IN',  // Gujarati
//   'ta': 'ta-IN',  // Tamil
//   'te': 'te-IN',  // Telugu
//   'kn': 'kn-IN',  // Kannada
//   'ml': 'ml-IN',  // Malayalam
//   'or': 'or-IN',  // Odia/Oriya
//   'ur': 'ur-IN',  // Urdu
//   'as': 'as-IN',  // Assamese
// };

// // Cache for validated language codes
// const validatedLanguageCache = new Map();

// // Normalize language code
// const normalizeLanguage = (languageCode) => {
//   if (!languageCode) return null; // Don't default to English
  
//   // Check cache first
//   if (validatedLanguageCache.has(languageCode)) {
//     return validatedLanguageCache.get(languageCode);
//   }
  
//   const mappedCode = languageCodeMap[languageCode] || languageCode;
//   validatedLanguageCache.set(languageCode, mappedCode);
  
//   return mappedCode;
// };

// // Validate WAV format
// const isValidWavFormat = (buffer) => {
//   return buffer.length >= 44 && 
//          buffer.slice(0, 4).toString('ascii') === 'RIFF' && 
//          buffer.slice(8, 12).toString('ascii') === 'WAVE';
// };

// // Normalize audio data to Buffer
// const normalizeAudioData = (audioData) => {
//   if (Buffer.isBuffer(audioData)) {
//     return audioData;
//   }
  
//   if (typeof audioData === 'string') {
//     return Buffer.from(audioData, 'base64');
//   }
  
//   if (audioData instanceof ArrayBuffer) {
//     return Buffer.from(audioData);
//   }
  
//   return null;
// };

// // Use centralized speechToText implementation
// const { speechToText: centralizedSpeechToText, getValidLanguageCode } = require('./speechToTextModule')

// /**
//  * Wrapper to keep existing signature in this file
//  */
// const speechToText = async (audioBuffer, sourceLanguage, onPartialResult = null) => {
//   try {
//     // delegate to centralized implementation
//     const text = await centralizedSpeechToText(audioBuffer, sourceLanguage)
//     return { text, error: null }
//   } catch (error) {
//     console.error('Speech to text error (delegated):', error)
//     return { text: '', error: error.message || String(error) }
//   }
// }

// // ✅ OPTIMIZED: Keep-alive agent for Azure API connection pooling
// const https = require('https');
// const keepAliveAgent = new https.Agent({
//   keepAlive: true,
//   keepAliveMsecs: 30000,
//   maxSockets: 50,
//   maxFreeSockets: 10,
//   timeout: 60000
// });

// /**
//  * Translate text using Azure Translator API with CONNECTION POOLING
//  * @param {string} text - Text to translate
//  * @param {string} sourceLanguage - Source language code (short code like 'en', 'hi')
//  * @param {string} targetLanguage - Target language code (short code like 'fr', 'es')
//  * @returns {Promise<{text: string, error: string|null}>}
//  */
// // Detailed translator: returns structured { text, error }
// const translateTextDetailed = async (text, sourceLanguage, targetLanguage) => {
//   try {
//     if (!text || !text.trim()) {
//       return { text: '', error: 'No text to translate' };
//     }

//     // If source and target are the same, return original text
//     if (sourceLanguage === targetLanguage) {
//       return { text: text, error: null };
//     }

//     const axios = require('axios');
//     const { v4: uuidv4 } = require('uuid');
    
//     // Azure Translator configuration
//     const TRANSLATOR_KEY = process.env.AZURE_TRANSLATOR_KEY;
//     const TRANSLATOR_REGION = process.env.AZURE_TRANSLATOR_REGION;
//     const TRANSLATOR_ENDPOINT = process.env.AZURE_TRANSLATOR_ENDPOINT;

//     if (!TRANSLATOR_KEY || !TRANSLATOR_ENDPOINT) {
//       console.warn('⚠️ Azure Translator credentials not configured, returning original text');
//       return { text: text, error: null };
//     }

//     // Map language codes if needed (remove region codes for translator)
//     const sourceCode = sourceLanguage.split('-')[0]; // 'en-US' -> 'en'
//     const targetCode = targetLanguage.split('-')[0]; // 'fr-FR' -> 'fr'

//     console.log(`🌐 Translation Debug:`, {
//       originalText: text,
//       sourceLanguage: sourceLanguage,
//       targetLanguage: targetLanguage,
//       sourceCode: sourceCode,
//       targetCode: targetCode,
//       areSame: sourceCode === targetCode
//     });

//     // If source and target codes are the same after normalization, return original
//     if (sourceCode === targetCode) {
//       console.log(`⚠️ Source and target language are the same (${sourceCode}), returning original text`);
//       return { text: text, error: null };
//     }

//     const url = `${TRANSLATOR_ENDPOINT}/translate`;
//     const params = {
//       'api-version': '3.0',
//       'from': sourceCode,
//       'to': targetCode
//     };

//     console.log(`🌐 Translating: "${text}" from ${sourceCode} to ${targetCode}`);

//     // ✅ OPTIMIZED: Add timeout and keep-alive agent for connection pooling
//     const response = await axios({
//       method: 'post',
//       url: url,
//       params: params,
//       headers: {
//         'Ocp-Apim-Subscription-Key': TRANSLATOR_KEY,
//         'Ocp-Apim-Subscription-Region': TRANSLATOR_REGION,
//         'Content-Type': 'application/json',
//         'X-ClientTraceId': uuidv4()
//       },
//       data: [{
//         text: text
//       }],
//       timeout: 3000, // 3 second timeout for translation
//       httpsAgent: keepAliveAgent // Use connection pooling
//     });

//     const translatedText = response.data[0].translations[0].text;
//     console.log(`✅ Translation result: "${translatedText}"`);
    
//     return { text: translatedText, error: null };
//   } catch (error) {
//     console.error('Translation error:', error);
//     return { text: '', error: error.message };
//   }
// };

// // Public translator: simple string-returning wrapper to keep API convenient.
// // Returns translated string or empty string on error.
// const translateText = async (text, sourceLanguage, targetLanguage) => {
//   const result = await translateTextDetailed(text, sourceLanguage, targetLanguage);
//   return result.text || '';
// };

// /**
//  * ✅ UPDATED - Speech translation pipeline (TEXT-ONLY - no TTS)
//  * Your workflow: Speech Recognition → Text Translation → Text Display
//  * Returns only text results, no audio generation
//  * 
//  * @param {Buffer|ArrayBuffer|string} audioData - Audio data
//  * @param {string} sourceLanguage - Source language code
//  * @param {string} targetLanguage - Target language code
//  * @returns {Promise<{text: {original: string, translated: string}, error: string|null}>}
//  */
// const translateSpeech = async (audioData, sourceLanguage, targetLanguage) => {
//   try {
//     // Normalize audio data
//     const audioBuffer = normalizeAudioData(audioData);
    
//     if (!audioBuffer) {
//       return {
//         text: { original: '', translated: '' },
//         error: 'Invalid audio data'
//       };
//     }

//     // Step 1: Speech to text
//     const { text: originalText, error: sttError } = await speechToText(audioBuffer, sourceLanguage);
    
//     if (sttError || !originalText) {
//       return {
//         text: { original: '', translated: '' },
//         error: sttError || 'No speech detected'
//       };
//     }

//     console.log('Transcribed text:', originalText);

//     // Step 2: Translate text (use detailed translator so we can surface errors)
//     const { text: translatedText, error: translateError } = await translateTextDetailed(
//       originalText,
//       sourceLanguage,
//       targetLanguage
//     );
    
//     if (translateError) {
//       return {
//         text: { original: originalText, translated: '' },
//         error: translateError
//       };
//     }

//     console.log('Translated text:', translatedText);

//     // ❌ REMOVED: Text-to-speech step - using TextReader instead
//     // Your workflow ends with text translation and display

//     return {
//       text: { original: originalText, translated: translatedText },
//       error: null
//     };
//   } catch (error) {
//     console.error('Speech translation error:', error);
//     return {
//       text: { original: '', translated: '' },
//       error: error.message
//     };
//   }
// };

// /**
//  * ✅ USED IN YOUR WORKFLOW - Recognize speech from audio (voice-to-text only)
//  * This is part of your workflow: Speech Recognition → Text Translation → Text Display
//  * 
//  * @param {Buffer} audioBuffer - Audio buffer
//  * @param {string} sourceLanguage - Source language code
//  * @returns {Promise<string>} - Recognized text
//  */
/**
 * Recognize speech (voice-to-text) using the optimized Speech Translation SDK
 * Falls back to returning empty string on error
 */
const recognizeSpeech = async (audioBuffer, sourceLanguage) => {
	try {
		if (!audioBuffer) return '';
		// Use translateSpeechDirect with same source and target to get original transcription
		const src = sourceLanguage || 'en';
		try {
			const result = await translateSpeechDirect(audioBuffer, src, src);
			return (result && result.original) ? result.original : '';
		} catch (err) {
			console.warn('translateSpeechDirect failed in recognizeSpeech, falling back:', err && err.message);
			return '';
		}
	} catch (error) {
		console.error('Speech recognition error:', error);
		return '';
	}
};

// /**
//  * ✅ USED IN YOUR WORKFLOW - Translate text only (no audio)
//  * This is part of your workflow: Speech Recognition → Text Translation → Text Display
//  * 
//  * @param {string} text - Text to translate
//  * @param {string} sourceLanguage - Source language code
//  * @param {string} targetLanguage - Target language code
//  * @returns {Promise<string>} - Translated text
//  */
/**
 * Translate text using Azure Translator REST API if configured.
 * Falls back to returning original text when translator not configured.
 */
const translateTextOnly = async (text, sourceLanguage, targetLanguage) => {
	try {
		if (!text || !text.trim()) return '';

		const TRANSLATOR_KEY = process.env.AZURE_TRANSLATOR_KEY;
		const TRANSLATOR_REGION = process.env.AZURE_TRANSLATOR_REGION;
		const TRANSLATOR_ENDPOINT = process.env.AZURE_TRANSLATOR_ENDPOINT || 'https://api.cognitive.microsofttranslator.com';

		const sourceCode = sourceLanguage ? sourceLanguage.split('-')[0] : undefined;
		const targetCode = targetLanguage ? targetLanguage.split('-')[0] : undefined;

		if (!TRANSLATOR_KEY || !targetCode) {
			// No translator configured or target not provided — return original text
			return text;
		}

		const url = `${TRANSLATOR_ENDPOINT}/translate`;
		const params = {
			'api-version': '3.0',
			to: targetCode
		};
		if (sourceCode) params.from = sourceCode;

		const response = await axios.post(url, [{ Text: text }], {
			params,
			headers: {
				'Ocp-Apim-Subscription-Key': TRANSLATOR_KEY,
				'Ocp-Apim-Subscription-Region': TRANSLATOR_REGION || '',
				'Content-Type': 'application/json'
			},
			timeout: 4000
		});

		const translated = (response.data && response.data[0] && response.data[0].translations && response.data[0].translations[0] && response.data[0].translations[0].text) || '';
		return translated || text;
	} catch (error) {
		console.error('Text translation error:', error && error.message);
		return text;
	}
};

module.exports = {
	recognizeSpeech,
	translateText: translateTextOnly,
	// keep older helpers (if present) as no-op fallbacks
	normalizeLanguage: (l) => (typeof l === 'string' ? l : 'en'),
};
