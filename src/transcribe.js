const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = process.env.JARVIS_MODEL || 'gemini-3.6-flash';

const PROMPT =
  'Transcribe the speech in this audio exactly as spoken. ' +
  'Reply with the transcript only — no preamble, quotes, or commentary. ' +
  'If there is no intelligible speech, reply with nothing at all.';

async function transcribe(base64Audio, mimeType) {
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [
      {
        role: 'user',
        parts: [
          { text: PROMPT },
          { inlineData: { mimeType: mimeType || 'audio/webm', data: base64Audio } },
        ],
      },
    ],
  });

  return (response.text || '').trim();
}

module.exports = { transcribe };
