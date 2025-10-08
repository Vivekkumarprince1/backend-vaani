const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const translationCache = require('../lib/translationCache');

class TranslateController {
  /**
   * Translate text(s) using Azure Translator
   */
  static async translate(req, res) {
    try {
      const { text, texts, targetLang, sourceLang } = req.body;

      // Support both single text and batch texts
      const isBatch = texts && Array.isArray(texts);
      const textsToTranslate = isBatch ? texts : [text];

      if (!textsToTranslate.length || !targetLang) {
        return res.status(400).json({ error: 'Text(s) and target language are required' });
      }

      // Filter out empty texts and check if all are same language
      const validTexts = textsToTranslate.filter(t => t && t.trim());
      if (!validTexts.length) {
        return res.json(isBatch ? { translations: [] } : { translation: '' });
      }

      // If source and target are the same, return original texts
      if (sourceLang && sourceLang === targetLang) {
        console.log('💬 Same language, skipping translation for', validTexts.length, 'texts');
        if (isBatch) {
          return res.json({ translations: validTexts });
        } else {
          return res.json({ translation: validTexts[0] });
        }
      }

      // Prepare cache keys and check cache for batch
      const keys = validTexts.map(t => translationCache.makeKey(t, targetLang, sourceLang));
      const cachedMap = translationCache.getMany(keys);
      if (cachedMap.size === validTexts.length) {
        // console.log('♻️ Returning fully cached batch translations');
        const cachedTranslations = keys.map(k => cachedMap.get(k));
        if (isBatch) {
          return res.json({ translations: cachedTranslations, detectedLanguages: keys.map(() => sourceLang || null) });
        } else {
          return res.json({ translation: cachedTranslations[0], detectedLanguage: sourceLang });
        }
      }

      // Validate Azure credentials
      if (!process.env.AZURE_TRANSLATOR_KEY || !process.env.AZURE_TRANSLATOR_ENDPOINT) {
        console.error('❌ Azure Translator credentials not configured');
        return res.status(500).json({ error: 'Translation service not configured' });
      }

      console.log(`💬 Translating ${validTexts.length} chat message(s):`, {
        sample: validTexts[0]?.substring(0, 50) + (validTexts[0]?.length > 50 ? '...' : ''),
        from: sourceLang || 'auto-detect',
        to: targetLang
      });

      // Call Azure Translator API with batch support
      const url = `${process.env.AZURE_TRANSLATOR_ENDPOINT}/translate`;
      const params = {
        'api-version': '3.0',
        'to': targetLang
      };

      // Add source language if provided
      if (sourceLang) {
        params.from = sourceLang;
      }

      const response = await axios({
        method: 'post',
        url: url,
        params: params,
        headers: {
          'Ocp-Apim-Subscription-Key': process.env.AZURE_TRANSLATOR_KEY,
          'Ocp-Apim-Subscription-Region': process.env.AZURE_TRANSLATOR_REGION,
          'Content-Type': 'application/json',
          'X-ClientTraceId': uuidv4()
        },
        data: validTexts.map(text => ({ text }))
      });

      // Handle batch response
      const translations = response.data.map((item, index) => ({
        text: item.translations[0].text,
        detectedLanguage: item.detectedLanguage?.language
      }));

      // Store any uncached translations into cache
      try {
        const toSet = new Map();
        translations.forEach((t, idx) => {
          const key = translationCache.makeKey(validTexts[idx], targetLang, sourceLang);
          toSet.set(key, t.text);
        });
        translationCache.setMany(toSet);
      } catch (e) {
        // ignore cache set errors
      }

      console.log(`✅ Chat translation successful for ${translations.length} text(s):`, {
        sample: {
          original: validTexts[0]?.substring(0, 50) + (validTexts[0]?.length > 50 ? '...' : ''),
          translated: translations[0]?.text?.substring(0, 50) + (translations[0]?.text?.length > 50 ? '...' : ''),
          from: translations[0]?.detectedLanguage || sourceLang || 'auto',
          to: targetLang
        }
      });

      // Return appropriate format based on input
      if (isBatch) {
        return res.json({
          translations: translations.map(t => t.text),
          detectedLanguages: translations.map(t => t.detectedLanguage)
        });
      } else {
        return res.json({
          translation: translations[0].text,
          detectedLanguage: translations[0].detectedLanguage || sourceLang
        });
      }
    } catch (err) {
      console.error('❌ Chat translation error:', err.response?.data || err.message);
      if (err.message.includes('authorization')) {
        return res.status(401).json({ msg: err.message });
      }
      return res.status(500).json({
        error: 'Translation failed',
        details: err.response?.data || err.message
      });
    }
  }
}

module.exports = TranslateController;