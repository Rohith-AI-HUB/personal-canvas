import { useEffect, useRef, useState } from 'react';
import { api, type FileRecord } from '../api';

// ── File type palette ─────────────────────────────────────────────────────────

const TYPE_COLORS: Record<FileRecord['file_type'], string> = {
    pdf: '#ef4444',
    image: '#3b82f6',
    video: '#8b5cf6',
    audio: '#06b6d4',
    code: '#10b981',
    text: '#6366f1',
    other: '#94a3b8',
};

const TYPE_ICONS: Record<FileRecord['file_type'], string> = {
    pdf: '📄',
    image: '🖼️',
    video: '🎬',
    audio: '🎵',
    code: '💻',
    text: '📝',
    other: '📁',
};

// ── Sidebar Component ─────────────────────────────────────────────────────────

interface SidebarProps {
    onUpload?: (file: FileRecord) => void;
}

export function Sidebar({ onUpload }: SidebarProps) {
    const [files, setFiles] = useState<FileRecord[]>([]);
    const [collapsed, setCollapsed] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [dragOver, setDragOver] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Fetch file list on mount + refresh periodically
    useEffect(() => {
        let cancelled = false;

        async function loadFiles() {
            try {
                const list = await api.listFiles();
                if (!cancelled) setFiles(list);
            } catch (err) {
                console.error('Sidebar: failed to load files', err);
            }
        }

        loadFiles();
        const timer = setInterval(loadFiles, 5000);
        return () => { cancelled = true; clearInterval(timer); };
    }, []);

    const handleFileInput = async (fileList: FileList | null) => {
        if (!fileList || fileList.length === 0) return;
        setUploading(true);
        try {
            for (const file of Array.from(fileList)) {
                const result = await api.uploadFile(file);
                if (!result.duplicate) {
                    onUpload?.(result.file);
                    setFiles((prev) => [result.file, ...prev]);
                }
            }
        } catch (err) {
            console.error('Upload failed:', err);
        } finally {
            setUploading(false);
        }
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOver(false);
        await handleFileInput(e.dataTransfer.files);
    };

    const handleDelete = async (id: string) => {
        try {
            await api.deleteFile(id);
            setFiles((prev) => prev.filter((f) => f.id !== id));
        } catch (err) {
            console.error('Delete failed:', err);
        }
    };

    const filtered = files.filter((f) =>
        f.filename.toLowerCase().includes(searchQuery.toLowerCase()) ||
        f.file_type.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (f.metadata?.ai_title ?? '').toLowerCase().includes(searchQuery.toLowerCase())
    );

    const typeStats = files.reduce((acc, f) => {
        acc[f.file_type] = (acc[f.file_type] || 0) + 1;
        return acc;
    }, {} as Record<string, number>);

    if (collapsed) {
        return (
            <div style={styles.collapsedBar}>
                <button
                    style={styles.expandBtn}
                    onClick={() => setCollapsed(false)}
                    title="Expand sidebar"
                >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M9 18l6-6-6-6" />
                    </svg>
                </button>
                <div style={styles.collapsedIcons}>
                    {files.slice(0, 8).map((f) => (
                        <div key={f.id} style={styles.collapsedDot} title={f.filename}>
                            <span style={{ fontSize: 14 }}>{TYPE_ICONS[f.file_type]}</span>
                        </div>
                    ))}
                    {files.length > 8 && (
                        <div style={{ ...styles.collapsedDot, fontSize: 10, color: '#94a3b8' }}>
                            +{files.length - 8}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div style={styles.sidebar}>
            {/* ── Header ── */}
            <div style={styles.header}>
                <div style={styles.headerLeft}>
                    <div style={styles.logo}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2.5">
                            <rect x="3" y="3" width="7" height="7" rx="1.5" />
                            <rect x="14" y="3" width="7" height="7" rx="1.5" />
                            <rect x="3" y="14" width="7" height="7" rx="1.5" />
                            <rect x="14" y="14" width="7" height="7" rx="1.5" />
                        </svg>
                    </div>
                    <div>
                        <div style={styles.title}>Canvas</div>
                        <div style={styles.subtitle}>{files.length} file{files.length !== 1 ? 's' : ''}</div>
                    </div>
                </div>
                <button
                    style={styles.collapseBtn}
                    onClick={() => setCollapsed(true)}
                    title="Collapse sidebar"
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M15 18l-6-6 6-6" />
                    </svg>
                </button>
            </div>

            {/* ── Upload zone ── */}
            <div
                style={{
                    ...styles.uploadZone,
                    ...(dragOver ? styles.uploadZoneActive : {}),
                }}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
            >
                <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    style={{ display: 'none' }}
                    onChange={(e) => handleFileInput(e.target.files)}
                />
                {uploading ? (
                    <div style={styles.uploadingLabel}>
                        <div style={styles.spinner} />
                        Uploading…
                    </div>
                ) : (
                    <>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2">
                            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                            <polyline points="17 8 12 3 7 8" />
                            <line x1="12" y1="3" x2="12" y2="15" />
                        </svg>
                        <span style={styles.uploadText}>Drop files or click to upload</span>
                    </>
                )}
            </div>

            {/* ── Type filter pills ── */}
            {Object.keys(typeStats).length > 0 && (
                <div style={styles.typePills}>
                    {Object.entries(typeStats).map(([type, count]) => (
                        <div
                            key={type}
                            style={{
                                ...styles.pill,
                                background: `${TYPE_COLORS[type as FileRecord['file_type']]}12`,
                                color: TYPE_COLORS[type as FileRecord['file_type']],
                                borderColor: `${TYPE_COLORS[type as FileRecord['file_type']]}30`,
                            }}
                        >
                            {TYPE_ICONS[type as FileRecord['file_type']]} {count}
                        </div>
                    ))}
                </div>
            )}

            {/* ── Search ── */}
            <div style={styles.searchWrap}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" style={{ flexShrink: 0 }}>
                    <circle cx="11" cy="11" r="8" />
                    <path d="M21 21l-4.35-4.35" />
                </svg>
                <input
                    type="text"
                    placeholder="Search files…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={styles.searchInput}
                />
            </div>

            {/* ── File list ── */}
            <div style={styles.fileList}>
                {filtered.length === 0 && (
                    <div style={styles.emptyState}>
                        {searchQuery ? 'No matches found' : 'No files yet — drop some on the canvas!'}
                    </div>
                )}
                {filtered.map((file) => (
                    <FileListItem key={file.id} file={file} onDelete={handleDelete} />
                ))}
            </div>
        </div>
    );
}

// ── File List Item ────────────────────────────────────────────────────────────

function FileListItem({ file, onDelete }: { file: FileRecord; onDelete: (id: string) => void }) {
    const [hovered, setHovered] = useState(false);
    const icon = TYPE_ICONS[file.file_type];
    const color = TYPE_COLORS[file.file_type];
    const title = file.metadata?.ai_title ?? file.filename;

    return (
        <div
            style={{
                ...styles.fileItem,
                background: hovered ? '#f1f5f9' : 'transparent',
            }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >
            <div style={{ ...styles.fileIcon, background: `${color}14`, color }}>
                <span style={{ fontSize: 14 }}>{icon}</span>
            </div>
            <div style={styles.fileInfo}>
                <div style={styles.fileName} title={title}>
                    {title}
                </div>
                <div style={styles.fileMeta}>
                    {file.file_type.toUpperCase()}
                    {file.file_size ? ` · ${formatSize(file.file_size)}` : ''}
                </div>
            </div>
            {hovered && (
                <button
                    style={styles.deleteBtn}
                    onClick={(e) => { e.stopPropagation(); onDelete(file.id); }}
                    title="Delete file"
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                    </svg>
                </button>
            )}
            {file.status !== 'complete' && file.status !== 'error' && (
                <div style={{ ...styles.statusDot, background: '#f59e0b' }} title={file.status} />
            )}
            {file.status === 'error' && (
                <div style={{ ...styles.statusDot, background: '#ef4444' }} title="Error" />
            )}
        </div>
    );
}

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
    sidebar: {
        width: 280,
        height: '100%',
        background: '#ffffff',
        borderRight: '1px solid #e2e8f0',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: "'Inter', 'SF Pro Display', system-ui, sans-serif",
        overflow: 'hidden',
        flexShrink: 0,
        zIndex: 10,
    },
    collapsedBar: {
        width: 52,
        height: '100%',
        background: '#ffffff',
        borderRight: '1px solid #e2e8f0',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: 12,
        gap: 8,
        flexShrink: 0,
        zIndex: 10,
    },
    expandBtn: {
        width: 32,
        height: 32,
        border: 'none',
        background: '#f1f5f9',
        borderRadius: 8,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#475569',
    },
    collapsedIcons: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        marginTop: 8,
    },
    collapsedDot: {
        width: 32,
        height: 32,
        borderRadius: 8,
        background: '#f8fafc',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
    },
    header: {
        padding: '16px 16px 12px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '1px solid #f1f5f9',
    },
    headerLeft: {
        display: 'flex',
        alignItems: 'center',
        gap: 10,
    },
    logo: {
        width: 36,
        height: 36,
        background: '#eff6ff',
        borderRadius: 10,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
    },
    title: {
        fontSize: 15,
        fontWeight: 700,
        color: '#0f172a',
        letterSpacing: '-0.02em',
    },
    subtitle: {
        fontSize: 11,
        color: '#94a3b8',
        fontWeight: 500,
    },
    collapseBtn: {
        width: 28,
        height: 28,
        border: 'none',
        background: '#f8fafc',
        borderRadius: 7,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#64748b',
        transition: 'background 0.15s',
    },
    uploadZone: {
        margin: '12px 12px 0',
        padding: '14px 12px',
        border: '2px dashed #e2e8f0',
        borderRadius: 12,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        cursor: 'pointer',
        transition: 'all 0.2s',
        background: '#fafbfc',
    },
    uploadZoneActive: {
        borderColor: '#3b82f6',
        background: '#eff6ff',
    },
    uploadText: {
        fontSize: 12,
        color: '#64748b',
        fontWeight: 500,
    },
    uploadingLabel: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 12,
        color: '#3b82f6',
        fontWeight: 500,
    },
    spinner: {
        width: 14,
        height: 14,
        border: '2px solid #e2e8f0',
        borderTopColor: '#3b82f6',
        borderRadius: '50%',
        animation: 'spin 0.8s linear infinite',
    },
    typePills: {
        display: 'flex',
        flexWrap: 'wrap',
        gap: 4,
        padding: '10px 12px 0',
    },
    pill: {
        fontSize: 10,
        fontWeight: 600,
        padding: '3px 8px',
        borderRadius: 6,
        border: '1px solid',
        letterSpacing: '0.02em',
    },
    searchWrap: {
        margin: '10px 12px 0',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 10px',
        background: '#f8fafc',
        borderRadius: 8,
        border: '1px solid #e2e8f0',
    },
    searchInput: {
        flex: 1,
        border: 'none',
        outline: 'none',
        background: 'transparent',
        fontSize: 12,
        color: '#334155',
        fontFamily: 'inherit',
    },
    fileList: {
        flex: 1,
        overflow: 'auto',
        padding: '8px 8px',
    },
    emptyState: {
        textAlign: 'center',
        color: '#94a3b8',
        fontSize: 12,
        padding: '24px 16px',
        lineHeight: '1.5',
    },
    fileItem: {
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 8px',
        borderRadius: 8,
        cursor: 'default',
        transition: 'background 0.15s',
        position: 'relative',
    },
    fileIcon: {
        width: 32,
        height: 32,
        borderRadius: 8,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    fileInfo: {
        flex: 1,
        overflow: 'hidden',
    },
    fileName: {
        fontSize: 12,
        fontWeight: 600,
        color: '#1e293b',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },
    fileMeta: {
        fontSize: 10,
        color: '#94a3b8',
        fontWeight: 500,
        marginTop: 1,
    },
    deleteBtn: {
        width: 28,
        height: 28,
        border: 'none',
        background: '#fef2f2',
        borderRadius: 6,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'background 0.15s',
        flexShrink: 0,
    },
    statusDot: {
        width: 8,
        height: 8,
        borderRadius: '50%',
        flexShrink: 0,
    },
};
