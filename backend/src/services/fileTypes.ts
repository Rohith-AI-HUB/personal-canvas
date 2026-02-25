export type FileType =
  | 'pdf'
  | 'image'
  | 'video'
  | 'audio'
  | 'code'
  | 'text'
  | 'other';

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.svg']);
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv', '.wmv', '.m4v']);
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.wma', '.opus']);
const CODE_EXTS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.py', '.rb', '.go', '.rs', '.cpp', '.c',
  '.h', '.cs', '.java', '.kt', '.swift', '.php', '.sh', '.bash', '.zsh',
  '.fish', '.ps1', '.sql', '.html', '.css', '.scss', '.less', '.vue',
  '.svelte', '.json', '.yaml', '.yml', '.toml', '.xml', '.graphql',
]);
const TEXT_EXTS = new Set(['.txt', '.md', '.markdown', '.rst', '.log', '.csv', '.tsv']);

export function detectFileType(filename: string): FileType {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();

  if (ext === '.pdf') return 'pdf';
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  if (CODE_EXTS.has(ext)) return 'code';
  if (TEXT_EXTS.has(ext)) return 'text';
  return 'other';
}
