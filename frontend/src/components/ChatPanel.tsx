import {
  useEffect,
  useRef,
  useState,
  useCallback,
  type CSSProperties,
  type KeyboardEvent,
  type ChangeEvent,
} from 'react';
import { createShapeId, type Editor } from '@tldraw/tldraw';
import { api, type ChatHistoryMessage, type FileRecord } from '../api';
import { fileStore } from './FileCard';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations: string[];
  streaming?: boolean;
  error?: boolean;
}

interface CitationMeta {
  file_id: string;
  label: string;
  file_type: string;
}

interface PinnedFile {
  id: string;
  filename: string;
  ai_title: string | null;
  file_type: string;
}

interface HistoryThread {
  id: string;
  title: string;
  updatedAt: number;
}

interface ChatPanelProps {
  sessionId: string;
  canvasId: string;
  isOpen: boolean;
  onToggle: () => void;
  getEditor: () => Editor | null;
  allFiles: FileRecord[];
  onOpenViewer: (file: FileRecord) => void;
  historyThreads: HistoryThread[];
  activeThreadId: string;
  onSelectThread: (sessionId: string) => void;
  onNewThread: () => void;
  onDeleteThread: (sessionId: string) => void;
  onThreadActivity: (sessionId: string, firstUserMessage: string) => void;
  panelStyle?: CSSProperties;
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function toPromptHistory(messages: Message[]): ChatHistoryMessage[] {
  return messages
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && !m.streaming && !m.error && m.content.trim())
    .slice(-10)
    .map((m) => ({ role: m.role, content: m.content.trim() }));
}

