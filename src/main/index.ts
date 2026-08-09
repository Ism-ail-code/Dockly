import { app, screen, protocol } from 'electron';
import { initDb, getSettings, deleteNote } from './db';
import { createMainWindow, showMainWindow, showDock, onDisplayMetricsChanged } from './windows';
import { registerIpc, registerProtocol } from './ipc';
import { registerGlobalHotkeys, unregisterGlobalHotkeys } from './hotkeys';
import { startDockAutoHidePoll } from './autohide';
import { state, hub } from './state';

process.on('uncaughtException', (err) => console.log('[lifecycle] uncaughtException', err));

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.setAppUserModelId('com.dockly.app');

  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'dockly-shot',
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
    },
  ]);

  app.on('second-instance', () => {
    // Opening Dockly again surfaces the library (dashboard).
    showMainWindow('dashboard');
  });

  app.whenReady().then(() => {
    initDb(app.getPath('userData'));
    state.settings = getSettings();
    registerProtocol();
    registerIpc();
    registerGlobalHotkeys();

    createMainWindow(state.settings.theme);

    // Sticky-note-first: the docked sticky workspace is the app's front door.
    // First-run users see onboarding (in the main window) instead.
    if (state.settings?.onboarded) showDock();
    else showMainWindow('dashboard');

    if (state.settings?.dockAutoHide) startDockAutoHidePoll();

    screen.on('display-metrics-changed', onDisplayMetricsChanged);
    screen.on('display-added', onDisplayMetricsChanged);
    screen.on('display-removed', onDisplayMetricsChanged);

    app.on('child-process-gone', (_e, details) => {
      console.log('[lifecycle] child process gone:', details.type, details.reason);
    });

    app.on('activate', () => {
      if (state.settings?.onboarded) showDock();
      else showMainWindow('dashboard');
    });
  });

  app.on('before-quit', () => {
    unregisterGlobalHotkeys();
  });

  app.on('window-all-closed', () => {
    console.log('[lifecycle] all windows closed — quitting');
    app.quit();
  });

  if (process.env.DOCKLY_SMOKE === '1') {
    app.whenReady().then(() => {
      setTimeout(async () => {
        const win = hub.main;
        if (!win || win.isDestroyed()) {
          console.log('E2E_RESULT {"error":"no main window"}');
          app.exit(1);
          return;
        }
        try {
          const result = await win.webContents.executeJavaScript(E2E_SCRIPT);
          // Dock rapid-switch regression test: burst-click recent notes in the
          // dock window and verify the UI stays stable and clickable.
          const dock = hub.dock;
          let rapidSwitch: unknown = { skipped: true };
          let dockUi: unknown = { skipped: true };
          if (dock && !dock.isDestroyed() && result && !result.error) {
            try {
              rapidSwitch = await dock.webContents.executeJavaScript(DOCK_E2E_SCRIPT);
            } catch (e) {
              rapidSwitch = { ok: false, error: String(e) };
            }
            try {
              dockUi = await dock.webContents.executeJavaScript(DOCK_UI_SCRIPT);
            } catch (e) {
              dockUi = { ok: false, error: String(e) };
            }
          }
          (result as Record<string, unknown>).rapidSwitch = rapidSwitch;
          (result as Record<string, unknown>).dockUi = dockUi;
          console.log('E2E_RESULT ' + JSON.stringify(result));
          // Clean up the seeded marker notes so smoke runs never pollute the
          // user's real database with test data.
          const seededIds = (result as { markerNoteIds?: string[] }).markerNoteIds ?? [];
          for (const id of seededIds) {
            try {
              deleteNote(id);
            } catch {
              // ignore: note already gone
            }
          }
        } catch (e) {
          console.log('E2E_RESULT ' + JSON.stringify({ error: String(e) }));
        }
        app.exit(0);
      }, 2500);
    });
  }
}

