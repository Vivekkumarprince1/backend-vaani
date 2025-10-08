import { NextResponse } from 'next/server';
import { authenticate } from '@/lib/auth';

// Azure Translator configuration
const AZURE_TRANSLATOR_KEY = process.env.AZURE_TRANSLATOR_KEY;
const AZURE_TRANSLATOR_REGION = process.env.AZURE_TRANSLATOR_REGION;
const AZURE_TRANSLATOR_ENDPOINT = process.env.AZURE_TRANSLATOR_ENDPOINT;

// Cache for languages to avoid hitting Azure API on every request
let cachedLanguages = null;
let cacheTimestamp = null;
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

export async function GET(request) {
  try {
    authenticate(request);

    // Return cached languages if available and not expired
    if (cachedLanguages && cacheTimestamp && (Date.now() - cacheTimestamp < CACHE_DURATION)) {
      console.log('📦 Returning cached languages');
      return NextResponse.json(cachedLanguages);
    }

    // Fetch languages from Azure Translator API
    // console.log('🌐 Fetching languages from Azure Translator API');
    
    const response = await fetch(
      `${AZURE_TRANSLATOR_ENDPOINT}/languages?api-version=3.0&scope=translation`,
      {
        method: 'GET',
        headers: {
          'Ocp-Apim-Subscription-Key': AZURE_TRANSLATOR_KEY,
          'Ocp-Apim-Subscription-Region': AZURE_TRANSLATOR_REGION,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!response.ok) {
      throw new Error(`Azure API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    // Extract translation languages
    const translationLanguages = data.translation || {};
    
    // Filter and format languages (prioritize popular ones)
    const priorityLanguages = ['en', 'hi', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh-Hans', 'ar', 'bn', 'pa', 'mr', 'gu', 'ta', 'te', 'kn', 'ml', 'ur', 'nl', 'pl', 'tr', 'th', 'vi', 'id'];
    
    const formattedLanguages = {};
    
    // Add priority languages first
    priorityLanguages.forEach(code => {
      if (translationLanguages[code]) {
        formattedLanguages[code] = translationLanguages[code];
      }
    });
    
    // Add remaining languages
    Object.keys(translationLanguages).forEach(code => {
      if (!formattedLanguages[code]) {
        formattedLanguages[code] = translationLanguages[code];
      }
    });

    // Cache the result
    cachedLanguages = formattedLanguages;
    cacheTimestamp = Date.now();

    // console.log(`✅ Successfully fetched ${Object.keys(formattedLanguages).length} languages from Azure`);
    
    return NextResponse.json(formattedLanguages);
  } catch (err) {
    console.error('❌ Error getting languages:', err);
    if (err.message.includes('authorization')) {
      return NextResponse.json({ msg: err.message }, { status: 401 });
    }
    
    // Return fallback languages if Azure API fails
    console.log('⚠️ Returning fallback language list');
    const fallbackLanguages = {
      en: { name: 'English', nativeName: 'English', dir: 'ltr' },
      es: { name: 'Spanish', nativeName: 'Español', dir: 'ltr' },
      fr: { name: 'French', nativeName: 'Français', dir: 'ltr' },
      de: { name: 'German', nativeName: 'Deutsch', dir: 'ltr' },
      it: { name: 'Italian', nativeName: 'Italiano', dir: 'ltr' },
      pt: { name: 'Portuguese', nativeName: 'Português', dir: 'ltr' },
      ru: { name: 'Russian', nativeName: 'Русский', dir: 'ltr' },
      ja: { name: 'Japanese', nativeName: '日本語', dir: 'ltr' },
      ko: { name: 'Korean', nativeName: '한국어', dir: 'ltr' },
      'zh-Hans': { name: 'Chinese Simplified', nativeName: '中文 (简体)', dir: 'ltr' },
      ar: { name: 'Arabic', nativeName: 'العربية', dir: 'rtl' },
      hi: { name: 'Hindi', nativeName: 'हिन्दी', dir: 'ltr' },
      bn: { name: 'Bengali', nativeName: 'বাংলা', dir: 'ltr' },
      pa: { name: 'Punjabi', nativeName: 'ਪੰਜਾਬੀ', dir: 'ltr' },
      mr: { name: 'Marathi', nativeName: 'मराठी', dir: 'ltr' },
      gu: { name: 'Gujarati', nativeName: 'ગુજરાતી', dir: 'ltr' },
      ta: { name: 'Tamil', nativeName: 'தமிழ்', dir: 'ltr' },
      te: { name: 'Telugu', nativeName: 'తెలుగు', dir: 'ltr' },
      kn: { name: 'Kannada', nativeName: 'ಕನ್ನಡ', dir: 'ltr' },
      ml: { name: 'Malayalam', nativeName: 'മലയാളം', dir: 'ltr' },
      ur: { name: 'Urdu', nativeName: 'اردو', dir: 'rtl' }
    };
    return NextResponse.json(fallbackLanguages);
  }
}