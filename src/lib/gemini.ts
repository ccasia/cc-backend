import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { Prisma } from '@prisma/client';

export type GeminiModelName = 'gemini-1.5-flash' | 'gemini-1.5-pro' | 'gemini-2.0-flash-exp';

export const GEMINI_MODEL = (process.env.GEMINI_MODEL as GeminiModelName) || 'gemini-1.5-pro';

/**
 * Returns a configured ChatGoogleGenerativeAI instance.
 *
 * @param temperature  0–1. Low = more factual/consistent (default 0.2)
 * @param maxTokens    Max output tokens (default 1500)
 */
export function createGemini(temperature = 0.2, maxTokens = 1500): ChatGoogleGenerativeAI {
  if (!process.env.GOOGLE_API_KEY) {
    throw new Error('GOOGLE_API_KEY is not set in .env');
  }

  return new ChatGoogleGenerativeAI({
    model: 'gemini-2.5-flash',
    apiKey: process.env.GOOGLE_API_KEY,
    temperature,
    maxOutputTokens: maxTokens,
  });
}