export function ChatPanel({
  sessionId,
  canvasId,
  isOpen,
  onToggle,
  getEditor,
  allFiles,
  onOpenViewer,
  historyThreads,
  activeThreadId,
  onSelectThread,
  onNewThread,
  onDeleteThread,
  onThreadActivity,
  panelStyle,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [citationMap, setCitationMap] = useState<Map<string, CitationMeta>>(new Map());

  const [mentionQuery, setMentionQuery] = useState('');
  const [showMentions, setShowMentions] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [pinnedFiles, setPinnedFiles] = useState<PinnedFile[]>([]);
  const [isSidebarCollapsed, setSidebarCollapsed] = useState(false);

  const [savingMsgId, setSavingMsgId] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  const mentionResults = mentionQuery.length === 0
    ? allFiles.slice().sort((a, b) => Number(new Date(b.created_at)) - Number(new Date(a.created_at))).slice(0, 8)
    : allFiles
        .filter((f) => {
          const q = mentionQuery.toLowerCase();
          const title = (f.metadata?.ai_title ?? f.filename).toLowerCase();
          const tags = (f.tags ?? []).join(' ').toLowerCase();
          return title.includes(q) || f.filename.toLowerCase().includes(q) || f.file_type.toLowerCase().includes(q) || tags.includes(q);
        })
        .slice(0, 8);

  const resolveCitations = useCallback(async (fileIds: string[]) => {
    const unique = [...new Set(fileIds)];
    if (!unique.length) return;
    const results = await Promise.allSettled(unique.map((id) => api.getFile(id)));
    setCitationMap((prev) => {
      const next = new Map(prev);
      results.forEach((r, i) => {
        const fid = unique[i]!;
        if (next.has(fid)) return;
        next.set(
          fid,
          r.status === 'fulfilled'
            ? { file_id: fid, label: r.value.metadata?.ai_title?.trim() || r.value.filename, file_type: r.value.file_type }
            : { file_id: fid, label: 'Unknown file', file_type: 'other' }
        );
      });
      return next;
    });
  }, []);

  useEffect(() => {
    api
      .getChatHistory(sessionId)
      .then(({ messages: hist }) => {
        setMessages(
          hist.length === 0
            ? []
            : hist.map((m) => ({ id: String(m.id), role: m.role, content: m.content, citations: m.citations }))
        );
        void resolveCitations(hist.flatMap((m) => m.citations ?? []));
      })
      .catch(() => {});
  }, [sessionId, resolveCitations]);

  useEffect(() => {
    setInput('');
    setPinnedFiles([]);
    setShowMentions(false);
    setMentionQuery('');
    setMentionIndex(0);
  }, [sessionId]);

  useEffect(() => {
    if (isAtBottomRef.current) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => () => {
    abortRef.current?.abort();
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (el) isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  }, []);

  const jumpToFile = useCallback(
    (fileId: string) => {
      const editor = getEditor();
      if (!editor) return;
      const shapeId = createShapeId(fileId);
      if (!editor.getShape(shapeId)) return;
      editor.select(shapeId);
      (editor as any).zoomToSelection?.({ animation: { duration: 320 } });
    },
    [getEditor]
  );

  const handleInputChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);

    const cursor = e.target.selectionStart ?? val.length;
    const textBefore = val.slice(0, cursor);
    const lastAt = textBefore.lastIndexOf('@');

    if (lastAt === -1) {
      setShowMentions(false);
      return;
    }

    const fragment = textBefore.slice(lastAt + 1);
    if (fragment.includes(' ')) {
      setShowMentions(false);
      return;
    }
    setMentionQuery(fragment);
    setMentionIndex(0);
    setShowMentions(true);
  }, []);

  const pickMention = useCallback(
    (file: FileRecord) => {
      const cursor = inputRef.current?.selectionStart ?? input.length;
      const lastAt = input.slice(0, cursor).lastIndexOf('@');
      const before = input.slice(0, lastAt);
      const after = input.slice(cursor);
      const label = file.metadata?.ai_title?.trim() || file.filename;
      setInput(`${before}@${label} ${after}`);
      setShowMentions(false);

      setPinnedFiles((prev) =>
        prev.find((p) => p.id === file.id)
          ? prev
          : [
              ...prev,
              {
                id: file.id,
                filename: file.filename,
                ai_title: file.metadata?.ai_title ?? null,
                file_type: file.file_type,
              },
            ]
      );

      setTimeout(() => inputRef.current?.focus(), 0);
    },
    [input]
  );

  const removePinned = useCallback((fileId: string) => {
    setPinnedFiles((prev) => prev.filter((p) => p.id !== fileId));
  }, []);

  const saveAsFile = useCallback(
    async (msg: Message) => {
      if (savingMsgId) return;
      setSavingMsgId(msg.id);

      try {
        const sourceId = msg.citations[0] ?? null;
        const sourceLabel = sourceId ? citationMap.get(sourceId)?.label ?? 'file' : 'canvas';
        const filename = `Summary - ${sourceLabel.slice(0, 40)}.txt`.replace(/[<>:"/\\|?*]/g, '-');

        const { file: newFile } = await api.createTextFile(filename, msg.content, sourceId ?? undefined);
        if (canvasId.startsWith('folder:')) {
          const folderId = canvasId.slice('folder:'.length);
          if (folderId) await api.addFilesToFolder(folderId, [newFile.id]);
        }

        const editor = getEditor();
        if (editor) {
          const newShapeId = createShapeId(newFile.id);
          const CARD_W = 200;
          const CARD_H = 260;

          let x = 100;
          let y = 100;
          if (sourceId) {
            const srcShape = editor.getShape(createShapeId(sourceId));
            if (srcShape) {
              x = srcShape.x + CARD_W + 60;
              y = srcShape.y;
            }
          }

          fileStore.set(newFile.id, newFile);

          if (!editor.getShape(newShapeId)) {
            (editor as any).createShape({
              id: newShapeId,
              type: 'file-card',
              x,
              y,
              props: { w: CARD_W, h: CARD_H, fileId: newFile.id, _v: 0 },
              meta: { fileId: newFile.id },
            });
          }

          if (sourceId) {
            const srcShape = editor.getShape(createShapeId(sourceId));
            if (srcShape) {
              const arrowId = createShapeId('arrow-' + newFile.id);
              editor.createShape({
                id: arrowId,
                type: 'arrow',
                x: srcShape.x,
                y: srcShape.y,
                props: {
                  start: { x: 0, y: 0 },
                  end: { x: x - srcShape.x, y: y - srcShape.y },
                  color: 'violet',
                  size: 's',
                  arrowheadEnd: 'arrow',
                  arrowheadStart: 'none',
                },
              });

              (editor as any).createBindings?.([
                {
                  type: 'arrow',
                  fromId: arrowId,
                  toId: srcShape.id,
                  props: {
                    terminal: 'start',
                    normalizedAnchor: { x: 0.5, y: 0.5 },
                    isExact: false,
                    isPrecise: false,
                  },
                },
                {
                  type: 'arrow',
                  fromId: arrowId,
                  toId: newShapeId,
                  props: {
                    terminal: 'end',
                    normalizedAnchor: { x: 0.5, y: 0.5 },
                    isExact: false,
                    isPrecise: false,
                  },
                },
              ]);
            }
          }

          await api.saveCanvasNodes([
            {
              id: newShapeId,
              fileId: newFile.id,
              canvasId,
              x,
              y,
              width: CARD_W,
              height: CARD_H,
            },
          ]);

          editor.select(newShapeId);
          (editor as any).zoomToSelection?.({ animation: { duration: 400 } });
        }
      } catch (err) {
        console.error('[ChatPanel] saveAsFile failed:', err);
      } finally {
        setSavingMsgId(null);
      }
    },
    [savingMsgId, citationMap, getEditor, canvasId]
  );

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    onThreadActivity(sessionId, text);

    let question = text;
    if (pinnedFiles.length > 0) {
      const contexts = await Promise.allSettled(pinnedFiles.map((f) => api.getFileContent(f.id)));
      const contextBlocks = contexts
        .map((r) => {
          if (r.status !== 'fulfilled') return null;
          const c = r.value;
          const label = c.ai_title || c.filename;
          const body = c.extracted_text ? c.extracted_text.slice(0, 4000) : c.ai_summary ?? '(no content extracted)';
          return `--- @${label} ---\n${body}`;
        })
        .filter(Boolean)
        .join('\n\n');

      if (contextBlocks) question = `[Attached files for context:]\n${contextBlocks}\n\n[Question:] ${text}`;
    }

    const promptHistory = toPromptHistory(messages);
    const userMsg: Message = { id: uid(), role: 'user', content: text, citations: [] };
    const aId = uid();
    const assistantMsg: Message = { id: aId, role: 'assistant', content: '', citations: [], streaming: true };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput('');
    setPinnedFiles([]);
    setIsStreaming(true);
    isAtBottomRef.current = true;

    abortRef.current = api.streamChat(
      question,
      sessionId,
      promptHistory,
      (token) => setMessages((prev) => prev.map((m) => (m.id === aId ? { ...m, content: m.content + token } : m))),
      (citations) => {
        setMessages((prev) => prev.map((m) => (m.id === aId ? { ...m, streaming: false, citations } : m)));
        setIsStreaming(false);
        void resolveCitations(citations);
      },
      (errMsg) => {
        setMessages((prev) => prev.map((m) => (m.id === aId ? { ...m, content: errMsg, streaming: false, error: true, citations: [] } : m)));
        setIsStreaming(false);
      }
    );
  }, [input, isStreaming, messages, pinnedFiles, sessionId, resolveCitations, onThreadActivity]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (showMentions && mentionResults.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setMentionIndex((i) => Math.min(i + 1, mentionResults.length - 1));
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setMentionIndex((i) => Math.max(i - 1, 0));
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          const chosen = mentionResults[mentionIndex];
          if (chosen) pickMention(chosen);
          return;
        }
        if (e.key === 'Escape') {
          setShowMentions(false);
          return;
        }
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void sendMessage();
      }
    },
    [showMentions, mentionResults, mentionIndex, pickMention, sendMessage]
  );

  const handleAbort = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
    setMessages((prev) => prev.map((m) => (m.streaming ? { ...m, streaming: false } : m)));
  }, []);

  const handleDeleteThread = useCallback(
    (threadId: string) => {
      if (window.confirm('Delete this chat thread? This cannot be undone.')) {
        onDeleteThread(threadId);
      }
    },
    [onDeleteThread]
  );

  if (!isOpen) {
    return (
      <div style={s.rail}>
        <button style={s.railToggle} onClick={onToggle} title="Open chat">
          <ChatIcon />
        </button>
      </div>
    );
  }

  return (
    <div style={{ ...s.panel, ...panelStyle }}>
      <div style={s.shell}>
        <aside style={{ ...s.sidebar, ...(isSidebarCollapsed ? s.sidebarCollapsed : {}) }}>
          <div style={s.sidebarTop}>
            <div style={s.sidebarTopRow}>
              {!isSidebarCollapsed && <div style={s.brand}>Claude-style AI</div>}
              <button
                style={s.sidebarCollapseBtn}
                onClick={() => setSidebarCollapsed((v) => !v)}
                title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              >
                {isSidebarCollapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
              </button>
            </div>
            <button style={s.newChatBtn} onClick={onNewThread} title="New chat">
              <PlusIcon />
              {!isSidebarCollapsed && <span>New chat</span>}
            </button>
          </div>

          <div style={s.historyList}>
            {historyThreads.map((thread) => (
              <div key={thread.id} style={{ ...s.historyRow, ...(thread.id === activeThreadId ? s.historyRowActive : {}) }}>
                <button style={s.historyTitleBtn} onClick={() => onSelectThread(thread.id)} title={thread.title}>
                  {isSidebarCollapsed ? (thread.title.trim().charAt(0).toUpperCase() || '#') : thread.title}
                </button>
                {!isSidebarCollapsed && (
                  <button style={s.threadDeleteBtn} onClick={() => handleDeleteThread(thread.id)} title="Delete chat">
                    <TrashIcon />
                  </button>
                )}
              </div>
            ))}
          </div>
        </aside>

        <section style={s.main}>
          <div style={s.header}>
            <div style={s.headerTitle}>Your Files Assistant</div>
            <button style={s.collapseBtn} onClick={onToggle} title="Close chat">
              <ChevronRightIcon />
            </button>
          </div>

          <div style={s.messages} ref={scrollRef} onScroll={handleScroll}>
            {messages.length === 0 && <EmptyState />}
            {messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                msg={msg}
                citationMap={citationMap}
                onCitationClick={jumpToFile}
                onCitationOpen={(fileId) => {
                  const f = allFiles.find((x) => x.id === fileId);
                  if (f) onOpenViewer(f);
                }}
                onSave={saveAsFile}
                isSaving={savingMsgId === msg.id}
              />
            ))}
            {isStreaming && messages[messages.length - 1]?.content === '' && <div style={s.thinking}>Thinking...</div>}
            <div ref={bottomRef} />
          </div>

          <div style={s.inputArea}>
            {pinnedFiles.length > 0 && (
              <div style={s.pinnedRow}>
                {pinnedFiles.map((f) => (
                  <PinnedChip
                    key={f.id}
                    file={f}
                    onRemove={removePinned}
                    onOpen={() => {
                      const full = allFiles.find((x) => x.id === f.id);
                      if (full) onOpenViewer(full);
                    }}
                  />
                ))}
              </div>
            )}

            {showMentions && (
              <div style={s.mentionDropdown}>
                <div style={s.mentionHeader}>Files</div>
                {mentionResults.length === 0 && <div style={s.mentionEmpty}>No files found. Upload files first, then use @.</div>}
                {mentionResults.map((f, i) => (
                  <MentionItem key={f.id} file={f} active={i === mentionIndex} onClick={() => pickMention(f)} />
                ))}
              </div>
            )}

            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Message your files. Use @ to mention a file"
              style={s.textarea}
              rows={1}
              disabled={isStreaming}
            />

            <div style={s.inputActions}>
              <span style={s.inputHint}>Enter to send. Shift+Enter for newline.</span>
              {isStreaming ? (
                <button style={{ ...s.sendBtn, ...s.stopBtn }} onClick={handleAbort} title="Stop">
                  <StopIcon />
                </button>
              ) : (
                <button
                  style={{ ...s.sendBtn, ...(input.trim() ? s.sendBtnActive : {}) }}
                  onClick={() => void sendMessage()}
                  disabled={!input.trim()}
                  title="Send"
                >
                  <SendIcon />
                </button>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function PinnedChip({ file, onRemove, onOpen }: { file: PinnedFile; onRemove: (id: string) => void; onOpen: () => void }) {
  const label = (file.ai_title ?? file.filename).slice(0, 24);
  const colors = TYPE_COLOR[file.file_type] ?? TYPE_COLOR.other;
  return (
    <div style={{ ...s.pinnedChip, background: colors.bg, borderColor: colors.text + '30' }}>
      <span style={{ ...s.pinnedChipDot, background: colors.text }} />
      <span style={{ ...s.pinnedChipLabel, color: colors.text, cursor: 'pointer' }} onClick={onOpen} title="Open viewer">
        {label}
      </span>
      <button style={{ ...s.pinnedChipX, color: colors.text }} onClick={() => onRemove(file.id)} title="Remove">
        x
      </button>
    </div>
  );
}

function MentionItem({ file, active, onClick }: { file: FileRecord; active: boolean; onClick: () => void }) {
  const label = file.metadata?.ai_title?.trim() || file.filename;
  const colors = TYPE_COLOR[file.file_type] ?? TYPE_COLOR.other;
  return (
    <div style={{ ...s.mentionItem, ...(active ? s.mentionItemActive : {}) }} onMouseDown={(e) => { e.preventDefault(); onClick(); }}>
      <span style={{ ...s.mentionTypeBadge, background: colors.bg, color: colors.text }}>{file.file_type}</span>
      <span style={s.mentionLabel}>{label.slice(0, 40)}</span>
    </div>
  );
}

function MessageBubble({
  msg,
  citationMap,
  onCitationClick,
  onCitationOpen,
  onSave,
  isSaving,
}: {
  msg: Message;
  citationMap: Map<string, CitationMeta>;
  onCitationClick: (id: string) => void;
  onCitationOpen: (id: string) => void;
  onSave: (msg: Message) => void;
  isSaving: boolean;
}) {
  const isUser = msg.role === 'user';
  return (
    <div style={{ ...s.bubble, ...(isUser ? s.bubbleUser : s.bubbleAssistant) }}>
      <div style={{ ...s.bubbleContent, ...(isUser ? s.userBubble : s.assistantBubble), ...(msg.error ? s.errorBubble : {}) }}>
        {msg.streaming && msg.content === '' ? <span style={{ opacity: 0.5 }}>Thinking...</span> : <FormattedText text={msg.content} />}
      </div>

      {!isUser && !msg.streaming && !msg.error && msg.content.length > 20 && (
        <button style={{ ...s.saveBtn, ...(isSaving ? s.saveBtnLoading : {}) }} onClick={() => onSave(msg)} disabled={isSaving} title="Save to canvas">
          {isSaving ? <SpinSmIcon /> : <SaveIcon />}
          <span>{isSaving ? 'Saving...' : 'Save to canvas'}</span>
        </button>
      )}

      {msg.citations.length > 0 && (
        <div style={s.citations}>
          {msg.citations.map((id) => {
            const meta = citationMap.get(id);
            return (
              <CitationPill
                key={id}
                fileId={id}
                label={meta?.label ?? 'Unknown'}
                fileType={meta?.file_type ?? 'other'}
                onJump={onCitationClick}
                onOpen={onCitationOpen}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function CitationPill({
  fileId,
  label,
  fileType,
  onJump,
  onOpen,
}: {
  fileId: string;
  label: string;
  fileType: string;
  onJump: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const colors = TYPE_COLOR[fileType] ?? TYPE_COLOR.other;
  return (
    <div style={{ ...s.citationPill, borderColor: colors.text + '33' }}>
      <button style={{ ...s.citationAction, color: colors.text }} onClick={() => onJump(fileId)} title="Jump on canvas">
        {label.length > 28 ? `${label.slice(0, 28)}...` : label}
      </button>
      <button style={s.citationViewBtn} onClick={() => onOpen(fileId)} title="Open viewer">
        <EyeIcon />
      </button>
    </div>
  );
}

function FormattedText({ text }: { text: string }) {
  return (
    <>
      {text.split(/\n\n+/).map((para, i) => (
        <p key={i} style={{ margin: i === 0 ? 0 : '8px 0 0', lineHeight: 1.6 }}>
          {para.split('\n').map((line, j) => (
            <span key={j}>
              {j > 0 && <br />}
              {line}
            </span>
          ))}
        </p>
      ))}
    </>
  );
}

function EmptyState() {
  return (
    <div style={s.emptyState}>
      <div style={s.emptyTitle}>Start a conversation</div>
      <div style={s.emptyBody}>Ask a question about your files. Type @ to attach specific documents.</div>
    </div>
  );
}

function ChatIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
function ChevronLeftIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}
function ChevronRightIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M6 6l1 14h10l1-14" />
    </svg>
  );
}
function SendIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}
function StopIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <rect x="4" y="4" width="16" height="16" rx="2" />
    </svg>
  );
}
function SaveIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  );
}
function SpinSmIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: 'spin 0.7s linear infinite' }}>
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" strokeLinecap="round" />
    </svg>
  );
}
function EyeIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

