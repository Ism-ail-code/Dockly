import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  Circle,
  Crop,
  Eraser,
  Highlighter,
  Minus,
  MousePointer2,
  Pencil,
  Pen,
  Redo2,
  Save,
  Square,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useApp } from '@/app/store';
import { BackButton, useToast } from '@/components/ui';

type Tool = 'pen' | 'pencil' | 'highlighter' | 'arrow' | 'rect' | 'ellipse' | 'line' | 'text' | 'blur' | 'crop' | 'pan';

interface Point {
  x: number;
  y: number;
}

interface Op {
  type: 'path' | 'shape' | 'text' | 'blur';
  tool: Tool;
  color: string;
  size: number;
  alpha: number;
  points?: Point[];
  from?: Point;
  to?: Point;
  shape?: 'arrow' | 'rect' | 'ellipse' | 'line';
  x?: number;
  y?: number;
  text?: string;
}

const COLORS = ['#111827', '#ffffff', '#ef4444', '#f97316', '#fde047', '#22c55e', '#3b82f6', '#a855f7'];
const DEFAULT_COLOR: Record<Tool, string> = {
  pen: '#ef4444', pencil: '#111827', highlighter: '#fde047',
  arrow: '#ef4444', rect: '#3b82f6', ellipse: '#22c55e', line: '#111827',
  text: '#ffffff', blur: '#ffffff', crop: '#ffffff', pan: '#ffffff',
};
const SIZES: Record<Tool, number[]> = {
  pen: [1, 2, 3], pencil: [3, 5, 8], highlighter: [12, 18, 26],
  arrow: [2, 3, 5], rect: [2, 3, 5], ellipse: [2, 3, 5], line: [2, 3, 5],
  text: [16, 22, 30], blur: [10, 20, 40], crop: [0], pan: [0],
};
const ALPHA: Record<Tool, number> = {
  pen: 1, pencil: 0.85, highlighter: 0.38,
  arrow: 1, rect: 1, ellipse: 1, line: 1,
  text: 1, blur: 0.9, crop: 1, pan: 1,
};

const TOOLS: { id: Tool; icon: typeof Pen; label: string }[] = [
  { id: 'pen', icon: Pen, label: 'Pen' },
  { id: 'pencil', icon: Pencil, label: 'Pencil' },
  { id: 'highlighter', icon: Highlighter, label: 'Highlighter' },
  { id: 'arrow', icon: ArrowRight, label: 'Arrow' },
  { id: 'rect', icon: Square, label: 'Rectangle' },
  { id: 'ellipse', icon: Circle, label: 'Circle' },
  { id: 'line', icon: Minus, label: 'Line' },
  { id: 'text', icon: Type, label: 'Text' },
  { id: 'blur', icon: Eraser, label: 'Blur' },
  { id: 'crop', icon: Crop, label: 'Crop' },
];

