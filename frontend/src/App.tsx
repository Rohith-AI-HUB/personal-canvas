import { useRef } from 'react';
import type { Editor } from '@tldraw/tldraw';
import { createShapeId } from '@tldraw/tldraw';
import { fileStore, CARD_WIDTH, CARD_HEIGHT } from './components/FileCard';
import type { FileRecord } from './api';
import { Canvas } from './components/Canvas';
import { Sidebar } from './components/Sidebar';
import './App.css';

export default function App() {
  const editorRef = useRef<Editor | null>(null);

  const handleFileUploaded = (file: FileRecord) => {
    const editor = editorRef.current;
    if (!editor) return;
    fileStore.set(file.id, file);
    const shapeId = createShapeId(file.id);
    if (editor.getShape(shapeId)) return;

    editor.createShape({
      id: shapeId,
      type: 'file-card',
      x: 100 + Math.random() * 300,
      y: 100 + Math.random() * 200,
      props: { w: CARD_WIDTH, h: CARD_HEIGHT, fileId: file.id, _v: 0 },
      meta: { fileId: file.id },
    } as any);
  };

  return (
    <div className="app-layout">
      <Sidebar onUpload={handleFileUploaded} />
      <Canvas
        onFileDropped={handleFileUploaded}
        onMount={(ed) => { editorRef.current = ed; }}
      />
    </div>
  );
}