const TYPE_COLOR: Record<string, { bg: string; text: string }> = {
  pdf: { bg: '#FDEAEA', text: '#C94F4F' },
  image: { bg: '#E8F2FE', text: '#3070C4' },
  video: { bg: '#EFEBFE', text: '#6B4CC4' },
  audio: { bg: '#E6F8FC', text: '#0A8FA4' },
  code: { bg: '#E7F7F0', text: '#1A9460' },
  text: { bg: '#EEEFFE', text: '#4D4BB8' },
  other: { bg: '#EEF0F4', text: '#6B7785' },
};

const s: Record<string, CSSProperties> = {
  rail: { width: 52, height: '100%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f6f5f2', borderLeft: '1px solid #ddd8cf' },
  railToggle: { width: 36, height: 36, borderRadius: 9, border: 'none', background: '#ece8de', color: '#564d3b', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' },

  panel: { width: 300, height: '100%', flexShrink: 0, background: '#f7f6f2', color: '#2f2d28', fontFamily: 'Inter,system-ui,sans-serif', overflow: 'hidden' },
  shell: { display: 'flex', height: '100%' },
  sidebar: { width: 148, borderRight: '1px solid #ddd8cf', background: '#f2f0ea', display: 'flex', flexDirection: 'column' },
  sidebarCollapsed: { width: 52 },
  sidebarTop: { padding: 10, borderBottom: '1px solid #ddd8cf', display: 'flex', flexDirection: 'column', gap: 8 },
  sidebarTopRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  sidebarCollapseBtn: { width: 24, height: 24, borderRadius: 7, border: '1px solid #d6d0c4', background: '#fffdf8', color: '#5c5548', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 },
  brand: { fontSize: 11, fontWeight: 700, letterSpacing: '0.03em', color: '#6a624f' },
  newChatBtn: { border: '1px solid #d6d0c4', borderRadius: 8, background: '#fffdf8', color: '#4f4736', fontSize: 11, fontWeight: 600, padding: '7px 8px', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' },
  historyList: { padding: 8, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 },
  historyRow: { display: 'flex', alignItems: 'center', borderRadius: 8, border: '1px solid transparent', background: 'transparent' },
  historyRowActive: { borderColor: '#d2c9b9', background: '#ece7dd' },
  historyTitleBtn: { flex: 1, border: 'none', background: 'transparent', color: '#4a4538', textAlign: 'left', fontSize: 11, padding: '6px 7px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' },
  threadDeleteBtn: { width: 24, height: 24, border: 'none', borderRadius: 6, background: 'transparent', color: '#8b8271', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', marginRight: 4 },

  main: { flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: '#f8f7f4' },
  header: { height: 48, borderBottom: '1px solid #ddd8cf', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 10px 0 12px' },
  headerTitle: { fontSize: 13, fontWeight: 650, color: '#37342c' },
  collapseBtn: { width: 28, height: 28, borderRadius: 7, border: 'none', background: 'transparent', color: '#7d7668', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' },

  messages: { flex: 1, overflowY: 'auto', padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 14 },
  thinking: { fontSize: 12, color: '#7e786a' },

  bubble: { display: 'flex', flexDirection: 'column', gap: 6 },
  bubbleUser: { alignItems: 'flex-end' },
  bubbleAssistant: { alignItems: 'flex-start' },
  bubbleContent: { maxWidth: '90%', fontSize: 13, lineHeight: 1.6, padding: '10px 12px', borderRadius: 14 },
  assistantBubble: { background: '#fffdf8', border: '1px solid #ded8ca', color: '#2f2d28' },
  userBubble: { background: '#dceeff', border: '1px solid #c2dff6', color: '#11334f' },
  errorBubble: { background: '#fff0f0', border: '1px solid #e6b9b9', color: '#922f2f' },

  saveBtn: { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 600, padding: '4px 8px', borderRadius: 6, border: '1px solid #d9d2c4', background: '#fffdf8', color: '#5a5446', cursor: 'pointer' },
  saveBtnLoading: { opacity: 0.65, cursor: 'not-allowed' },

  citations: { display: 'flex', flexWrap: 'wrap', gap: 5 },
  citationPill: { display: 'inline-flex', alignItems: 'center', gap: 4, border: '1px solid #d6d0c4', borderRadius: 16, background: '#fffdf8', padding: '3px 6px', fontSize: 10 },
  citationAction: { border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 10, padding: 0 },
  citationViewBtn: { border: 'none', background: 'transparent', color: '#716a5d', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center' },

  inputArea: { borderTop: '1px solid #ddd8cf', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6, position: 'relative' },
  pinnedRow: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  pinnedChip: { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 600, padding: '3px 7px', borderRadius: 14, border: '1px solid transparent', maxWidth: 160 },
  pinnedChipDot: { width: 5, height: 5, borderRadius: '50%', flexShrink: 0 },
  pinnedChipLabel: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 },
  pinnedChipX: { border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, fontSize: 10 },

  mentionDropdown: { position: 'absolute', bottom: '100%', left: 12, right: 12, background: '#fffdf8', border: '1px solid #d9d2c4', borderRadius: 10, boxShadow: '0 -4px 18px rgba(0,0,0,0.08)', overflow: 'hidden', zIndex: 20, marginBottom: 4 },
  mentionHeader: { padding: '6px 10px 4px', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', color: '#7a725f', borderBottom: '1px solid #ebe5da', letterSpacing: '0.06em' },
  mentionEmpty: { padding: 10, fontSize: 11, color: '#7c7567' },
  mentionItem: { display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', cursor: 'pointer' },
  mentionItemActive: { background: '#f1ede4' },
  mentionTypeBadge: { fontSize: 8, fontWeight: 700, textTransform: 'uppercase', padding: '2px 6px', borderRadius: 4 },
  mentionLabel: { fontSize: 12, color: '#3a362f', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 },

  textarea: { width: '100%', resize: 'none', border: '1px solid #d8d1c3', borderRadius: 10, padding: '10px 11px', fontSize: 13, fontFamily: 'Inter,system-ui,sans-serif', color: '#2f2d28', background: '#fffdf8', outline: 'none', lineHeight: 1.45, minHeight: 42, maxHeight: 130, boxSizing: 'border-box' },
  inputActions: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  inputHint: { fontSize: 10, color: '#7d7668' },
  sendBtn: { width: 32, height: 32, borderRadius: 9, border: '1px solid #d8d1c3', background: '#f2efe7', color: '#8b8372', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'not-allowed' },
  sendBtnActive: { background: '#2f2d28', color: '#f6f3eb', borderColor: '#2f2d28', cursor: 'pointer' },
  stopBtn: { background: '#fff0f0', color: '#a63d3d', borderColor: '#d9a6a6', cursor: 'pointer' },

  emptyState: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '48px 18px', gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: 650, color: '#312f29' },
  emptyBody: { fontSize: 12, color: '#787162', lineHeight: 1.6, maxWidth: 280 },
};
