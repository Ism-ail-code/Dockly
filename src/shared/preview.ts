/** Walk a TipTap document (already parsed) and join its text into a preview. */
export function extractPreviewFromDoc(doc: unknown): string {
  const parts: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as { type?: string; text?: string; content?: unknown[] };
    if (n.text && n.type === 'text') parts.push(n.text);
    if (Array.isArray(n.content)) for (const c of n.content) walk(c);
  };
  walk(doc);
  const text = parts.join(' ').replace(/\s+/g, ' ').trim();
  return text.length > 200 ? text.slice(0, 197) + '…' : text;
}