import 'dotenv/config';

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
const CHAT_MODEL = process.env.OLLAMA_CHAT_MODEL ?? 'gpt-oss-120b';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OllamaChunk {
  message?: { content?: string };
  done: boolean;
}

/**
 * Stream a chat completion from Ollama.
 * Yields string tokens as they arrive.
 * Throws on HTTP errors or malformed JSON.
 */
export async function* streamOllamaChat(
  messages: ChatMessage[],
  signal?: AbortSignal
): AsyncGenerator<string> {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: CHAT_MODEL, messages, stream: true }),
    signal,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Ollama chat error ${response.status}: ${body}`);
  }

  if (!response.body) {
    throw new Error('Ollama response has no body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Each line is a JSON object; process complete lines only
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let chunk: OllamaChunk;
      try {
        chunk = JSON.parse(trimmed) as OllamaChunk;
      } catch {
        continue; // skip malformed lines
      }

      const token = chunk.message?.content;
      if (token) yield token;
      if (chunk.done) return;
    }
  }

  // Flush remaining buffer
  if (buffer.trim()) {
    try {
      const chunk = JSON.parse(buffer.trim()) as OllamaChunk;
      const token = chunk.message?.content;
      if (token) yield token;
    } catch {
      // ignore
    }
  }
}
