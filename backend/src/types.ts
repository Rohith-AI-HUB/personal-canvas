import type { FileType } from './services/fileTypes.js';

export interface FileRecord {
  id: string;
  filename: string;
  original_path: string | null;
  storage_path: string;
  thumbnail_path: string | null;
  file_type: FileType;
  file_size: number | null;
  mime_type: string | null;
  content_hash: string | null;
  status: 'pending' | 'processing' | 'complete' | 'error';
  retry_count: number;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

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

export interface Tag {
  id: number;
  file_id: string;
  tag: string;
  source: 'ai' | 'manual';
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
  updated_at: string;
}

export interface FileWithMetadata extends FileRecord {
  metadata: FileMetadata | null;
  tags: string[];
  canvas_node: CanvasNode | null;
}
