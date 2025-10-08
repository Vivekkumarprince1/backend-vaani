import { NextResponse } from 'next/server';
import { authenticate } from '@/lib/auth';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import translationCache from '@/lib/translationCache';

// Azure Translator configuration
const AZURE_TRANSLATOR_KEY = process.env.AZURE_TRANSLATOR_KEY;
const AZURE_TRANSLATOR_REGION = process.env.AZURE_TRANSLATOR_REGION;
const AZURE_TRANSLATOR_ENDPOINT = process.env.AZURE_TRANSLATOR_ENDPOINT;

export async function POST(request) {
  try {
    authenticate(request);
    const { text, targetLanguage, sourceLanguage } = await request.json();

    if (!text || !targetLanguage) {
      return NextResponse.json({ error: 'Text and target language are required' }, { status: 400 });
    }

    // If source and target are the same, return original text
    if (sourceLanguage === targetLanguage) {
      return NextResponse.json({
        text: text,
        to: targetLanguage,
        from: sourceLanguage
      });
    }

    // Try cache
    const cacheKey = translationCache.makeKey(text, targetLanguage, sourceLanguage);
    const cached = translationCache.get(cacheKey);
    if (cached) {
      console.log('♻️ Returning cached translation');
      return NextResponse.json({ text: cached, to: targetLanguage, from: sourceLanguage });
    }

    console.log('🌐 Translating text:', {
      text: text.substring(0, 50) + (text.length > 50 ? '...' : ''),
      from: sourceLanguage || 'auto',
      to: targetLanguage
    });

    // Call Azure Translator API
    const url = `${AZURE_TRANSLATOR_ENDPOINT}/translate`;
    const params = {
      'api-version': '3.0',
      'to': targetLanguage
    };

    // Add source language if provided
    if (sourceLanguage) {
      params.from = sourceLanguage;
    }

    const response = await axios({
      method: 'post',
      url: url,
      params: params,
      headers: {
        'Ocp-Apim-Subscription-Key': AZURE_TRANSLATOR_KEY,
        'Ocp-Apim-Subscription-Region': AZURE_TRANSLATOR_REGION,
        'Content-Type': 'application/json',
        'X-ClientTraceId': uuidv4()
      },
      data: [{
        text: text
      }]
    });

  const translatedText = response.data[0].translations[0].text;
    const detectedLanguage = response.data[0].detectedLanguage?.language;

    console.log('✅ Translation successful:', {
      original: text.substring(0, 50) + (text.length > 50 ? '...' : ''),
      translated: translatedText.substring(0, 50) + (translatedText.length > 50 ? '...' : ''),
      from: detectedLanguage || sourceLanguage,
      to: targetLanguage
    });

    // Store in cache
    try { translationCache.set(cacheKey, translatedText); } catch (e) {}

    return NextResponse.json({
      text: translatedText,
      to: targetLanguage,
      from: detectedLanguage || sourceLanguage
    });
  } catch (err) {
    console.error('❌ Error translating text:', err.response?.data || err.message);
    if (err.message.includes('authorization')) {
      return NextResponse.json({ msg: err.message }, { status: 401 });
    }
    return NextResponse.json({ 
      error: 'Failed to translate text',
      details: err.response?.data || err.message 
    }, { status: 500 });
  }
}