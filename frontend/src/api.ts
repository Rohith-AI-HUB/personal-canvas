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
  file_id: string;
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
  fileId: string;
  x: number;
  y: number;
  width: number;
  height: number;
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

  /** Retry AI processing for a file in error state. */
  retryFile: (id: string): Promise<{ queued: boolean }> =>
    request(`/api/files/${id}/retry`, { method: 'POST' }),

  /** Thumbnail URL for a file (served from backend static or resolved from path). */
  thumbnailUrl: (filePath: string | null): string | null => {
    if (!filePath) return null;
    // Encode path and serve via backend (we'll add this static route shortly)
    return `${BASE}/api/thumbnail?path=${encodeURIComponent(filePath)}`;
  },
};
