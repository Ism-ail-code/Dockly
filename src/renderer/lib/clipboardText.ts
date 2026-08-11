/**
 * Converts plain copied text into HTML that preserves paragraphs, line breaks,
 * Unicode and bullet/numbered-list structure. Used when captured clipboard
 * text is inserted into a note. Never adds quotation marks.
 */

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const BULLET_RE = /^\s*([-*•‣▪◦])\s+(.*)$/;
const NUMBER_RE = /^\s*(\d{1,4})([.)])\s+(.*)$/;

/**
 * @returns an HTML fragment, or null when the text is empty/whitespace-only.
 */
export function textToHtml(text: string): string | null {
  const body = text.replace(/\r\n?/g, '\n').replace(/^\n+|\n+$/g, '');
  if (!body) return null;

  const lines = body.split('\n');
  const out: string[] = [];
  let kind: 'ul' | 'ol' | null = null;
  let items: string[] = [];
  let para: string[] = [];

  const flushList = () => {
    if (kind) {
      out.push(`<${kind}>${items.map((i) => `<li>${i}</li>`).join('')}</${kind}>`);
      kind = null;
      items = [];
    }
  };
  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${para.map(escapeHtml).join('<br/>')}</p>`);
      para = [];
    }
  };

  for (const raw of lines) {
    const bullet = raw.match(BULLET_RE);
    const num = raw.match(NUMBER_RE);
    if (bullet || num) {
      flushPara();
      const nextKind = bullet ? 'ul' : 'ol';
      if (kind !== nextKind) flushList();
      kind = nextKind;
      items.push(escapeHtml((bullet ? bullet[2] : (num as RegExpMatchArray)[3]).trim()));
    } else if (raw.trim() === '') {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(raw.trim());
    }
  }
  flushPara();
  flushList();

  return out.length ? out.join('') : null;
}