export function AnnotationEditor() {
  const open = useApp((s) => s.annotationOpen);
  const target = useApp((s) => s.annotationTarget);
  const setOpen = useApp((s) => s.setAnnotationOpen);
  const toast = useToast();

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [ops, setOps] = useState<Op[]>([]);
  const [redo, setRedo] = useState<Op[]>([]);
  const [draft, setDraft] = useState<Op | null>(null);
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState(DEFAULT_COLOR.pen);
  const [sizeIdx, setSizeIdx] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [fitScale, setFitScale] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [textDraft, setTextDraft] = useState<Point | null>(null);
  const [textValue, setTextValue] = useState('');
  const [cropRect, setCropRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [saving, setSaving] = useState(false);

  const pointerDown = useRef<Point | null>(null);
  const lastPoint = useRef<Point | null>(null);

  // Esc closes the annotation editor without saving (matches the Back button).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  // load image
  useEffect(() => {
    if (!open || !target) return;
    (async () => {
      const dataUrl = await window.nock.screenshots.read(target);
      if (!dataUrl) {
        setOpen(false);
        return;
      }
      const image = new Image();
      image.onload = () => {
        setImg(image);
        setOps([]);
        setRedo([]);
        setDraft(null);
        setCropRect(null);
        setTextDraft(null);
        setTool('pen');
        setColor(DEFAULT_COLOR.pen);
        setSizeIdx(1);
        setPan({ x: 0, y: 0 });
      };
      image.onerror = () => {
        toast.warn('Could not load screenshot');
        setOpen(false);
      };
      image.src = dataUrl;
    })();
  }, [open, target, setOpen]);

  // fit scale
  useEffect(() => {
    if (!img) return;
    const calc = () => {
      const area = wrapRef.current?.getBoundingClientRect();
      if (!area) return;
      const s = Math.min(area.width / img.naturalWidth, area.height / img.naturalHeight, 1.6);
      setFitScale(s);
      setZoom(s);
      setPan({ x: 0, y: 0 });
    };
    calc();
    const ro = new ResizeObserver(calc);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [img]);

  const size = useMemo(() => (SIZES[tool] ?? [2])[Math.min(sizeIdx, (SIZES[tool] ?? [2]).length - 1)], [tool, sizeIdx]);

  const drawAll = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext('2d')!;
    const W = img.naturalWidth;
    const H = img.naturalHeight;
    canvas.width = W;
    canvas.height = H;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(img, 0, 0);

    const drawOp = (op: Op) => {
      ctx.save();
      if (op.type === 'path' && op.points && op.points.length > 1) {
        ctx.strokeStyle = op.color;
        ctx.lineWidth = op.size;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.globalAlpha = op.alpha;
        ctx.beginPath();
        ctx.moveTo(op.points[0].x, op.points[0].y);
        for (let i = 1; i < op.points.length - 1; i++) {
          const xc = (op.points[i].x + op.points[i + 1].x) / 2;
          const yc = (op.points[i].y + op.points[i + 1].y) / 2;
          ctx.quadraticCurveTo(op.points[i].x, op.points[i].y, xc, yc);
        }
        ctx.lineTo(op.points[op.points.length - 1].x, op.points[op.points.length - 1].y);
        ctx.stroke();
      } else if (op.type === 'blur' && op.from && op.to) {
        const r = op.size;
        ctx.save();
        ctx.beginPath();
        ctx.arc((op.from.x + op.to.x) / 2, (op.from.y + op.to.y) / 2, r, 0, Math.PI * 2);
        ctx.clip();
        ctx.filter = `blur(${Math.max(1, r / 2)}px)`;
        ctx.globalAlpha = op.alpha;
        ctx.drawImage(img, 0, 0);
        ctx.restore();
      } else if (op.type === 'shape' && op.from && op.to) {
        ctx.strokeStyle = op.color;
        ctx.lineWidth = op.size;
        ctx.lineCap = 'round';
        ctx.globalAlpha = op.alpha;
        const x = Math.min(op.from.x, op.to.x);
        const y = Math.min(op.from.y, op.to.y);
        const w = Math.abs(op.to.x - op.from.x);
        const h = Math.abs(op.to.y - op.from.y);
        ctx.beginPath();
        if (op.shape === 'rect') ctx.rect(x, y, w, h);
        else if (op.shape === 'ellipse') ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        else if (op.shape === 'line') {
          ctx.moveTo(op.from.x, op.from.y);
          ctx.lineTo(op.to.x, op.to.y);
        } else if (op.shape === 'arrow') {
          ctx.moveTo(op.from.x, op.from.y);
          ctx.lineTo(op.to.x, op.to.y);
          const ang = Math.atan2(op.to.y - op.from.y, op.to.x - op.from.x);
          const len = Math.max(10, op.size * 4);
          ctx.moveTo(op.to.x, op.to.y);
          ctx.lineTo(op.to.x - len * Math.cos(ang - 0.4), op.to.y - len * Math.sin(ang - 0.4));
          ctx.moveTo(op.to.x, op.to.y);
          ctx.lineTo(op.to.x - len * Math.cos(ang + 0.4), op.to.y - len * Math.sin(ang + 0.4));
        }
        ctx.stroke();
      } else if (op.type === 'text' && op.x !== undefined && op.y !== undefined && op.text) {
        ctx.font = `600 ${op.size}px "Segoe UI", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = Math.max(3, op.size / 5);
        ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.globalAlpha = 1;
        ctx.strokeText(op.text, op.x, op.y);
        ctx.fillStyle = op.color;
        ctx.fillText(op.text, op.x, op.y);
      }
      ctx.restore();
    };

    for (const op of ops) drawOp(op);
    if (draft) drawOp(draft);
    if (cropRect) {
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, W, H);
      ctx.clearRect(cropRect.x, cropRect.y, cropRect.w, cropRect.h);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.strokeRect(cropRect.x, cropRect.y, cropRect.w, cropRect.h);
      ctx.restore();
    }
  }, [img, ops, draft, cropRect]);

  useEffect(() => {
    drawAll();
  }, [drawAll]);

  const toImageCoords = useCallback(
    (e: React.PointerEvent): Point => {
      const rect = canvasRef.current!.getBoundingClientRect();
      return { x: (e.clientX - rect.left) / zoom, y: (e.clientY - rect.top) / zoom };
    },
    [zoom],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (!img) return;
    const p = toImageCoords(e);
    pointerDown.current = p;
    lastPoint.current = p;
    e.currentTarget.setPointerCapture(e.pointerId);

    if (tool === 'pan') {
      setPan((prev) => ({ x: prev.x + e.movementX, y: prev.y + e.movementY }));
      return;
    }
    if (tool === 'text') {
      setTextDraft(p);
      setTextValue('');
      return;
    }
    if (tool === 'crop') {
      setCropRect({ x: p.x, y: p.y, w: 0, h: 0 });
      return;
    }
    setDraft({ type: tool === 'blur' ? 'blur' : tool === 'arrow' || tool === 'rect' || tool === 'ellipse' || tool === 'line' ? 'shape' : 'path', tool, color, size, alpha: ALPHA[tool], points: [p], from: p, to: p, shape: tool === 'arrow' || tool === 'rect' || tool === 'ellipse' || tool === 'line' ? tool : undefined });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointerDown.current) return;
    const p = toImageCoords(e);
    if (tool === 'crop') {
      const from = pointerDown.current;
      setCropRect({ x: Math.min(from.x, p.x), y: Math.min(from.y, p.y), w: Math.abs(p.x - from.x), h: Math.abs(p.y - from.y) });
      return;
    }
    if (tool === 'pan') {
      setPan((prev) => ({ x: prev.x + e.movementX, y: prev.y + e.movementY }));
      return;
    }
    if (draft && draft.type === 'path') {
      setDraft((d) => (d ? { ...d, points: [...(d.points ?? []), p] } : d));
    } else if (draft) {
      setDraft((d) => (d ? { ...d, to: p } : d));
    }
    lastPoint.current = p;
  };

  const onPointerUp = () => {
    if (draft) {
      if (draft.type === 'path' && (draft.points?.length ?? 0) > 1) {
        setOps((o) => [...o, draft]);
        setRedo([]);
      } else if (draft.type === 'shape' && draft.from && draft.to) {
        setOps((o) => [...o, draft]);
        setRedo([]);
      } else if (draft.type === 'blur' && draft.from && draft.to) {
        setOps((o) => [...o, draft]);
        setRedo([]);
      }
    }
    setDraft(null);
    pointerDown.current = null;
    lastPoint.current = null;
  };

  const commitText = () => {
    if (textDraft && textValue.trim()) {
      setOps((o) => [...o, { type: 'text', tool: 'text', color, size, alpha: 1, x: textDraft.x, y: textDraft.y, text: textValue.trim() }]);
      setRedo([]);
    }
    setTextDraft(null);
    setTextValue('');
  };

  const applyCrop = () => {
    const r = cropRect;
    const canvas = canvasRef.current;
    if (!r || !canvas || r.w < 4 || r.h < 4) {
      setCropRect(null);
      return;
    }
    const out = document.createElement('canvas');
    out.width = Math.round(r.w);
    out.height = Math.round(r.h);
    out.getContext('2d')!.drawImage(canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    const image = new Image();
    image.onload = () => {
      setImg(image);
      setOps([]);
      setRedo([]);
      setCropRect(null);
    };
    image.src = out.toDataURL('image/png');
  };

  const undo = () => {
    if (ops.length === 0) return;
    setRedo((r) => [ops[ops.length - 1], ...r]);
    setOps((o) => o.slice(0, -1));
  };
  const redoAction = () => {
    if (redo.length === 0) return;
    setOps((o) => [...o, redo[0]]);
    setRedo((r) => r.slice(1));
  };

  const save = async () => {
    if (!target || saving) return;
    setSaving(true);
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const out = document.createElement('canvas');
      out.width = img!.naturalWidth;
      out.height = img!.naturalHeight;
      const octx = out.getContext('2d')!;
      octx.drawImage(canvas, 0, 0);
      const blob = await new Promise<Blob | null>((res) => out.toBlob(res, 'image/png'));
      if (!blob) throw new Error('encode failed');
      const buf = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      const CHUNK = 0x8000;
      for (let i = 0; i < buf.length; i += CHUNK) {
        binary += String.fromCharCode(...buf.subarray(i, i + CHUNK));
      }
      const b64 = btoa(binary);
      await window.nock.screenshots.replace(target, b64);
      toast.success('Annotation saved to your note');
      setOpen(false);
    } catch (err) {
      toast.warn('Could not save annotation');
      console.log('annotate save error', err);
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;
  if (!img) {
    return (
      <div className="modal-backdrop">
        <div className="skeleton" style={{ position: 'relative', width: 420, height: 300, borderRadius: 20 }}>
          <BackButton
            label="Return to note"
            onClick={() => setOpen(false)}
            tipSide="left"
            style={{ position: 'absolute', top: 10, right: 10 }}
          />
        </div>
      </div>
    );
  }

  const pickTool = (t: Tool) => {
    setTool(t);
    if (t !== 'crop') setCropRect(null);
    if (t !== 'text') setTextDraft(null);
    setColor(DEFAULT_COLOR[t]);
    if (t === 'pan') setTextDraft(null);
  };

  return (
    <div className="annotate-backdrop" style={{ background: 'rgba(8,10,16,0.92)' }}>
      {/* tool rail */}
      <div className="annotate-rail">
        {TOOLS.map((t) => (
          <button key={t.id} className={`annotate-tool${tool === t.id ? ' active' : ''}`} onClick={() => pickTool(t.id)} data-tooltip={t.label} data-tooltip-side="right">
            <t.icon size={17} />
          </button>
        ))}
      </div>

      {/* top bar */}
      <div className="annotate-top">
        <div className="annotate-title t-display">
          <Crop size={15} />
          Annotate screenshot
        </div>
        <div className="annotate-top-right">
          <button className="btn btn-ghost btn-icon" onClick={undo} disabled={ops.length === 0} data-tooltip="Undo">
            <Undo2 size={15} />
          </button>
          <button className="btn btn-ghost btn-icon" onClick={redoAction} disabled={redo.length === 0} data-tooltip="Redo">
            <Redo2 size={15} />
          </button>
          <div className="annotate-sep" />
          <button className="btn btn-ghost btn-icon" onClick={() => { setZoom((z) => z * 1.25); }} data-tooltip="Zoom in">
            <ZoomIn size={15} />
          </button>
          <button className="btn btn-ghost btn-icon" onClick={() => { setZoom((z) => z / 1.25); }} data-tooltip="Zoom out">
            <ZoomOut size={15} />
          </button>
          <button className="btn btn-ghost btn-icon" onClick={() => { setZoom(fitScale); setPan({ x: 0, y: 0 }); }} data-tooltip="Fit screen">
            <MousePointer2 size={15} />
          </button>
          <div className="annotate-sep" />
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            <Save size={14} />
            {saving ? 'Saving…' : 'Save to note'}
          </button>
          <BackButton label="Return to note" onClick={() => setOpen(false)} tipSide="left" />
        </div>
      </div>

      {/* properties */}
      <div className="annotate-props">
        <div className="annotate-colors">
          {COLORS.map((c) => (
            <button
              key={c}
              className={`color-dot${color === c ? ' active' : ''}`}
              style={{ background: c, border: c === '#ffffff' ? '1px solid var(--border-strong)' : 'none' }}
              data-tooltip="Color"
              onClick={() => setColor(c)}
            />
          ))}
        </div>
        <div className="annotate-sizes">
          {SIZES[tool].map((s, i) => (
            <button
              key={i}
              className={`size-dot${sizeIdx === i ? ' active' : ''}`}
              onClick={() => setSizeIdx(i)}
              data-tooltip="Stroke size"
              style={{ width: Math.min(22, 6 + s), height: Math.min(22, 6 + s) }}
            />
          ))}
        </div>
      </div>

      {/* canvas */}
      <div ref={wrapRef} className="annotate-stage">
        <div
          className="annotate-canvas-wrap"
          style={{
            width: img.naturalWidth * zoom,
            height: img.naturalHeight * zoom,
            transform: `translate(${pan.x}px, ${pan.y}px)`,
          }}
        >
          <canvas
            ref={canvasRef}
            className="annotate-canvas"
            style={{
              width: img.naturalWidth * zoom,
              height: img.naturalHeight * zoom,
              cursor: tool === 'pan' ? 'grab' : 'crosshair',
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
          />
          {textDraft && (
            <div className="annotate-text-input" style={{ left: textDraft.x * zoom, top: textDraft.y * zoom }}>
              <input
                autoFocus
                value={textValue}
                onChange={(e) => setTextValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitText();
                  if (e.key === 'Escape') setTextDraft(null);
                }}
                placeholder="Type text…"
              />
              <button className="btn btn-primary" style={{ height: 30 }} data-tooltip="Add text" onClick={commitText}>
                <Check size={12} />
              </button>
            </div>
          )}
          {tool === 'crop' && cropRect && (
            <button className="annotate-crop-apply btn btn-primary" data-tooltip="Apply crop to the screenshot" onClick={applyCrop}>
              <Crop size={13} />
              Apply crop
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
