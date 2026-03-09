import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

export type GeminiModelName = 'gemini-1.5-flash' | 'gemini-1.5-pro' | 'gemini-2.0-flash-exp';

export const GEMINI_MODEL = (process.env.GEMINI_MODEL as GeminiModelName) || 'gemini-1.5-pro';

/**
 * Returns a configured ChatGoogleGenerativeAI instance.
 *
 * @param temperature  0–1. Low = more factual/consistent (default 0.2)
 * @param maxTokens    Max output tokens (default 1500)
 */
export async function createGemini(temperature = 0.2, maxTokens = 1500): Promise<ChatGoogleGenerativeAI> {
  if (!process.env.GOOGLE_API_KEY) {
    throw new Error('GOOGLE_API_KEY is not set in .env');
  }

  const aiModel = await prisma.aiModel.findFirst();

  return new ChatGoogleGenerativeAI({
    model: aiModel?.model || 'gemini-2.5-flash',
    apiKey: aiModel?.apiKey || process.env.GOOGLE_API_KEY,
    temperature: aiModel?.temperature || temperature,
    maxOutputTokens: aiModel?.maxOutputTokens || maxTokens,
  });
}
