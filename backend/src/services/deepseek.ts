import 'dotenv/config';

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
const DEEPSEEK_MODEL = 'deepseek-coder:1.3b-instruct';

export async function summarizeCode(content: string, filename: string): Promise<string> {
  const truncated = content.slice(0, 4000);
  const prompt = [
    `File: ${filename}`,
    'Summarize what this code does in 2-3 sentences.',
    '',
    truncated,
  ].join('\n');

  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        prompt,
        stream: false,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      throw new Error(`Ollama returned ${response.status}`);
    }

    const data = (await response.json()) as { response?: string };
    return (data.response ?? '').trim();
  } catch (err) {
    console.error('[deepseek] summarizeCode failed:', (err as Error).message);
    return '';
  }
}

export function extractCodeSymbols(content: string): string[] {
  const patterns = [
    /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm,
    /^(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/gm,
    /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/gm,
    /^def\s+([A-Za-z_]\w*)/gm,
    /^class\s+([A-Za-z_]\w*)/gm,
    /^(?:pub\s+)?fn\s+([A-Za-z_]\w*)/gm,
    /^func\s+([A-Za-z_]\w*)/gm,
  ];

  const symbols = new Set<string>();
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      if (match[1]) symbols.add(match[1]);
    }
  }

  return [...symbols].slice(0, 20);
}
