import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export const translateText = async (text: string, targetLang: string): Promise<string> => {
  const langMap: Record<string, string> = {
    'it': 'Italian',
    'en': 'English',
    'fr': 'French',
    'de': 'German',
    'es': 'Spanish',
    'ja': 'Japanese',
    'zh': 'Chinese',
    'ru': 'Russian'
  };
  const targetLangName = langMap[targetLang.toLowerCase()] || targetLang;
  
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Translate the following text into ${targetLangName}. 
      IMPORTANT: Return ONLY the translated text. Do not include any introductory phrases, quotes, or explanations.
      Text to translate: "${text}"`,
    });
    const translated = response.text?.trim();
    return translated || text;
  } catch (error) {
    console.error("Translation error:", error);
    return text; // Fallback to original text
  }
};

export const detectLanguage = async (text: string): Promise<string> => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Detect the language of the following text. Return ONLY the two-letter ISO 639-1 language code (e.g., 'it', 'en', 'fr', 'es'). If unsure, return 'en': "${text}"`,
    });
    const detected = response.text?.trim().toLowerCase() || "en";
    // Ensure we only return the first 2 characters to be safe
    return detected.slice(0, 2);
  } catch (error) {
    console.error("Language detection error:", error);
    return "en";
  }
};

export const searchLocations = async (query: string): Promise<{ name: string, url: string }[]> => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Given the search query "${query}", provide 5 real-world location suggestions (like car rental offices, airports, or landmarks). 
      For each suggestion, provide a name and a valid Google Maps search URL (e.g., https://www.google.com/maps/search/?api=1&query=...).
      Return the result as a JSON array of objects with "name" and "url" properties.`,
      config: {
        responseMimeType: "application/json",
      }
    });
    
    const text = response.text || "[]";
    return JSON.parse(text);
  } catch (error) {
    console.error("Location search error:", error);
    return [];
  }
};
