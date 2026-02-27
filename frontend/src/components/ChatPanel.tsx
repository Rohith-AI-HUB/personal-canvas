import { useEffect, useRef, useState, useCallback, type CSSProperties, type KeyboardEvent } from 'react';
import { createShapeId, type Editor } from '@tldraw/tldraw';
import { api, type ChatHistoryMessage } from '../api';

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

interface ChatPanelProps {
  sessionId: string;
  isOpen: boolean;
  onToggle: () => void;
  getEditor: () => Editor | null;
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function toPromptHistory(messages: Message[]): ChatHistoryMessage[] {
  return messages
    .filter((msg) => (msg.role === 'user' || msg.role === 'assistant'))
    .filter((msg) => !msg.streaming && !msg.error)
    .filter((msg) => msg.content.trim().length > 0)
    .slice(-10)
    .map((msg) => ({
      role: msg.role,
      content: msg.content.trim(),
    }));
}

export function ChatPanel({ sessionId, isOpen, onToggle, getEditor }: ChatPanelProps) {
  const [messages, setMessages]       = useState<Message[]>([]);
  const [input, setInput]             = useState('');
  const [isStreaming, setIsStreaming]  = useState(false);
  const [citationMap, setCitationMap] = useState<Map<string, CitationMeta>>(new Map());

  const abortRef      = useRef<AbortController | null>(null);
  const bottomRef     = useRef<HTMLDivElement>(null);
  const inputRef      = useRef<HTMLTextAreaElement>(null);
  const scrollRef     = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  const resolveCitations = useCallback(async (fileIds: string[]) => {
    const unique = [...new Set(fileIds)];
    if (unique.length === 0) return;

    const results = await Promise.allSettled(unique.map((id) => api.getFile(id)));
    setCitationMap((prev) => {
      const next = new Map(prev);
      results.forEach((result, i) => {
        const fileId = unique[i];
        if (!fileId || next.has(fileId)) return;
        if (result.status === 'fulfilled') {
          const file = result.value;
          next.set(file.id, {
            file_id: file.id,
            label: file.metadata?.ai_title?.trim() || file.filename,
            file_type: file.file_type,
          });
          return;
        }
        next.set(fileId, {
          file_id: fileId,
          label: 'Unknown file',
          file_type: 'other',
        });
      });
      return next;
    });
  }, []);

  useEffect(() => {
    api.getChatHistory(sessionId)
      .then(({ messages: hist }) => {
        if (hist.length === 0) {
          setMessages([]);
          return;
        }

        setMessages(hist.map((m) => ({
          id: String(m.id), role: m.role, content: m.content, citations: m.citations,
        })));

        const citations = hist.flatMap((m) => m.citations ?? []);
        void resolveCitations(citations);
      })
      .catch(() => {});
  }, [sessionId, resolveCitations]);

  useEffect(() => {
    if (isAtBottomRef.current) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  }, []);

  const jumpToFile = useCallback((fileId: string) => {
    const editor = getEditor();
    if (!editor) return;
    const shapeId = createShapeId(fileId);
    if (!editor.getShape(shapeId)) return;
    editor.select(shapeId);
    (editor as any).zoomToSelection?.({ animation: { duration: 320 } });
  }, [getEditor]);

  const sendMessage = useCallback(() => {
    const text = input.trim();
    if (!text || isStreaming) return;
    const promptHistory = toPromptHistory(messages);

    const userMsg: Message = { id: uid(), role: 'user', content: text, citations: [] };
    const aId = uid();
    const assistantMsg: Message = { id: aId, role: 'assistant', content: '', citations: [], streaming: true };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput('');
    setIsStreaming(true);
    isAtBottomRef.current = true;

    abortRef.current = api.streamChat(
      text, sessionId, promptHistory,
      (token) => setMessages((prev) => prev.map((m) => m.id === aId ? { ...m, content: m.content + token } : m)),
      (citations) => {
        setMessages((prev) => prev.map((m) => m.id === aId ? { ...m, streaming: false, citations } : m));
        setIsStreaming(false);
        resolveCitations(citations);
      },
      (errMsg) => {
        setMessages((prev) => prev.map((m) => m.id === aId ? { ...m, content: errMsg, streaming: false, error: true, citations: [] } : m));
        setIsStreaming(false);
      }
    );
  }, [input, isStreaming, messages, sessionId, resolveCitations]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }, [sendMessage]);

