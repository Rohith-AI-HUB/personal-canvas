const BASE = 'http://127.0.0.1:3001';

export type FileStatus = 'pending' | 'processing' | 'complete' | 'error';

export interface FileMetadata {
  file_id: string;
  ai_title: string | null;
  ai_summary: string | null;
  ai_category: string | null;
  extracted_text: string | null;
  word_count: number | null;
  language: string | null;
  processed_at: string | null;
}

export interface CanvasNode {
  id: string;
  file_id: string | null;
  folder_id: string | null;
  canvas_id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FileRecord {
  id: string;
  filename: string;
  storage_path: string;
  thumbnail_path: string | null;
  file_type: 'pdf' | 'image' | 'video' | 'audio' | 'code' | 'text' | 'other';
  file_size: number | null;
  mime_type: string | null;
  status: FileStatus;
  retry_count: number;
  error_message: string | null;
  created_at: string;
  metadata: FileMetadata | null;
  tags: string[];
  canvas_node: CanvasNode | null;
}

export interface NodeUpdate {
  id: string;
  fileId?: string;
  folderId?: string;
  canvasId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasNodeRecord {
  id: string;
  file_id: string | null;
  folder_id: string | null;
  canvas_id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SearchResult {
  file_id: string;
  folder_id: string | null;
  filename: string;
  file_type: FileRecord['file_type'];
  ai_title: string | null;
  ai_category: string | null;
  tags: string;
  highlight: string | null;
  semantic_text: string | null;
  keyword_score: number;
  semantic_score: number;
  hybrid_score: number;
  created_at: string | null;
}

export interface SearchResponse {
  query: string;
  keyword_results: SearchResult[];
  semantic_results: Array<{ file_id: string; score: number; text: string }>;
  results: SearchResult[];
}

export interface ChatHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface FolderRecord {
  id:                  string;
  name:                string;
  cover_color:         string;
  file_count:          number;
  created_at:          string;
  updated_at:          string;
  preview_thumbnails?: Array<string | null>;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${path} → ${res.status}: ${body}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  /** Upload a file. Returns the full file record. */
  uploadFile: async (file: File): Promise<{ duplicate: boolean; file: FileRecord }> => {
    const form = new FormData();
    form.append('file', file);
    return request('/api/files', { method: 'POST', body: form });
  },

  /** Fetch all files for canvas restore on startup. */
  listFiles: (): Promise<FileRecord[]> => request('/api/files'),

  /** Fetch a single file record. */
  getFile: (id: string): Promise<FileRecord> => request(`/api/files/${id}`),

  /** Poll file status (lightweight). */
  getFileStatus: (id: string): Promise<{ status: FileStatus; retry_count: number; error_message: string | null }> =>
    request(`/api/files/${id}/status`),

  /** Delete a file. */
  deleteFile: (id: string): Promise<void> => request(`/api/files/${id}`, { method: 'DELETE' }),

  /** Batch-upsert canvas node positions. */
  saveCanvasNodes: (nodes: NodeUpdate[]): Promise<void> =>
    request('/api/canvas/nodes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(nodes),
    }),

  /** Load all node positions for a specific canvas. */
  getCanvasNodes: (canvasId: string): Promise<CanvasNodeRecord[]> =>
    request(`/api/canvas/${encodeURIComponent(canvasId)}/nodes`),

  /** Retry AI processing for a file in error state. */
  retryFile: (id: string): Promise<{ queued: boolean }> =>
    request(`/api/files/${id}/retry`, { method: 'POST' }),

  /** Force re-run AI analysis regardless of current status. */
  reanalyzeFile: (id: string): Promise<{ queued: boolean }> =>
    request(`/api/files/${id}/reanalyze`, { method: 'POST' }),

  /** Manually update a file's title and/or tags (source='manual'). */
  patchFile: (id: string, patch: { title?: string; tags?: string[] }): Promise<FileRecord> =>
    request(`/api/files/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),

  /** Hybrid search (keyword + semantic). */
  searchFiles: (q: string, opts?: { type?: string; category?: string; folderId?: string; semantic?: boolean; topN?: number }): Promise<SearchResponse> => {
    const params = new URLSearchParams({ q });
    if (opts?.type) params.set('type', opts.type);
    if (opts?.category) params.set('category', opts.category);
    if (opts?.folderId) params.set('folder_id', opts.folderId);
    if (opts?.semantic === false) params.set('semantic', '0');
    if (opts?.topN) params.set('topN', String(opts.topN));
    return request(`/api/search?${params.toString()}`);
  },

  /**
   * Stream a chat message via SSE.
   * Returns an AbortController so the caller can cancel mid-stream.
   */
  streamChat: (
    message: string,
    sessionId: string,
    history: ChatHistoryMessage[],
    onToken: (token: string) => void,
    onDone: (citations: string[]) => void,
    onError: (msg: string) => void
  ): AbortController => {
    const controller = new AbortController();

    (async () => {
      try {
        const res = await fetch(`${BASE}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, session_id: sessionId, history }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          onError(`Server error ${res.status}`);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let completed = false;
        let hadError = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

          let separator = buffer.indexOf('\n\n');
          while (separator !== -1) {
            const eventPayload = buffer.slice(0, separator);
            buffer = buffer.slice(separator + 2);

            const dataLine = eventPayload
              .split('\n')
              .find((line) => line.startsWith('data:'));
            if (!dataLine) {
              separator = buffer.indexOf('\n\n');
              continue;
            }

            const raw = dataLine.slice(5).trim();
            if (!raw) {
              separator = buffer.indexOf('\n\n');
              continue;
            }

            let parsed: Record<string, unknown>;
            try {
              parsed = JSON.parse(raw) as Record<string, unknown>;
            } catch {
              separator = buffer.indexOf('\n\n');
              continue;
            }

            if (typeof parsed.token === 'string') onToken(parsed.token);
            if (parsed.done === true) {
              const citations = Array.isArray(parsed.citations)
                ? parsed.citations.filter((id): id is string => typeof id === 'string')
                : [];
              completed = true;
              onDone(citations);
            }
            if (typeof parsed.error === 'string') {
              hadError = true;
              onError(parsed.error);
            }

            separator = buffer.indexOf('\n\n');
          }
        }

