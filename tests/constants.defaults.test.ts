import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ACCENT_COLORS,
  DOCK_COLLAPSED_WIDTH,
  DOCK_DEFAULT_HEIGHT,
  DOCK_DEFAULT_WIDTH,
  DOCK_MAX_WIDTH,
  DOCK_MIN_HEIGHT,
  DOCK_MIN_WIDTH,
  DEFAULT_SUBJECTS,
  DEFAULT_TAGS,
  EDITOR_SNIPPET_IGNORES,
  EMPTY_DOC,
  SHORTCUTS,
  VERSION_INTERVAL_MS,
  VERSION_LIMIT,
} from '../src/shared/defaults';
import type { AccentColor } from '../src/shared/types';

const VALID_ACCENTS: AccentColor[] = ['indigo', 'violet', 'sky', 'teal', 'emerald', 'amber', 'orange', 'rose', 'pink', 'slate'];

describe('ACCENT_COLORS', () => {
  it('covers every AccentColor exactly once', () => {
    const names = ACCENT_COLORS.map((c) => c.name);
    assert.deepEqual([...names].sort(), [...VALID_ACCENTS].sort());
    assert.equal(new Set(names).size, names.length);
  });

  it('gives every accent a non-empty label', () => {
    for (const c of ACCENT_COLORS) assert.ok(c.label.trim().length > 0);
  });
});

describe('DEFAULT_SUBJECTS', () => {
  it('seeds the six core subjects with unique names', () => {
    const names = DEFAULT_SUBJECTS.map((s) => s.name);
    assert.deepEqual(names, ['Mathematics', 'Physics', 'Chemistry', 'English', 'Urdu', 'Computer Science']);
    assert.equal(new Set(names).size, names.length);
  });

  it('uses only valid accent colors', () => {
    for (const s of DEFAULT_SUBJECTS) assert.ok(VALID_ACCENTS.includes(s.color));
  });

  it('gives every subject an icon', () => {
    for (const s of DEFAULT_SUBJECTS) assert.ok(s.icon.trim().length > 0);
  });
});

describe('DEFAULT_TAGS', () => {
  it('provides non-empty unique starter tags', () => {
    assert.ok(DEFAULT_TAGS.length > 0);
    for (const t of DEFAULT_TAGS) assert.ok(t.trim().length > 0);
    assert.equal(new Set(DEFAULT_TAGS).size, DEFAULT_TAGS.length);
  });
});

describe('SHORTCUTS', () => {
  it('keeps labels unique and human readable', () => {
    const labels = SHORTCUTS.map((s) => s.label);
    assert.equal(new Set(labels).size, labels.length);
    for (const s of SHORTCUTS) assert.ok(s.keys.trim().length > 0 && s.label.trim().length > 0);
  });

  it('uses only known scopes', () => {
    const scopes = new Set(['Everywhere', 'Notes', 'Editor', 'System']);
    for (const s of SHORTCUTS) assert.ok(scopes.has(s.scope));
  });

  it('documents the system-wide snip shortcut', () => {
    assert.ok(SHORTCUTS.some((s) => s.keys === 'Win + Shift + S'));
  });
});

describe('EMPTY_DOC', () => {
  it('is a TipTap doc with a single empty paragraph', () => {
    const doc = JSON.parse(EMPTY_DOC) as { type: string; content: { type: string }[] };
    assert.equal(doc.type, 'doc');
    assert.equal(doc.content.length, 1);
    assert.equal(doc.content[0].type, 'paragraph');
  });
});

describe('dock sizing constants', () => {
  it('keeps the default width inside the min/max bounds', () => {
    assert.ok(DOCK_MIN_WIDTH <= DOCK_DEFAULT_WIDTH && DOCK_DEFAULT_WIDTH <= DOCK_MAX_WIDTH);
  });

  it('keeps the collapsed width below the minimum', () => {
    assert.ok(DOCK_COLLAPSED_WIDTH < DOCK_MIN_WIDTH);
  });

  it('requires a positive minimum height', () => {
    assert.ok(DOCK_MIN_HEIGHT > 0);
    assert.ok(DOCK_DEFAULT_HEIGHT >= 0);
  });
});

describe('version history constants', () => {
  it('keeps a sane snapshot limit and interval', () => {
    assert.ok(Number.isInteger(VERSION_LIMIT) && VERSION_LIMIT > 0);
    assert.ok(VERSION_INTERVAL_MS > 0);
  });
});

describe('EDITOR_SNIPPET_IGNORES', () => {
  it('lists non-empty unique element names', () => {
    assert.ok(EDITOR_SNIPPET_IGNORES.length > 0);
    for (const tag of EDITOR_SNIPPET_IGNORES) assert.ok(tag.trim().length > 0);
    assert.equal(new Set(EDITOR_SNIPPET_IGNORES).size, EDITOR_SNIPPET_IGNORES.length);
  });
});