  const handleAbort = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
    setMessages((prev) => prev.map((m) => m.streaming ? { ...m, streaming: false } : m));
  }, []);

  if (!isOpen) {
    return (
      <div style={s.rail}>
        <button style={s.railToggle} onClick={onToggle} title="Open chat"><ChatIcon /></button>
        {messages.length > 0 && (
          <div style={s.railBadge}>{messages.filter(m => m.role === 'assistant').length}</div>
        )}
      </div>
    );
  }

  return (
    <div style={s.panel}>
      <div style={s.header}>
        <div style={s.headerLeft}>
          <div style={s.headerIcon}><ChatIcon /></div>
          <div>
            <div style={s.headerTitle}>Ask your files</div>
            <div style={s.headerSub}>RAG &middot; {messages.filter(m => m.role === 'user').length} questions</div>
          </div>
        </div>
        <button style={s.collapseBtn} onClick={onToggle} title="Close chat"><ChevronRightIcon /></button>
      </div>

      <div style={s.messages} ref={scrollRef} onScroll={handleScroll}>
        {messages.length === 0 && <EmptyState />}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} citationMap={citationMap} onCitationClick={jumpToFile} />
        ))}
        {isStreaming && messages[messages.length - 1]?.content === '' && (
          <div style={s.typingDots}><span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" /></div>
        )}
        <div ref={bottomRef} />
      </div>

      <div style={s.inputArea}>
        <textarea
          ref={inputRef}
          id="chat-textarea"
          name="chat-textarea"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask anything about your files..."
          style={s.textarea}
          rows={1}
          disabled={isStreaming}
        />
        <div style={s.inputActions}>
          <span style={s.inputHint}>Return to send &middot; Shift+Return for newline</span>
          {isStreaming ? (
            <button style={{ ...s.sendBtn, ...s.stopBtn }} onClick={handleAbort} title="Stop"><StopIcon /></button>
          ) : (
            <button style={{ ...s.sendBtn, ...(input.trim() ? s.sendBtnActive : {}) }} onClick={sendMessage} disabled={!input.trim()} title="Send">
              <SendIcon />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ msg, citationMap, onCitationClick }: {
  msg: Message; citationMap: Map<string, CitationMeta>; onCitationClick: (id: string) => void;
}) {
  const isUser = msg.role === 'user';
  return (
    <div style={{ ...s.bubble, ...(isUser ? s.bubbleUser : s.bubbleAssistant) }}>
      <div style={{ ...s.bubbleLabel, ...(isUser ? s.bubbleLabelUser : s.bubbleLabelAssistant) }}>
        {isUser ? 'You' : 'AI'}
      </div>
      <div style={{ ...s.bubbleContent, ...(isUser ? s.bubbleContentUser : s.bubbleContentAssistant), ...(msg.error ? s.bubbleContentError : {}) }}>
        {msg.streaming && msg.content === ''
          ? <span style={{ opacity: 0.4 }}>Thinking...</span>
          : <FormattedText text={msg.content} />
        }
        {msg.streaming && msg.content !== '' && <span style={s.cursor}>&#9607;</span>}
      </div>
      {msg.citations.length > 0 && (
        <div style={s.citations}>
          <span style={s.citationsLabel}>Sources</span>
          <div style={s.citationPills}>
            {msg.citations.map((id) => {
              const meta = citationMap.get(id);
              return <CitationPill key={id} fileId={id} label={meta?.label ?? '...'} fileType={meta?.file_type ?? 'other'} onClick={onCitationClick} />;
            })}
          </div>
        </div>
      )}
    </div>
  );
}

const TYPE_COLOR: Record<string, { bg: string; text: string }> = {
  pdf:   { bg: '#FDEAEA', text: '#C94F4F' }, image: { bg: '#E8F2FE', text: '#3070C4' },
  video: { bg: '#EFEBFE', text: '#6B4CC4' }, audio: { bg: '#E6F8FC', text: '#0A8FA4' },
  code:  { bg: '#E7F7F0', text: '#1A9460' }, text:  { bg: '#EEEFFE', text: '#4D4BB8' },
  other: { bg: '#EEF0F4', text: '#6B7785' },
};

function CitationPill({ fileId, label, fileType, onClick }: {
  fileId: string; label: string; fileType: string; onClick: (id: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const colors = TYPE_COLOR[fileType] ?? TYPE_COLOR.other;
  const shortLabel = label.length > 28 ? label.slice(0, 26) + '\u2026' : label;
  return (
    <button
      style={{ ...s.citationPill, background: hovered ? colors.bg : 'var(--bg-surface-2)', color: hovered ? colors.text : 'var(--text-3)', borderColor: hovered ? colors.text + '30' : 'var(--border)' }}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      onClick={() => onClick(fileId)} title={'Jump to: ' + label}
    >
      <span style={s.citationDot} />{shortLabel}
    </button>
  );
}

function FormattedText({ text }: { text: string }) {
  const paragraphs = text.split(/\n\n+/);
  return (
    <>{paragraphs.map((para, i) => (
      <p key={i} style={{ margin: i === 0 ? 0 : '8px 0 0', lineHeight: 1.6 }}>
        {para.split('\n').map((line, j) => (
          <span key={j}>{j > 0 && <br />}{line.split(/(\*\*[^*]+\*\*)/).map((part, k) =>
            part.startsWith('**') && part.endsWith('**') ? <strong key={k}>{part.slice(2, -2)}</strong> : part
          )}</span>
        ))}
      </p>
    ))}</>
  );
}

function EmptyState() {
  return (
    <div style={s.emptyState}>
      <div style={s.emptyIcon}><SparkleIcon /></div>
      <div style={s.emptyTitle}>Chat with your files</div>
      <div style={s.emptyBody}>Ask anything across your entire knowledge base. The AI retrieves relevant content and cites sources.</div>
      <div style={s.exampleQuestions}>
        {['Summarize my research on transformers', 'What notes do I have about machine learning?', 'Compare the PDFs I added this week'].map((q) => (
          <div key={q} style={s.exampleQ}>{q}</div>
        ))}
      </div>
    </div>
  );
}

function ChatIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>; }
function ChevronRightIcon() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>; }
function SendIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>; }
function StopIcon() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>; }
function SparkleIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/></svg>; }