        if (!completed && !hadError && !controller.signal.aborted) {
          onDone([]);
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return;
        onError(err instanceof Error ? err.message : 'Connection failed');
      }
    })();

    return controller;
  },

  /** Load prior messages for a session. */
  getChatHistory: (sessionId: string): Promise<{
    session_id: string;
    messages: Array<{
      id: number;
      role: 'user' | 'assistant';
      content: string;
      citations: string[];
      created_at: string;
    }>;
  }> => request(`/api/chat/history?session_id=${encodeURIComponent(sessionId)}`),

  // ── Folder API ─────────────────────────────────────────────────────────────

  listFolders: (): Promise<FolderRecord[]> =>
    request('/api/folders'),

  createFolder: (name: string, cover_color?: string): Promise<FolderRecord> =>
    request('/api/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, cover_color }),
    }),

  updateFolder: (id: string, patch: { name?: string; cover_color?: string }): Promise<FolderRecord> =>
    request(`/api/folders/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),

  deleteFolder: (id: string): Promise<void> =>
    request(`/api/folders/${id}`, { method: 'DELETE' }),

  getFolderFiles: (folderId: string): Promise<FileRecord[]> =>
    request(`/api/folders/${folderId}/files`),

  addFilesToFolder: (folderId: string, fileIds: string[]): Promise<FolderRecord> =>
    request(`/api/folders/${folderId}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_ids: fileIds }),
    }),

  removeFileFromFolder: (folderId: string, fileId: string): Promise<void> =>
    request(`/api/folders/${folderId}/files/${fileId}`, { method: 'DELETE' }),

  /** Admin endpoint to back-fill semantic vectors. */
  reindexVectors: (): Promise<{
    ok: boolean;
    files_total: number;
    files_indexed: number;
    files_skipped: number;
    chunks_indexed: number;
  }> => request('/api/admin/reindex', { method: 'POST' }),

  /** Thumbnail URL for a file (served from backend static or resolved from path). */
  thumbnailUrl: (filePath: string | null): string | null => {
    if (!filePath) return null;
    // Encode path and serve via backend (we'll add this static route shortly)
    return `${BASE}/api/thumbnail?path=${encodeURIComponent(filePath)}`;
  },
};
