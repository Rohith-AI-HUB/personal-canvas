import { useEffect, useRef, useState, useCallback, type CSSProperties, type KeyboardEvent } from 'react';
import { createShapeId, type Editor } from '@tldraw/tldraw';
import { api } from '../api';

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

  useEffect(() => {
    api.getChatHistory(sessionId)
      .then(({ messages: hist }) => {
        if (hist.length === 0) return;
        setMessages(hist.map((m) => ({
          id: String(m.id), role: m.role, content: m.content, citations: m.citations,
        })));
      })
      .catch(() => {});
  }, [sessionId]);

  useEffect(() => {
    if (isAtBottomRef.current) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  }, []);

  const resolveCitations = useCallback(async (fileIds: string[]) => {
    const unresolved = fileIds.filter((id) => !citationMap.has(id));
    if (unresolved.length === 0) return;
    const results = await Promise.allSettled(unresolved.map((id) => api.getFile(id)));
    setCitationMap((prev) => {
      const next = new Map(prev);
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') {
          const f = r.value;
          next.set(f.id, { file_id: f.id, label: f.metadata?.ai_title?.trim() || f.filename, file_type: f.file_type });
        } else {
          next.set(unresolved[i], { file_id: unresolved[i], label: 'Unknown file', file_type: 'other' });
        }
      });
      return next;
    });
  }, [citationMap]);

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
    const userMsg: Message = { id: uid(), role: 'user', content: text, citations: [] };
    const aId = uid();
    const assistantMsg: Message = { id: aId, role: 'assistant', content: '', citations: [], streaming: true };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput('');
    setIsStreaming(true);
    isAtBottomRef.current = true;

    abortRef.current = api.streamChat(
      text, sessionId,
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
  }, [input, isStreaming, sessionId, resolveCitations]);

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
