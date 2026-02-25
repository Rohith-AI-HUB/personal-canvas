import type { FileRecord, UploadResponse } from '../types/file.js';

const BASE_URL = 'http://127.0.0.1:3001';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, options);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API ${path} failed [${response.status}]: ${body}`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  // Upload a file to the backend
  uploadFile: async (file: File): Promise<UploadResponse> => {
    const formData = new FormData();
    formData.append('file', file);
    return request<UploadResponse>('/api/files', {
      method: 'POST',
      body: formData,
    });
  },

  // Fetch all files for canvas restore
  listFiles: async (): Promise<{ files: FileRecord[] }> => {
    return request<{ files: FileRecord[] }>('/api/files');
  },

  // Poll status of a single file
  getFileStatus: async (id: string): Promise<Partial<FileRecord>> => {
    return request<Partial<FileRecord>>(`/api/files/${id}/status`);
  },

  // Delete a file
  deleteFile: async (id: string): Promise<void> => {
    await request<void>(`/api/files/${id}`, { method: 'DELETE' });
  },

  // Persist canvas node positions (debounced from Canvas onChange)
  saveCanvasNodes: async (nodes: Array<{
    id: string;
    fileId: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>): Promise<void> => {
    await request<void>('/api/canvas/nodes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodes }),
    });
  },
};
