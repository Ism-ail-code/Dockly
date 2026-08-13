import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DOCK_DEFAULT_HEIGHT, DOCK_DEFAULT_WIDTH, DEFAULT_SETTINGS } from '../src/shared/defaults';
import type { AccentColor, Settings, ThemeName } from '../src/shared/types';

const REQUIRED_KEYS: Record<keyof Settings, true> = {
  theme: true,
  accent: true,
  animations: true,
  compactMode: true,
  largeToolbarIcons: true,
  showTooltips: true,
  sounds: true,
  dockOnTop: true,
  dockAutoHide: true,
  dockRememberPosition: true,
  dockRememberWidth: true,
  dockRememberHeight: true,
  dockTransparencyEnabled: true,
  dockTransparencySlider: true,
  dockTransparency: true,
  dockSide: true,
  dockWidth: true,
  dockHeight: true,
  autoSave: true,
  showLineNumbers: true,
  markdownShortcuts: true,
  richText: true,
  spellCheck: true,
  autoInsertScreenshots: true,
  autoCaptureText: true,
  confirmBeforeInsert: true,
  ignoreDuplicateClipboard: true,
  focusMode: true,
  studyTimer: true,
  readingProgress: true,
  sessionResume: true,
  dailyStats: true,
  launchOnStartup: true,
  onboarded: true,
  lastSubjectId: true,
  lastNoteId: true,
};

const VALID_THEMES: ThemeName[] = ['light', 'dark', 'midnight'];
const VALID_ACCENTS: AccentColor[] = ['indigo', 'violet', 'sky', 'teal', 'emerald', 'amber', 'orange', 'rose', 'pink', 'slate'];

describe('DEFAULT_SETTINGS', () => {
  it('declares every Settings field', () => {
    assert.deepEqual(Object.keys(DEFAULT_SETTINGS).sort(), Object.keys(REQUIRED_KEYS).sort());
  });

  it('defaults to the dark theme with the indigo accent', () => {
    assert.equal(DEFAULT_SETTINGS.theme, 'dark');
    assert.equal(DEFAULT_SETTINGS.accent, 'indigo');
  });

  it('uses only known theme and accent values', () => {
    assert.ok(VALID_THEMES.includes(DEFAULT_SETTINGS.theme));
    assert.ok(VALID_ACCENTS.includes(DEFAULT_SETTINGS.accent));
  });

  it('uses a valid dock side and in-range dimensions', () => {
    assert.ok(['left', 'right'].includes(DEFAULT_SETTINGS.dockSide));
    assert.ok(Number.isFinite(DEFAULT_SETTINGS.dockWidth) && DEFAULT_SETTINGS.dockWidth > 0);
    assert.ok(Number.isInteger(DEFAULT_SETTINGS.dockHeight) && DEFAULT_SETTINGS.dockHeight >= 0);
  });

  it('keeps transparency within its documented range', () => {
    assert.ok(DEFAULT_SETTINGS.dockTransparency >= 0.4 && DEFAULT_SETTINGS.dockTransparency <= 1);
  });

  it('keeps dock dimensions in sync with the dock constants', () => {
    assert.equal(DEFAULT_SETTINGS.dockWidth, DOCK_DEFAULT_WIDTH);
    assert.equal(DEFAULT_SETTINGS.dockHeight, DOCK_DEFAULT_HEIGHT);
  });

  it('stays silent, non-intrusive and offline-first out of the box', () => {
    assert.equal(DEFAULT_SETTINGS.sounds, false);
    assert.equal(DEFAULT_SETTINGS.autoCaptureText, false);
    assert.equal(DEFAULT_SETTINGS.autoInsertScreenshots, true);
    assert.equal(DEFAULT_SETTINGS.launchOnStartup, false);
    assert.equal(DEFAULT_SETTINGS.onboarded, false);
  });

  it('keeps autosave enabled by default', () => {
    assert.equal(DEFAULT_SETTINGS.autoSave, true);
  });
});
