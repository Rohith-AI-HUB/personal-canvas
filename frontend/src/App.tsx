import { useRef, useState } from 'react';
import type { Editor } from '@tldraw/tldraw';
import { createShapeId } from '@tldraw/tldraw';
import { fileStore, CARD_WIDTH, CARD_HEIGHT } from './components/FileCard';
import type { FileRecord } from './api';
import { Canvas } from './components/Canvas';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { ChatPanel } from './components/ChatPanel';
import './App.css';

export default function App() {
  const editorRef = useRef<Editor | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isChatOpen, setIsChatOpen] = useState(true);

  // One chat session per app launch.
  const [sessionId] = useState(() => crypto.randomUUID());

  const handleFileUploaded = (file: FileRecord) => {
    const editor = editorRef.current;
    if (!editor) return;

    fileStore.set(file.id, file);
    const shapeId = createShapeId(file.id);
    if (editor.getShape(shapeId)) return;

    editor.createShape({
      id: shapeId,
      type: 'file-card',
      x: 120 + Math.random() * 320,
      y: 120 + Math.random() * 200,
      props: { w: CARD_WIDTH, h: CARD_HEIGHT, fileId: file.id, _v: 0 },
      meta: { fileId: file.id },
    } as any);
  };

  return (
    <div className="app-layout">
      {/* Left sidebar */}
      <Sidebar
        isOpen={isSidebarOpen}
        onUpload={handleFileUploaded}
        onToggle={() => setIsSidebarOpen((v) => !v)}
      />

      {/* Canvas workspace */}
      <div className="workspace">
        {/* Floating search + menu toggle */}
        <div className="topbar">
          <TopBar
            getEditor={() => editorRef.current}
          />
        </div>

        <Canvas
          onFileDropped={handleFileUploaded}
          onMount={(ed) => { editorRef.current = ed; }}
        />
      </div>

      <ChatPanel
        sessionId={sessionId}
        isOpen={isChatOpen}
        onToggle={() => setIsChatOpen((v) => !v)}
        getEditor={() => editorRef.current}
      />
    </div>
  );
}