const E2E_SCRIPT = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const waitFor = async (sel, timeout = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const el = $(sel);
      if (el) return el;
      await sleep(100);
    }
    throw new Error('timeout waiting for ' + sel);
  };
  const click = async (sel) => {
    const el = await waitFor(sel);
    el.click();
    await sleep(300);
  };
  try {
    await waitFor('.onboarding');
    await click('.onboarding-cta');
    await click('.onboarding-cta');
    await click('.onboarding-cta');
    await click('.onboarding-cta');
    await waitFor('.dashboard');
    const subjectCards = $$('.subject-card').length;
    const pickCards = $$('.pick-card').length;

    await click('.subject-card');
    await waitFor('.subject-view');
    await click('.sub-actions .btn-primary');
    await waitFor('.editor-view');

    const editorEl = await waitFor('.doc[contenteditable]');
    editorEl.focus();
    document.execCommand('insertText', false, 'Hello Dockly, testing autosave.');
    await sleep(1400);

    const notes = await window.dockly.notes.list();
    const saved = notes.find((n) => n.preview.includes('Hello Dockly'));
    const res = await window.dockly.search('Dockly', 'all');

    // ---- navigation round-trips (every screen must have a working exit) ----
    const nav = {};
    const backBtn = () => $$('button').find((b) => (b.dataset.tooltip ?? '').startsWith('Return'));
    const clickBack = async () => {
      const b = backBtn();
      if (!b) throw new Error('back button missing');
      b.click();
      await sleep(400);
    };

    // editor → back → subject (the note was created from the subject view)
    nav.editorBackLabel = backBtn()?.dataset.tooltip ?? null;
    await clickBack();
    await waitFor('.subject-view');
    nav.editorBackToSubject = true;

    // subject → back → dashboard
    await clickBack();
    await waitFor('.dashboard');
    nav.subjectBackToDashboard = true;

    // dashboard → settings → back → dashboard (Back must return to origin)
    await click('[aria-label="Settings"]');
    await waitFor('.settings-view');
    nav.settingsReached = true;
    nav.settingsBackLabel = backBtn()?.dataset.tooltip ?? null;
    await clickBack();
    await waitFor('.dashboard');
    nav.settingsBackToDashboard = true;

    // dashboard → search → open a result → editor → back → dashboard
    await click('[aria-label="Search"]');
    await waitFor('.search-backdrop');
    nav.searchOpen = true;
    const searchInput = await waitFor('.search-input');
    const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    valueSetter?.call(searchInput, 'Dockly');
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(700);
    const firstResult = await waitFor('.search-result');
    firstResult.click();
    await waitFor('.editor-view');
    nav.searchOpensNote = true;
    await clickBack();
    await waitFor('.dashboard');
    nav.editorBackToDashboard = true;

    // archive round-trip (reachable from the dashboard quick actions)
    await click('.dash-quick button[data-tooltip="View archived notes"]');
    await waitFor('.archive-item, .empty');
    nav.archiveReached = true;
    await clickBack();
    await waitFor('.dashboard');
    nav.archiveBackToDashboard = true;

    nav.ok = !!(
      nav.editorBackLabel &&
      nav.editorBackToSubject && nav.subjectBackToDashboard &&
      nav.settingsReached && nav.settingsBackLabel && nav.settingsBackToDashboard &&
      nav.searchOpen && nav.searchOpensNote && nav.editorBackToDashboard &&
      nav.archiveReached && nav.archiveBackToDashboard
    );

    // Seed notes with distinct content markers for the dock rapid-switch test.
    const subjectId = saved.subjectId;
    const markerNotes = [];
    for (let i = 0; i < 12; i++) {
      const n = await window.dockly.notes.create(subjectId, 'Note ' + i);
      const marker = 'dockly-marker-' + n.id.slice(0, 8);
      await window.dockly.notes.contentSave(
        n.id,
        JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: marker }] }] }),
      );
      markerNotes.push({ id: n.id, marker });
    }

    const dockState = await window.dockly.dock.open(markerNotes[markerNotes.length - 1]?.id);
    await sleep(1200);
    const versions = saved ? await window.dockly.versions.list(saved.id) : [];

    return {
      onboardingDone: true,
      subjectCards,
      pickCards,
      noteCreated: !!saved,
      noteTitle: saved?.title ?? null,
      searchHits: res.reduce((a, r) => a + r.notes.length, 0),
      dockOpen: !!dockState?.open,
      versionCount: versions.length,
      markerNotes: markerNotes.length,
      markerNoteIds: markerNotes.map((n) => n.id),
      nav,
    };
  } catch (err) {
    return { error: String(err) };
  }
})()`;

// Stress test for the "rapid note switching" bug: burst-click every recent row
// twice, then verify exactly one note is active, the editor shows that note's
// content, the title matches, and buttons still respond to clicks.
const DOCK_E2E_SCRIPT = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rows = () => [...document.querySelectorAll('.dock-recent')];
  const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const activeRowTitle = () => {
    const row = document.querySelector('.dock-recent.active');
    return row ? (row.querySelector('.dock-recent-title')?.textContent ?? null) : null;
  };
  const noteTitleInput = () => document.querySelector('.dock-note-title')?.value ?? null;
  const editorText = () => document.querySelector('.dock-editor .ProseMirror')?.textContent?.trim() ?? null;
  const results = {};

  let t0 = Date.now();
  while (rows().length < 2 && Date.now() - t0 < 6000) await sleep(100);
  results.recentCount = rows().length;
  if (results.recentCount < 2) return { ok: false, ...results, reason: 'not enough recent rows' };

  // 1) rapid burst: click every row twice, ~25ms apart (simulates frantic clicking)
  const targets = [];
  for (let i = 0; i < rows().length * 2; i++) targets.push(rows()[i % rows().length]);
  for (const el of targets) { click(el); await sleep(25); }

  // 2) settle and verify the final state is stable
  await sleep(900);

  results.activeCount = document.querySelectorAll('.dock-recent.active').length;
  results.activeTitle = activeRowTitle();
  results.noteTitle = noteTitleInput();
  results.titleMatch = results.activeTitle === results.noteTitle;

  // 3) the editor must show the ACTIVE note's own content marker
  const all = await window.dockly.notes.list();
  const active = all.find((n) => n.title === results.activeTitle);
  results.editorOk = !!active && editorText() !== null;
  if (active) {
    const marker = 'dockly-marker-' + active.id.slice(0, 8);
    results.editorShowsActive = (editorText() ?? '').includes(marker);
  }

  // 4) the UI must remain clickable: pin twice and expect the same class back
  const pin = () => [...document.querySelectorAll('.dock-btn')].find(
    (b) => (b.dataset.tooltip ?? '').startsWith('Pin ') || (b.dataset.tooltip ?? '').startsWith('Unpin '),
  );
  const before = pin()?.className ?? null;
  click(pin());
  await sleep(250);
  click(pin());
  await sleep(250);
  results.pinClickable = (pin()?.className ?? null) === before;

  // 5) one final deliberate click must land exactly on that note
  const last = rows()[rows().length - 1];
  click(last);
  await sleep(700);
  results.finalClickActive = activeRowTitle() === (last.querySelector('.dock-recent-title')?.textContent ?? null);

  results.ok = !!(results.activeCount === 1 && results.titleMatch && results.editorOk && results.pinClickable && results.finalClickActive);
  return results;
})()`;

