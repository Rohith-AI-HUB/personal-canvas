export type FileStatus = 'pending' | 'processing' | 'complete' | 'error';

export type FileType = 'pdf' | 'image' | 'video' | 'audio' | 'code' | 'text' | 'other';

export interface FileRecord {
  id: string;
  filename: string;
  storagePath: string;
  thumbnailPath: string | null;
  fileType: FileType;
  mimeType: string;
  status: FileStatus;
  retryCount: number;
  errorMessage: string | null;
  createdAt: string;
  // AI-generated (null until processing complete)
  aiTitle: string | null;
  aiSummary: string | null;
  aiCategory: string | null;
  tags: string[];
  // Canvas position
  position: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface UploadResponse {
  duplicate: boolean;
  file: Partial<FileRecord> & { id: string; filename: string; status: FileStatus };
}
