/**
 * TipTap image node with drag-to-resize display size.
 *
 * Only the display `width` is stored on the node (height follows the image's
 * natural aspect ratio), so the underlying screenshot file is never modified.
 * Drag the corner handle of a selected image to scale it; double-click the
 * image (or handle) to reset back to its natural size. Replaces
 * @tiptap/extension-image in both editors (library + dock).
 */
import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { useRef, type PointerEvent as ReactPointerEvent } from 'react';

interface ResizableImageOptions {
  inline: boolean;
  allowBase64: boolean;
}

const MIN_WIDTH = 48;
const MAX_WIDTH = 4096;

export const ResizableImage = Node.create<ResizableImageOptions>({
  name: 'image',

  group() {
    return this.options.inline ? 'inline' : 'block';
  },

  inline() {
    return this.options.inline;
  },

  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return { inline: false, allowBase64: false };
  },

  addAttributes() {
    return {
      src: { default: null },
      alt: { default: null },
      title: { default: null },
      width: {
        default: null,
        parseHTML: (el) => el.getAttribute('width') ?? el.style.width ?? null,
        renderHTML: (attrs) => (attrs.width ? { style: `width: ${attrs.width}px` } : {}),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: this.options.allowBase64
          ? 'img[src^="data:image/"]:not([src$=".svg"])'
          : 'img[src]:not([src^="data:image/"]):not([src$=".svg"])',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView);
  },
});

function ResizableImageView(props: NodeViewProps) {
  const { node, selected, updateAttributes } = props;
  const imgRef = useRef<HTMLImageElement | null>(null);

  const storedWidth = node.attrs.width ? Number(node.attrs.width) : null;

  const resetSize = () => updateAttributes({ width: null });

  const onHandlePointerDown = (e: ReactPointerEvent) => {
    const img = imgRef.current;
    if (!img || !img.naturalWidth || img.naturalWidth < 1) return;
    e.preventDefault();
    e.stopPropagation();
    const startW = storedWidth && storedWidth > 0 ? storedWidth : img.naturalWidth;
    const ratio = img.naturalHeight / img.naturalWidth;
    const startH = startW * ratio;
    const startX = e.screenX;
    const startY = e.screenY;

    const onMove = (ev: PointerEvent) => {
      const dx = ev.screenX - startX;
      const dy = ev.screenY - startY;
      // Corner drag scales both dimensions by the larger relative delta, so
      // the aspect ratio (and the stored file) never change.
      const scale = Math.max((startW + dx) / startW, (startH + dy) / startH);
      const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(startW * scale)));
      updateAttributes({ width: next });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  return (
    <NodeViewWrapper
      className="doc-img-wrap"
      data-selected={selected ? 'true' : 'false'}
      onDoubleClick={resetSize}
    >
      <img
        ref={imgRef}
        src={node.attrs.src}
        alt={node.attrs.alt ?? ''}
        title={node.attrs.title ?? undefined}
        draggable={false}
        style={storedWidth ? { width: `${storedWidth}px` } : undefined}
      />
      {selected && (
        <span
          className="doc-img-resize"
          title="Drag to resize · double-click to reset"
          onPointerDown={onHandlePointerDown}
          onMouseDown={(e) => e.preventDefault()}
          onDoubleClick={resetSize}
        />
      )}
    </NodeViewWrapper>
  );
}