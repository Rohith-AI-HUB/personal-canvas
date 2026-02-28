import Groq from 'groq-sdk';
import fs from 'fs';
import 'dotenv/config';

// ─────────────────────────────────────────────
// Client (lazy singleton — only constructed on first call so
// the server can boot without a key configured for testing)
// ─────────────────────────────────────────────
let _client: Groq | null = null;

function getClient(): Groq {
  if (!_client) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey || apiKey === 'your_groq_api_key_here') {
      throw new Error('GROQ_API_KEY is not set in .env');
    }
    _client = new Groq({ apiKey });
  }
  return _client;
}

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
export type AICategory =
  | 'Research'
  | 'Tutorial'
  | 'Reference'
  | 'Personal'
  | 'Project'
  | 'Media'
  | 'Code'
  | 'Other';

export interface AIMetadata {
  title: string;
  summary: string;
  category: AICategory;
  tags: string[];
}

const FALLBACK_METADATA: AIMetadata = {
  title: '',
  summary: '',
  category: 'Other',
  tags: [],
};

const DEFAULT_TEXT_MODEL = process.env.GROQ_TEXT_MODEL?.trim() || 'llama-3.3-70b-versatile';

// ─────────────────────────────────────────────
// AI Tagging
// ─────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a file classification assistant.
Given content from a file, return a JSON object with EXACTLY these fields:
- "title": a short descriptive title, max 10 words
- "summary": 2-3 sentence description of what this file contains
- "category": exactly one of [Research, Tutorial, Reference, Personal, Project, Media, Code, Other]
- "tags": array of 3-8 relevant keyword strings, lowercase

Respond ONLY with valid JSON. No markdown, no explanation, no backticks.`;

const USER_PROMPT = (content: string) =>
  `Classify this file content:\n\n${content.slice(0, 8000)}`;

export async function getAIMetadata(
  filename: string,
  content: string
): Promise<AIMetadata> {
  if (!content.trim()) {
    return { ...FALLBACK_METADATA, title: filename };
  }

  try {
    const client = getClient();

    const response = await client.chat.completions.create({
      model: DEFAULT_TEXT_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: USER_PROMPT(content) },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 512,
    });

    const raw = response.choices[0]?.message?.content ?? '';
    const parsed = JSON.parse(raw);

    return {
      title: typeof parsed.title === 'string' ? parsed.title.trim().slice(0, 120) : filename,
      summary: typeof parsed.summary === 'string' ? parsed.summary.trim().slice(0, 1000) : '',
      category: isValidCategory(parsed.category) ? parsed.category : 'Other',
      tags: Array.isArray(parsed.tags)
        ? parsed.tags
            .filter((t: unknown) => typeof t === 'string')
            .map((t: string) => t.toLowerCase().trim())
            .slice(0, 8)
        : [],
    };
  } catch (err) {
    // A failed AI response must never crash the pipeline.
    console.error(
      `[groq] getAIMetadata failed (model=${DEFAULT_TEXT_MODEL}):`,
      (err as Error).message
    );
    return { ...FALLBACK_METADATA, title: filename };
  }
}

function isValidCategory(value: unknown): value is AICategory {
  return (
    typeof value === 'string' &&
    ['Research', 'Tutorial', 'Reference', 'Personal', 'Project', 'Media', 'Code', 'Other'].includes(value)
  );
}

// ─────────────────────────────────────────────
// Streaming Chat via Groq
// ─────────────────────────────────────────────

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const DEFAULT_CHAT_MODEL = process.env.GROQ_CHAT_MODEL?.trim() || 'llama-3.3-70b-versatile';

/**
 * Stream a chat completion from Groq.
 * Yields string tokens as they arrive.
 * Respects the AbortSignal for client disconnects.
 */
export async function* streamGroqChat(
  messages: ChatMessage[],
  signal?: AbortSignal
): AsyncGenerator<string> {
  const client = getClient();

  const stream = await client.chat.completions.create(
    {
      model: DEFAULT_CHAT_MODEL,
      messages,
      stream: true,
      max_tokens: 2048,
      temperature: 0.7,
    },
    { signal }
  );

  for await (const chunk of stream) {
    const token = chunk.choices[0]?.delta?.content;
    if (token) yield token;
  }
}

// ─────────────────────────────────────────────
// Whisper Transcription
// ─────────────────────────────────────────────
export async function transcribeAudio(audioPath: string): Promise<string> {
  try {
    const client = getClient();

    const transcription = await client.audio.transcriptions.create({
      file: fs.createReadStream(audioPath) as unknown as File,
      model: 'whisper-large-v3-turbo',
      response_format: 'text',
    });

    // Groq SDK types response_format='text' as Transcription object at compile time,
    // but the actual runtime value is a plain string when response_format is 'text'.
    const result = transcription as unknown;
    if (typeof result === 'string') return result.trim();
    return (result as { text?: string }).text?.trim() ?? '';
  } catch (err) {
    console.error('[groq] transcribeAudio failed:', (err as Error).message);
    return '';
  }
}