// Dock UI interaction checks:
//  - hover on the settings button must show its tooltip description
//  - collapsing must produce the rail, and the rail's expand button must NOT be
//    covered by the drag strip (previously it was, so the dock could never be
//    expanded again once collapsed)
const DOCK_UI_SCRIPT = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const rect = (el) => {
    const b = el.getBoundingClientRect();
    return { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
  };
  const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  const results = {};

  let t0 = Date.now();
  while (!$('.dock-expanded') && Date.now() - t0 < 5000) await sleep(100);
  if (!$('.dock-expanded')) return { ok: false, reason: 'dock not expanded' };

  // 1) settings button tooltip appears on hover. The tooltip host arms on a
  // 350ms delay, so poll for it and re-dispatch if the first shot was lost to
  // event ordering or jitter.
  const settingsBtn = $$('.dock-btn').find((b) => (b.dataset.tooltip ?? '').startsWith('Customize'));
  results.settingsFound = !!settingsBtn;
  if (settingsBtn) {
    const hover = () => {
      settingsBtn.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
      settingsBtn.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false }));
      settingsBtn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      settingsBtn.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    };
    hover();
    let tooltip = null;
    for (let i = 0; i < 12 && !tooltip; i++) {
      await sleep(150);
      tooltip = $('.tooltip.show');
      if (!tooltip && i === 3) hover();
    }
    results.settingsTooltipShown = !!tooltip;
    results.settingsTooltipText = tooltip?.textContent ?? null;
  }

  // 2) collapse via the header button
  const collapseBtn = $$('.dock-btn').find((b) => (b.dataset.tooltip ?? '') === 'Collapse');
  results.collapseBtnFound = !!collapseBtn;
  if (collapseBtn) click(collapseBtn);
  await sleep(700);
  results.collapsed = !!$('.dock-collapsed');

  // 3) the rail must render an expand button that no overlay covers
  const logo = $('.dock-rail-logo');
  const dragRegion = $('.dock-drag-region');
  results.expandButtonExists = !!logo;
  results.logoCovered = !!(logo && dragRegion && overlaps(rect(logo), rect(dragRegion)));

  // 4) clicking the expand button restores the full dock
  if (logo) click(logo);
  await sleep(700);
  results.expanded = !!$('.dock-expanded');

  // 5) vertical resize: dragging the bottom edge handle changes the dock
  // height (shrink first — the dock starts at full work-area height, so it
  // can only shrink; then grow back to confirm both directions work)
  const bottomHandle = $('.dock-resize-b');
  results.bottomHandleExists = !!bottomHandle;
  const h0 = window.innerHeight;
  const dragVertical = async (fromY, toY) => {
    const pd = new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, screenX: 200, screenY: fromY });
    bottomHandle.dispatchEvent(pd);
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, screenX: 200, screenY: toY }));
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, screenX: 200, screenY: toY }));
    await sleep(250);
  };
  if (bottomHandle) {
    await dragVertical(300, 240);
    results.heightShrank = window.innerHeight < h0 - 40;
    await dragVertical(240, 300);
    results.heightRestored = Math.abs(window.innerHeight - h0) < 20;
  }

  // 6) corner handles exist (width + height at once)
  const corners = $$('.dock-resize-tc, .dock-resize-bc');
  results.cornerHandles = corners.length;

  results.ok = !!(
    results.settingsFound && results.settingsTooltipShown && results.collapseBtnFound &&
    results.collapsed && results.expandButtonExists && !results.logoCovered && results.expanded &&
    results.bottomHandleExists && results.heightShrank && results.heightRestored && results.cornerHandles >= 1
  );
  return results;
})()`;