const s: Record<string, CSSProperties> = {
  rail: { width: 52, height: '100%', flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 14, gap: 8, background: 'var(--bg-surface)', borderLeft: '1px solid var(--border)', boxShadow: '-2px 0 12px rgba(20,15,10,0.04)', zIndex: 10, position: 'relative' },
  railToggle: { width: 34, height: 34, borderRadius: 'var(--radius-sm)', background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', border: 'none' },
  railBadge: { fontSize: 9, fontWeight: 700, background: 'var(--accent)', color: '#fff', borderRadius: 10, padding: '1px 5px', fontFamily: "'Inter', system-ui, sans-serif" },
  panel: { width: 300, height: '100%', flexShrink: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg-surface)', borderLeft: '1px solid var(--border)', boxShadow: '-2px 0 12px rgba(20,15,10,0.04)', fontFamily: "'Inter', system-ui, sans-serif", zIndex: 10, overflow: 'hidden' },
  header: { padding: '14px 14px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', flexShrink: 0 },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 10 },
  headerIcon: { width: 34, height: 34, borderRadius: 'var(--radius-sm)', background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  headerTitle: { fontSize: 14, fontWeight: 600, color: 'var(--text-1)', letterSpacing: '-0.02em', lineHeight: 1.2 },
  headerSub: { fontSize: 11, color: 'var(--text-4)', marginTop: 1 },
  collapseBtn: { width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--text-4)', cursor: 'pointer', border: 'none' },
  messages: { flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 16 },
  bubble: { display: 'flex', flexDirection: 'column', gap: 4 },
  bubbleUser: { alignItems: 'flex-end' },
  bubbleAssistant: { alignItems: 'flex-start' },
  bubbleLabel: { fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' as const, opacity: 0.5 },
  bubbleLabelUser: { color: 'var(--accent)' },
  bubbleLabelAssistant: { color: 'var(--text-3)' },
  bubbleContent: { fontSize: 12.5, lineHeight: 1.6, padding: '9px 12px', borderRadius: 12, maxWidth: '88%', wordBreak: 'break-word' as const, color: 'var(--text-1)' },
  bubbleContentUser: { background: 'var(--accent)', color: '#ffffff', borderBottomRightRadius: 4 },
  bubbleContentAssistant: { background: 'var(--bg-surface-2)', border: '1px solid var(--border)', borderBottomLeftRadius: 4 },
  bubbleContentError: { background: 'var(--color-error-soft)', color: 'var(--color-error)', border: '1px solid rgba(201,64,60,0.12)' },
  cursor: { display: 'inline-block', marginLeft: 1, opacity: 0.7 },
  citations: { display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 4, maxWidth: '94%' },
  citationsLabel: { fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' as const, color: 'var(--text-4)' },
  citationPills: { display: 'flex', flexWrap: 'wrap' as const, gap: 4 },
  citationPill: { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 500, padding: '3px 8px', borderRadius: 'var(--radius-full)', border: '1px solid var(--border)', cursor: 'pointer', transition: 'all 120ms ease', fontFamily: "'Inter', system-ui, sans-serif", letterSpacing: '-0.01em' },
  citationDot: { width: 6, height: 6, borderRadius: '50%', background: 'currentColor', flexShrink: 0, opacity: 0.6 },
  typingDots: { display: 'flex', gap: 4, paddingLeft: 12, alignItems: 'center', height: 20 },
  inputArea: { borderTop: '1px solid var(--border)', padding: '10px 10px 12px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6 },
  textarea: { width: '100%', resize: 'none' as const, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '8px 10px', fontSize: 12.5, fontFamily: "'Inter', system-ui, sans-serif", color: 'var(--text-1)', background: 'var(--bg-canvas)', outline: 'none', lineHeight: 1.5, minHeight: 38, maxHeight: 120, boxSizing: 'border-box' as const, transition: 'border-color 150ms ease' },
  inputActions: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  inputHint: { fontSize: 9.5, color: 'var(--text-5)', letterSpacing: '0.01em' },
  sendBtn: { width: 30, height: 30, borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-surface-2)', color: 'var(--text-4)', border: '1px solid var(--border)', cursor: 'not-allowed', transition: 'all 150ms ease', flexShrink: 0 },
  sendBtnActive: { background: 'var(--accent)', color: '#ffffff', border: '1px solid var(--accent)', cursor: 'pointer' },
  stopBtn: { background: 'var(--color-error-soft)', color: 'var(--color-error)', border: '1px solid rgba(201,64,60,0.18)', cursor: 'pointer' },
  emptyState: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '32px 16px 16px', gap: 10, textAlign: 'center' as const },
  emptyIcon: { color: 'var(--accent)', opacity: 0.6, marginBottom: 2 },
  emptyTitle: { fontSize: 13, fontWeight: 600, color: 'var(--text-2)', letterSpacing: '-0.02em' },
  emptyBody: { fontSize: 11.5, color: 'var(--text-4)', lineHeight: 1.6, maxWidth: 220 },
  exampleQuestions: { display: 'flex', flexDirection: 'column', gap: 5, width: '100%', marginTop: 6 },
  exampleQ: { fontSize: 11, color: 'var(--text-3)', background: 'var(--bg-surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '6px 10px', textAlign: 'left' as const, cursor: 'default', lineHeight: 1.4, fontStyle: 'italic' as const },
};
