// const sdk = require('microsoft-cognitiveservices-speech-sdk')

// // Azure Speech Service configuration
// const SPEECH_KEY = process.env.AZURE_SPEECH_KEY
// const SPEECH_REGION = process.env.AZURE_SPEECH_REGION

// // Language code mapping for Azure Speech Service
// const languageCodeMap = {
//   en: 'en-US',
//   hi: 'hi-IN',
//   es: 'es-ES',
//   fr: 'fr-FR',
//   de: 'de-DE',
//   it: 'it-IT',
//   ja: 'ja-JP',
//   ko: 'ko-KR',
//   pt: 'pt-BR',
//   ru: 'ru-RU',
//   zh: 'zh-CN',
//   pa: 'pa-IN',
//   bn: 'bn-IN',
//   mr: 'mr-IN',
//   gu: 'gu-IN',
//   kn: 'kn-IN',
//   ml: 'ml-IN',
//   or: 'or-IN',
//   ta: 'ta-IN',
//   te: 'te-IN',
//   ur: 'ur-IN',
//   as: 'as-IN',
//   sa: 'sa-IN',
//   sd: 'sd-IN',
//   ne: 'ne-NP',
//   si: 'si-LK'
// }

// // Cache for validated language codes
// const validatedLanguageCache = new Map()

// // Speech Config Pool - Reuse configs to avoid recreation overhead
// const speechConfigPool = {
//   configs: new Map(), // language -> {config, created}
//   maxAge: 600000, // 10 minutes

//   get (language) {
//     const key = language
//     if (this.configs.has(key)) {
//       const { config, created } = this.configs.get(key)
//       if (Date.now() - created < this.maxAge) {
//         return config
//       }
//       this.configs.delete(key)
//     }
//     return null
//   },

//   set (language, config) {
//     this.configs.set(language, {
//       config,
//       created: Date.now()
//     })
//     console.log(`[STT Pool] Cached speech config for ${language}`)
//   },

//   cleanup () {
//     const now = Date.now()
//     let cleaned = 0
//     for (const [key, { created }] of this.configs.entries()) {
//       if (now - created > this.maxAge) {
//         this.configs.delete(key)
//         cleaned++
//       }
//     }
//     if (cleaned > 0) {
//       console.log(`[STT Pool] Cleaned ${cleaned} old configs`)
//     }
//   }
// }

// setInterval(() => speechConfigPool.cleanup(), 300000)

// const isValidWavFormat = buffer => {
//   if (!buffer || buffer.length < 44) return false
//   try {
//     const riffHeader = buffer.slice(0, 4).toString('ascii')
//     const waveHeader = buffer.slice(8, 12).toString('ascii')
//     return riffHeader === 'RIFF' && waveHeader === 'WAVE'
//   } catch (e) {
//     return false
//   }
// }

// const getValidLanguageCode = languageCode => {
//   if (!languageCode) return 'en-US'
//   if (validatedLanguageCache.has(languageCode)) return validatedLanguageCache.get(languageCode)

//   const mappedCode = languageCodeMap[languageCode] || languageCode

//   try {
//     const tempConfig = sdk.SpeechConfig.fromSubscription(SPEECH_KEY, SPEECH_REGION)
//     tempConfig.speechRecognitionLanguage = mappedCode
//     validatedLanguageCache.set(languageCode, mappedCode)
//     return mappedCode
//   } catch (error) {
//     throw new Error(`Unsupported language code: ${languageCode}`)
//   }
// }

// const speechToText = async (audioData, sourceLanguage, maxRetries = 2) => {
//   if (!audioData) throw new Error('No audio data provided')

//   // Normalize to Buffer if ArrayBuffer
//   let buffer = audioData
//   if (audioData instanceof ArrayBuffer) buffer = Buffer.from(audioData)
//   if (!Buffer.isBuffer(buffer) && typeof buffer === 'string') buffer = Buffer.from(buffer, 'base64')

//   if (!buffer || buffer.length < 44) throw new Error('Invalid audio data')
//   if (!isValidWavFormat(buffer)) throw new Error('Invalid WAV format')

//   // Validate language
//   sourceLanguage = getValidLanguageCode(sourceLanguage)

//   let attempts = 0
//   let lastError = null

//   while (attempts < maxRetries) {
//     let recognizer = null
//     try {
//       let speechConfig = speechConfigPool.get(sourceLanguage)
//       if (!speechConfig) {
//         if (!SPEECH_KEY || !SPEECH_REGION) throw new Error('Azure Speech credentials not configured')
//         speechConfig = sdk.SpeechConfig.fromSubscription(SPEECH_KEY, SPEECH_REGION)
//         speechConfig.speechRecognitionLanguage = sourceLanguage
//         speechConfig.enableDictation && speechConfig.enableDictation()
//         speechConfig.setProperty && speechConfig.setProperty(sdk.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs, '3000')
//         speechConfig.setProperty && speechConfig.setProperty(sdk.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs, '500')
//         speechConfigPool.set(sourceLanguage, speechConfig)
//       }

//       const pushStream = sdk.AudioInputStream.createPushStream()
//       const audioConfig = sdk.AudioConfig.fromStreamInput(pushStream)
//       recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig)

//       const chunkSize = 32768
//       let offset = 44
//       for (let i = offset; i < buffer.length; i += chunkSize) {
//         const chunk = buffer.slice(i, Math.min(i + chunkSize, buffer.length))
//         pushStream.write(chunk)
//       }
//       pushStream.close()

//       const result = await new Promise((resolve, reject) => {
//         let recognizedText = ''

//         recognizer.recognizing = (s, e) => {
//           try {
//             if (e.result && e.result.text) {
//               // partial
//             }
//           } catch (e) {}
//         }

//         recognizer.recognized = (s, e) => {
//           if (e.result && e.result.reason === sdk.ResultReason.RecognizedSpeech) {
//             const text = e.result.text && e.result.text.trim()
//             if (text) recognizedText += (recognizedText ? ' ' : '') + text
//           }
//         }

//         recognizer.canceled = (s, e) => {
//           if (e.reason === sdk.CancellationReason.Error) reject(new Error(e.errorDetails || 'Recognition canceled'))
//           stopRecognition()
//         }

//         recognizer.sessionStopped = () => {
//           stopRecognition()
//         }

//         const stopRecognition = () => {
//           try {
//             recognizer.stopContinuousRecognitionAsync(() => {
//               recognizer.close()
//               resolve(recognizedText.trim())
//             })
//           } catch (e) {
//             resolve(recognizedText.trim())
//           }
//         }

//         setTimeout(() => stopRecognition(), 5000)
//         try {
//           recognizer.startContinuousRecognitionAsync()
//         } catch (e) {
//           reject(e)
//         }
//       })

//       if (!result || result.length === 0) throw new Error('No speech recognized')

//       return result
//     } catch (error) {
//       lastError = error
//       attempts++
//       console.error(`[STT] Attempt ${attempts}/${maxRetries} failed:`, error.message)
//       try { recognizer && recognizer.close && recognizer.close() } catch (e) {}
//       if (attempts < maxRetries) await new Promise(r => setTimeout(r, 200 * attempts))
//     }
//   }

//   throw lastError || new Error('Speech to text failed')
// }

// module.exports = {
//   speechToText,
//   getValidLanguageCode
// }
