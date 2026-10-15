import { useState, useCallback, type ReactNode } from 'react';

export function DragPlaceholder() {
  return <div className="rounded-xl bg-black/80 border border-white/20 h-10 my-1" />;
}

export function useListDrag<T>(items: T[], onReorder: (from: number, to: number) => void) {
  const [dragId, setDragId] = useState<number | null>(null);
  const [overId, setOverId] = useState<number | null>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent, idx: number) => {
    e.preventDefault();
    setDragId(idx);
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragId === null) return;
    const el = document.getElementById('drag-visual');
    if (!el) {
      const clone = document.createElement('div');
      clone.id = 'drag-visual';
      clone.style.position = 'fixed';
      clone.style.pointerEvents = 'none';
      clone.style.zIndex = '9999';
      clone.style.opacity = '0.9';
      clone.innerHTML = '<div style="background:#000;border-radius:10px;padding:8px 14px;color:#fff;font-size:14px;box-shadow:0 12px 30px rgba(0,0,0,0.6);">Dragging</div>';
      document.body.appendChild(clone);
    }
    const visual = document.getElementById('drag-visual');
    if (visual) {
      visual.style.left = `${e.clientX + 10}px`;
      visual.style.top = `${e.clientY - 10}px`;
    }
    // determine over index by elementFromPoint
    const target = document.elementFromPoint(e.clientX, e.clientY);
    const row = target?.closest('[data-drag-row]');
    if (row && row.getAttribute) {
      const i = parseInt(row.getAttribute('data-drag-row') || '-1', 10);
      if (!isNaN(i)) setOverId(i);
    }
  }, [dragId]);

  const handleMouseUp = useCallback(() => {
    if (dragId !== null && overId !== null && dragId !== overId) {
      onReorder(dragId, overId);
    }
    setDragId(null);
    setOverId(null);
    const v = document.getElementById('drag-visual');
    if (v) document.body.removeChild(v);
  }, [dragId, overId, onReorder]);

  return { dragId, overId, handleMouseDown, setOverId, handleMouseUp, handleMouseMove };
}
