/**
 * Handle group call audio translation functionality
 * Supports multiple participants with speaker detection and per-user translation
 * Workflow: Speech Recognition → Text Translation → Text Display (TextReader)
 */
const { recognizeSpeech, translateText } = require('../utils/speechTranslator');
const { textToSpeech } = require('../utils/textToSpeechModule');
const { translateSpeechToMultipleLanguages } = require('../utils/speechTranslationSDK');

const handleGroupCallAudioTranslation = (io, socket, users) => {
  
  // Handle speech recognition for group calls (speaker's audio to text)
  socket.on('groupCallRecognizeSpeech', async (data) => {
    try {
      const { audio, sourceLanguage, callRoomId, requestId, audioFormat } = data;
      const speakerId = socket.user.userId;
      const speakerName = socket.user.username;
      const speakerInfo = users?.[socket.id] || {};
      const preferredSpeakerLanguage = speakerInfo.preferredLanguage || sourceLanguage || 'en';

      console.log('\n🎤 [GROUP CALL] Speech Recognition');
      console.log(`   👤 Speaker: ${speakerName} (${speakerId})`);
      console.log(`   📝 Preferred language: ${preferredSpeakerLanguage}`);
      console.log(`   🏠 Call Room: ${callRoomId}`);
      console.log(`   🆔 Request: ${requestId || 'none'}`);
      console.log(`   🎛️ Audio format: ${audioFormat || 'unknown'}`);
      
      // Validate input data
      if (!audio || audio.length < 100) {
        console.warn('Invalid audio data received');
        socket.emit('groupCallError', { 
          message: 'Invalid audio data',
          requestId
        });
        return;
      }

      if (!callRoomId) {
        console.warn('Call room ID missing');
        socket.emit('groupCallError', { 
          message: 'Call room ID required',
          requestId
        });
        return;
      }
      
      // Convert base64 to buffer
      let audioBuffer;
      try {
        audioBuffer = Buffer.from(audio, 'base64');
      } catch (err) {
        console.error('Error decoding audio data:', err);
        socket.emit('groupCallError', { 
          message: 'Invalid audio data format',
          requestId
        });
        return;
      }
      // Debug: inspect audio buffer
      try {
        console.log('🔊 Incoming audio buffer size:', audioBuffer.length);
        if (audioBuffer.length >= 12) {
          console.log('🔊 WAV header:', audioBuffer.slice(0,12).toString('ascii'));
        }
      } catch (dbgErr) {
        console.warn('Failed to inspect audio buffer:', dbgErr);
      }
      
      // FAST PATH: Use optimized Azure Speech Translation SDK to do STT + multi-target translation in one call
      // Collect preferred languages for participants (skip speaker)
      const roomSocketList = await io.in(callRoomId).fetchSockets();
      const targetLanguages = [];
      for (const participantSocket of roomSocketList) {
        if (participantSocket.id === socket.id) continue;
        const participant = users[participantSocket.id];
        if (participant) {
          const lang = participant.preferredLanguage || preferredSpeakerLanguage || 'en';
          targetLanguages.push(lang);
        }
      }

      // Normalize to short language codes and remove empties
      const normalizedTargetLanguages = Array.from(
        new Set(
          targetLanguages
            .map(l => (typeof l === 'string' && l ? l.split('-')[0] : 'en'))
            .filter(Boolean)
        )
      );

      console.log('🔎 Normalized target languages for batch:', normalizedTargetLanguages);

      let multiResult = null;
      try {
        if (normalizedTargetLanguages.length > 0) {
          console.log('Calling translateSpeechToMultipleLanguages with targets:', normalizedTargetLanguages);
          multiResult = await translateSpeechToMultipleLanguages(
            audioBuffer,
            preferredSpeakerLanguage,
            normalizedTargetLanguages
          );
          console.log('translateSpeechToMultipleLanguages result keys:', multiResult && Object.keys(multiResult));
          if (multiResult && multiResult.translations) {
            console.log('translateSpeechToMultipleLanguages translations keys:', Object.keys(multiResult.translations));
          }
        } else {
          console.log('No target languages found for multi-translation, skipping batch call');
        }
      } catch (sdkErr) {
        console.error('translateSpeechToMultipleLanguages failed:', sdkErr);
      }

      // If batch translation failed or returned no original text, fall back to STT-only
      let recognizedText = (multiResult && multiResult.original) ? multiResult.original : '';
      if (!recognizedText || !recognizedText.trim()) {
        try {
          console.log('Falling back to single STT recognition (recognizeSpeech)');
          const sttText = await recognizeSpeech(audioBuffer, preferredSpeakerLanguage);
          console.log('Fallback STT result:', sttText);
          recognizedText = sttText || '';
        } catch (sttErr) {
          console.error('Fallback STT failed:', sttErr);
        }
      }

      if (!recognizedText || !recognizedText.trim()) {
        console.log('No speech detected or empty transcription (after fallback)');
        return;
      }

  console.log(`✅ Speech recognized: "${recognizedText}"`);
  // Ensure speakerName is set
  const safeSpeakerName = speakerName || 'Unknown';
      
      // Send transcript to speaker (original text)
      socket.emit('groupCallTranscript', {
        text: recognizedText,
        speakerId,
        speakerName,
        language: preferredSpeakerLanguage,
        isOriginal: true,
        requestId
      });
      
      // Get all participants in the call room
      const roomSockets = await io.in(callRoomId).fetchSockets();
      console.log(`📤 Found ${roomSockets.length - 1} other participants in room ${callRoomId}`);

      // Send the original text to all other participants for display immediately
      for (const participantSocket of roomSockets) {
        if (participantSocket.id !== socket.id) {
          const participant = users[participantSocket.id];
          // emit original text for UI (no translation yet)
          participantSocket.emit('groupCallOriginalText', {
            text: recognizedText,
            sourceLanguage: preferredSpeakerLanguage,
            speakerId,
            speakerName,
            requestId
          });
        }
      }

      // Proactively translate + TTS per language group and broadcast to participants
      (async () => {
        try {
          // Build map: language -> [participantSocket]
          const langMap = new Map();
          for (const participantSocket of roomSockets) {
            if (participantSocket.id === socket.id) continue;
            const participant = users[participantSocket.id];
            if (!participant) continue;
            const lang = (participant.preferredLanguage || preferredSpeakerLanguage || 'en').split('-')[0];
            if (!langMap.has(lang)) langMap.set(lang, []);
            langMap.get(lang).push(participantSocket);
          }

          // For each language, determine translated text and synthesize concurrently
          // We'll generate all TTS in parallel, wait for them, then emit all payloads
          // so clients receive audio at nearly the same time.
          const entries = []; // { lang, socketsForLang, promise }
          for (const [lang, socketsForLang] of langMap.entries()) {
            const promise = (async () => {
              let finalText = recognizedText;
              try {
                if (multiResult && multiResult.translations && multiResult.translations[lang]) {
                  finalText = multiResult.translations[lang];
                } else if (lang !== (preferredSpeakerLanguage || 'en').split('-')[0]) {
                  // Fallback to single translation
                  const translated = await translateText(recognizedText, preferredSpeakerLanguage, lang);
                  if (translated) finalText = translated;
                }
              } catch (tErr) {
                console.error('Translation error for language', lang, tErr);
              }

              // Use cached synthesize helper when available to reduce duplicate work
              const { getCachedOrSynthesize } = require('../../server/utils/textToSpeechModule');

              let ttsBuffer = null;
              try {
                ttsBuffer = await getCachedOrSynthesize(finalText, lang);
              } catch (ttsErr) {
                console.error('TTS error for language', lang, ttsErr);
              }

              const audioBase64 = ttsBuffer ? ttsBuffer.toString('base64') : null;
              return { lang, finalText, audioBase64 };
            })();

            entries.push({ lang, socketsForLang, promise });
          }

          // Wait for all TTS promises to settle
          const settled = await Promise.allSettled(entries.map(e => e.promise));

          // After all TTS are generated (or attempted), emit payloads in a tight loop
          for (let i = 0; i < entries.length; i++) {
            const { lang, socketsForLang } = entries[i];
            const res = settled[i];
            if (res.status !== 'fulfilled') {
              console.warn('TTS generation failed for language', lang, res.reason || res);
              // Still emit text-only payload to participants for UI fallback
              for (const pSocket of socketsForLang) {
                pSocket.emit('groupCallTranslatedSpeech', {
                  originalText: recognizedText,
                  translatedText: recognizedText,
                  audio: null,
                  sourceLanguage: preferredSpeakerLanguage,
                  targetLanguage: lang,
                  speakerId,
                  speakerName,
                  requestId
                });
              }
              continue;
            }

            const { finalText, audioBase64 } = res.value || { finalText: recognizedText, audioBase64: null };
            for (const pSocket of socketsForLang) {
              try {
                pSocket.emit('groupCallTranslatedSpeech', {
                  originalText: recognizedText,
                  translatedText: finalText,
                  audio: audioBase64,
                  sourceLanguage: preferredSpeakerLanguage,
                  targetLanguage: lang,
                  speakerId,
                  speakerName,
                  requestId
                });
              } catch (emitErr) {
                console.warn('Failed to emit translated speech to socket', pSocket.id, emitErr);
              }
            }
          }

          console.log(`🔁 Per-language TTS broadcast completed for ${langMap.size} languages (room ${callRoomId})`);
        } catch (err) {
          console.error('Error in per-language translation/TTS loop:', err);
        }
      })();
      
    } catch (error) {
      console.error('Error in group call speech recognition:', error);
      socket.emit('groupCallError', {
        message: 'Speech recognition failed',
        requestId: data.requestId
      });
    }
  });
  
  // Handle translation request for received text in group calls
  socket.on('groupCallTranslateText', async (data) => {
    try {
      const { text, sourceLanguage, targetLanguage, speakerId, speakerName, requestId } = data;
      const listenerId = socket.user.userId;
      const listenerName = socket.user.username;
      
      console.log('\n🌍 [GROUP CALL] Text Translation');
      console.log(`   👤 Speaker: ${speakerName} (${speakerId})`);
      console.log(`   👂 Listener: ${listenerName} (${listenerId})`);
      console.log(`   📝 ${sourceLanguage} → ${targetLanguage}`);
      console.log(`   💬 Text: "${text}"`);
      
      if (!text || !text.trim()) {
        console.warn('Empty text for translation');
        return;
      }
      
      // If target language is same as source, no translation needed
      if (sourceLanguage === targetLanguage) {
        socket.emit('groupCallTranslatedText', {
          originalText: text,
          translatedText: text,
          sourceLanguage,
          targetLanguage,
          speakerId,
          speakerName,
          requestId
        });
        return;
      }
      
      // Translate text server-side
      const translatedText = await translateText(text, sourceLanguage, targetLanguage);

      if (!translatedText) {
        console.error('Translation failed');
        socket.emit('groupCallError', {
          message: 'Translation failed',
          requestId
        });
        return;
      }

      console.log(`✅ Translated: "${translatedText}"`);

      // Generate server-side TTS and send audio back to listener
      let ttsBuffer = null;
      try {
        ttsBuffer = await textToSpeech(translatedText, targetLanguage);
      } catch (ttsErr) {
        console.error('TTS failed for group call translation:', ttsErr);
      }

      const audioBase64 = ttsBuffer ? ttsBuffer.toString('base64') : null;

      // Emit a combined payload (text + audio) to the requesting listener only
      socket.emit('groupCallTranslatedSpeech', {
        originalText: text,
        translatedText,
        audio: audioBase64,
        sourceLanguage,
        targetLanguage,
        speakerId,
        speakerName,
        requestId
      });
      
    } catch (error) {
      console.error('Error in group call text translation:', error);
      socket.emit('groupCallError', {
        message: 'Translation failed',
        requestId: data.requestId
      });
    }
  });
};

module.exports = handleGroupCallAudioTranslation;
