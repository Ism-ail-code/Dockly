import { app, dialog, screen, protocol } from 'electron';
import { initDb, getSettings, deleteNote, setSetting, backfillNotePreviews } from './db';
import { createMainWindow, showMainWindow, showDock, onDisplayMetricsChanged, toggleDockCollapse } from './windows';
import { registerIpc, registerProtocol } from './ipc';
import { registerGlobalHotkeys, unregisterGlobalHotkeys } from './hotkeys';
import { startDockAutoHidePoll, stopDockAutoHidePoll } from './autohide';
import { initClipboardListener, stopClipboardListener } from './clipboard';
import { initUpdater } from './updater';
import { runClipboardE2E } from './cliptest';
import { runPerfSeed, startPerfMeasurement, watchWindowLoad } from './perf';
import { state, hub } from './state';

process.on('uncaughtException', (err) => console.log('[lifecycle] uncaughtException', err));

// QA harnesses run against a scratch user-data dir. Must be set before the
// single-instance lock so a harness never collides with a running Nock
// (different lock, different DB, different windows).
if (
  process.env.NOCK_CLIP_TEST === '1' &&
  process.env.NOCK_CLIP_USER_DATA
) {
  app.setPath('userData', process.env.NOCK_CLIP_USER_DATA);
} else if (
  process.env.NOCK_SMOKE === '1' &&
  process.env.NOCK_SMOKE_USER_DATA
) {
  app.setPath('userData', process.env.NOCK_SMOKE_USER_DATA);
} else if (process.env.NOCK_PERF === '1' && process.env.NOCK_PERF_USER_DATA) {
  app.setPath('userData', process.env.NOCK_PERF_USER_DATA);
} else if (process.env.NOCK_DEV_USER_DATA) {
  // Optional opt-in dev profile: run the development build against its own
  // user-data dir so dev data never mixes with production data. Unset by
  // default — `npm start` uses the normal %APPDATA%/nock profile.
  app.setPath('userData', process.env.NOCK_DEV_USER_DATA);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.setAppUserModelId('com.nock.app');

  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'nock-shot',
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
    },
  ]);

  app.on('second-instance', () => {
    // Opening Nock again surfaces the library (dashboard).
    showMainWindow('dashboard');
  });

  app.whenReady().then(() => {
    try {
      initDb(app.getPath('userData'));
    } catch (e) {
      // A failed open/migration must never destroy the user's data — the
      // migration path rolls back and snapshots before touching anything.
      // Report the problem clearly and stop instead of running against a
      // half-initialized workspace.
      console.log('[lifecycle] database init failed:', e);
      dialog.showErrorBox(
        'Nock could not open your workspace',
        'Nock could not open its data file and will close.\n\n' +
          'Your existing data was not modified. A safety copy may have been saved as ' +
          '"nock.pre-migration.db" inside your Nock data folder:\n' +
          app.getPath('userData') +
          '\n\nPlease report this problem, then restart Nock.',
      );
      app.exit(1);
      return;
    }
    state.settings = getSettings();
    // One-time preview migration for pre-existing databases — runs chunked
    // off the startup path, never blocks first paint.
    void backfillNotePreviews();

    if (process.env.NOCK_PERF === '1' && process.env.NOCK_PERF_SEED) {
      runPerfSeed(Number(process.env.NOCK_PERF_SEED) || 150);
      return;
    }

    registerProtocol();
    registerIpc();
    registerGlobalHotkeys();
    initUpdater();
    initClipboardListener();

    createMainWindow(state.settings.theme);

    // Library-first: the main dashboard window is the app's front door and
    // always opens in front at boot. The dock (if it was open) reopens too,
    // but never steals focus from the library. First-run users see the
    // onboarding flow in the main window instead.
    showMainWindow('dashboard');
    if (state.settings?.onboarded) showDock();

    if (process.env.NOCK_PERF === '1') {
      const win = hub.main;
      if (win && !win.isDestroyed()) {
        startPerfMeasurement(win);
        if (hub.dock && !hub.dock.isDestroyed()) watchWindowLoad('dock', hub.dock);
      }
    }

    if (state.settings?.dockAutoHide) startDockAutoHidePoll();

    screen.on('display-metrics-changed', onDisplayMetricsChanged);
    screen.on('display-added', onDisplayMetricsChanged);
    screen.on('display-removed', onDisplayMetricsChanged);

    app.on('child-process-gone', (_e, details) => {
      console.log('[lifecycle] child process gone:', details.type, details.reason);
    });

    app.on('activate', () => {
      // The library always surfaces in front; the dock reopens without focus.
      showMainWindow('dashboard');
      if (state.settings?.onboarded) showDock();
    });
  });

  app.on('before-quit', () => {
    unregisterGlobalHotkeys();
    stopClipboardListener();
  });

  app.on('window-all-closed', () => {
    // The QA harness controls its own termination (process.kill SIGKILL) —
    // app.quit() here would re-enter the shutdown sequence mid-exit and hang.
    if (process.env.NOCK_CLIP_TEST === '1') return;
    console.log('[lifecycle] all windows closed — quitting');
    app.quit();
  });

  // Clipboard capture end-to-end test (scripts/cliptest.mjs). Two roles:
  //  'setup'  — boot, capture simulated copies, verify inserts, save state
  //  'verify' — relaunch, confirm the captured text survived the restart
  if (process.env.NOCK_CLIP_TEST === '1') {
    app.whenReady().then(async () => {
      try {
        const role = (process.env.NOCK_CLIP_ROLE as 'setup' | 'verify') ?? 'setup';
        await runClipboardE2E(role);
      } catch (e) {
        console.log('CLIP_E2E_RESULT ' + JSON.stringify({ ok: false, error: String(e) }));
        process.exit(1);
      }
    });
  } else if (process.env.NOCK_SMOKE === '1') {
    app.whenReady().then(() => {
      setTimeout(async () => {
        const win = hub.main;
        if (!win || win.isDestroyed()) {
          console.log('E2E_RESULT {"error":"no main window"}');
          app.exit(1);
          return;
        }
        try {
          // Probe the main window's live view state so view drift between the
          // phases is visible in the report instead of being a mystery.
          const probeMain = async (tag: string) => {
            try {
              const p = await win.webContents.executeJavaScript(`(async () => ({
                viewRoot: document.querySelector('.app-main')?.firstElementChild?.className ?? null,
                searchOpen: !!document.querySelector('.search-backdrop'),
                versionOpen: !!document.querySelector('.version-panel'),
                bodyChildren: document.body.childElementCount,
              }))()`);
              console.log('[smoke] main@' + tag + ': ' + JSON.stringify(p));
            } catch (e) {
              console.log('[smoke] main@' + tag + ' probe failed: ' + String(e));
            }
          };
          await probeMain('pre');
          const result = await win.webContents.executeJavaScript(E2E_SCRIPT);
          await probeMain('post-e2e');
          // Dock rapid-switch regression test: burst-click recent notes in the
          // dock window and verify the UI stays stable and clickable.
          // The library tour toggles the auto-hide switch, which can leave the
          // dock collapsed; force a known-good state (expanded + no auto-hide)
          // from the main process so the dock phases never race that state.
          const prepDock = async () => {
            try {
              if (state.settings?.dockAutoHide) {
                state.settings = setSetting('dockAutoHide', false);
                stopDockAutoHidePoll();
              }
              if (state.dock.collapsed) toggleDockCollapse();
              await new Promise((r) => setTimeout(r, 600));
            } catch (e) {
              console.log('[smoke] dock prep failed: ' + String(e));
            }
          };
          const dock = hub.dock;
          let rapidSwitch: unknown = { skipped: true };
          let dockUi: unknown = { skipped: true };
          if (dock && !dock.isDestroyed() && result && !result.error) {
            await prepDock();
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
          // Comprehensive feature tour of the library window (dashboard, subject,
          // editor, settings, archive, search, shortcuts).
          let full: unknown = { skipped: true };
          if (win && !win.isDestroyed() && result && !result.error) {
            await probeMain('pre-full');
            try {
              full = await win.webContents.executeJavaScript(FULL_SCRIPT);
              // A mid-script failure can leave the app mid-navigation; the
              // script now recovers to the dashboard, so wait and re-run once
              // (the first attempt's error is preserved for diagnosis).
              if (full && (full as { error?: string }).error) {
                const firstError = (full as { error?: string }).error;
                console.log('[smoke] full tour failed (' + firstError + ') — retrying after renderer settles');
                await probeMain('pre-full-retry');
                await new Promise((r) => setTimeout(r, 3000));
                full = await win.webContents.executeJavaScript(FULL_SCRIPT);
                (full as Record<string, unknown>).firstError = firstError;
              }
            } catch (e) {
              full = { ok: false, error: String(e) };
            }
            await probeMain('post-full');
          }
          // Comprehensive feature tour of the dock window. Re-fetch the window:
          // the glass-style switch inside FULL_SCRIPT recreates the dock, so the
          // webContents captured above may belong to a destroyed window.
          let dockFull: unknown = { skipped: true };
          const dock2 = hub.dock;
          if (dock !== dock2) console.log('[smoke] dock window was recreated between phases');
          if (dock2 && !dock2.isDestroyed() && result && !result.error) {
            await prepDock();
            try {
              dockFull = await dock2.webContents.executeJavaScript(DOCK_FULL_SCRIPT);
            } catch (e) {
              dockFull = { ok: false, error: String(e) };
            }
          }
          (result as Record<string, unknown>).rapidSwitch = rapidSwitch;
          (result as Record<string, unknown>).dockUi = dockUi;
          (result as Record<string, unknown>).full = full;
          (result as Record<string, unknown>).dockFull = dockFull;
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
    const skipLink = !!$('.onboarding-skip');
    await click('.onboarding-cta');
    await click('.onboarding-cta');
    await click('.onboarding-cta');
    await click('.onboarding-cta');
    // Now on the "Create Your Subjects" step — exercise the new UI: add a
    // subject through the form, verify it lists, then seed the rest of the
    // tour's set via the API (excluding the UI-created one) before Continue.
    const onboardingSubjectStep = !!$('.onboarding-subject-input');
    const backButtonExists = [...$$('button')].some((b) => b.textContent.trim() === 'Back');
    const skipNowExists = !!$('.onboarding-skip');
    const ctaFinalLabel = $('.onboarding-cta').textContent.trim();
    const subjectInput = await waitFor('.onboarding-subject-input');
    const subjectValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    subjectValueSetter?.call(subjectInput, 'Mathematics');
    subjectInput.dispatchEvent(new Event('input', { bubbles: true }));
    await click('.onboarding-subject-add');
    await sleep(400);
    const subjectAddedViaOnboarding = $$('.onboarding-subject-item .onboarding-subject-name').some(
      (el) => el.textContent.trim() === 'Mathematics',
    );
    const removeButtonExists = !!$('.onboarding-subject-remove');
    // The intro no longer creates subjects, so seed the tour's set here —
    // BEFORE the final click, because boot() reads subjects on finish and
    // the dashboard renders whatever it fetched.
    const seeds = [
      { name: 'Physics', icon: 'atom', color: 'violet' },
      { name: 'Chemistry', icon: 'flask', color: 'teal' },
      { name: 'Biology', icon: 'leaf', color: 'emerald' },
      { name: 'English', icon: 'book', color: 'rose' },
      { name: 'Computer Science', icon: 'code', color: 'sky' },
    ];
    for (const s of seeds) await window.nock.subjects.create(s);
    await click('.onboarding-cta');
    await waitFor('.dashboard');
    await sleep(400);
    const subjectCards = $$('.subject-card').length;
    const pickCards = $$('.pick-card').length;
    const onboardedSetting = (await window.nock.settings.get()).onboarded;
    const subjectNames = (await window.nock.subjects.list()).map((s) => s.name);

    await click('.subject-card');
    await waitFor('.subject-view');
    await click('.sub-actions .btn-primary');
    await waitFor('.editor-view');

    const editorEl = await waitFor('.doc[contenteditable]');
    editorEl.focus();
    document.execCommand('insertText', false, 'Hello Nock, testing autosave.');
    await sleep(1400);

    const notes = await window.nock.notes.list();
    const saved = notes.find((n) => n.preview.includes('Hello Nock'));
    const res = await window.nock.search('Nock', 'all');

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
    valueSetter?.call(searchInput, 'Nock');
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
      const n = await window.nock.notes.create(subjectId, 'Note ' + i);
      const marker = 'nock-marker-' + n.id.slice(0, 8);
      await window.nock.notes.contentSave(
        n.id,
        JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: marker }] }] }),
      );
      markerNotes.push({ id: n.id, marker });
    }

    const dockState = await window.nock.dock.open(markerNotes[markerNotes.length - 1]?.id);
    await sleep(1200);
    const versions = saved ? await window.nock.versions.list(saved.id) : [];

    return {
      onboardingDone: true,
      skipLink,
      ctaFinalLabel,
      onboardingSubjectStep,
      backButtonExists,
      skipNowExists,
      subjectAddedViaOnboarding,
      removeButtonExists,
      onboardedSetting,
      subjectNames,
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
  const click = (el) => { if (el) el.click(); };
  const activeRowTitle = () => {
    const row = document.querySelector('.dock-recent.active');
    return row ? (row.querySelector('.dock-recent-title')?.textContent ?? null) : null;
  };
  const noteTitleInput = () => document.querySelector('.dock-note-title')?.value ?? null;
  const editorText = () => document.querySelector('.dock-editor .ProseMirror')?.textContent?.trim() ?? null;
  const results = {};

  let t0 = Date.now();
  // Recents start collapsed to keep the writing area large — expand first.
  const expandBtn = document.querySelector('.dock-recents-toggle');
  if (expandBtn && document.querySelector('.dock-recents')?.classList.contains('compact')) {
    click(expandBtn);
  }
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
  const all = await window.nock.notes.list();
  const active = all.find((n) => n.title === results.activeTitle);
  results.editorOk = !!active && editorText() !== null;
  if (active) {
    const marker = 'nock-marker-' + active.id.slice(0, 8);
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
  if (!last) return { ok: false, ...results, reason: 'recents vanished mid-test' };
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
  const click = (el) => { if (el) el.click(); };
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
  const collapseBtn = $$('.dock-btn').find((b) => (b.dataset.tooltip ?? '') === 'Collapse — tuck the dock into a slim rail');
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

// Comprehensive feature tour of the library (main) window. Runs after the core
// E2E_SCRIPT, so onboarding is done, notes are seeded and the app sits on the
// dashboard with the dock open. Exercises every view, toolbar button, settings
// control, modal, overlay and keyboard shortcut; every check writes its own
// result field so failures pin-point the exact feature.
const FULL_SCRIPT = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const waitFor = async (sel, timeout = 8000, label) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const el = $(sel);
      if (el) return el;
      await sleep(100);
    }
    throw new Error('timeout waiting for ' + (label ?? sel));
  };
  const clickEl = (el) => { if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true })); };
  const click = async (sel) => { clickEl(await waitFor(sel)); await sleep(250); };
  const setInput = (el, value) => {
    if (!el) return;
    const proto = el instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const setRange = (el, value) => {
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    setter?.call(el, String(value));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const key = (k, opts) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...(opts ?? {}) }));
  const backBtn = () => $$('button').find((b) => (b.dataset.tooltip ?? '').startsWith('Return'));
  const clickBack = async () => { const b = backBtn(); if (!b) throw new Error('back button missing'); clickEl(b); await sleep(400); };
  const toastText = () => $$('.toast').map((t) => t.textContent ?? '').join(' | ');
  const selectAllDoc = async () => {
    const doc = await waitFor('.doc[contenteditable]');
    doc.focus();
    await sleep(80);
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }));
    await sleep(120);
    if ((window.getSelection()?.toString() ?? '').length === 0) document.execCommand('selectAll', false);
    await sleep(80);
  };
  const swFor = (label) => $$('.switch').find((b) => (b.getAttribute('aria-label') ?? '') === label);
  const toggleTo = async (label, wantOn) => {
    const sw = swFor(label);
    if (!sw) return false;
    const isOn = sw.getAttribute('aria-checked') === 'true';
    if (isOn !== wantOn) { clickEl(sw); await sleep(400); }
    return (swFor(label)?.getAttribute('aria-checked') === 'true') === wantOn;
  };
  const results = {};
  try {
    // Diagnostics: capture what the main window actually shows when the
    // dashboard is not present, so view-state drift is visible in the report.
    results.debugViewRoot = document.querySelector('.app-main')?.firstElementChild?.className ?? null;
    results.debugBodyClass = document.body.className;
    if (!document.querySelector('.dashboard')) {
      // The library is the front door — force it if any prior flow left the
      // main window somewhere else.
      await window.nock.window.openMain('dashboard');
      await sleep(600);
    }
    await waitFor('.dashboard', 8000, '.dashboard@start');

    // ================= TOPBAR =================
    const topbar = {};
    const themeBtn = () => $$('button[aria-label="Switch theme"]')[0];
    topbar.themeBtn = !!themeBtn();
    if (themeBtn()) {
      const start = document.documentElement.dataset.theme;
      const seen = new Set([start]);
      for (let i = 0; i < 3; i++) { clickEl(themeBtn()); await sleep(300); seen.add(document.documentElement.dataset.theme); }
      topbar.themeCycles = seen.size >= 2 && document.documentElement.dataset.theme === start;
    }
    const dockToggle = () => $$('button[aria-label="Toggle dock"]')[0];
    topbar.dockToggle = !!dockToggle();
    if (dockToggle()) {
      clickEl(dockToggle()); await sleep(700);
      topbar.dockClosed = ((await window.nock.dock.getState())?.open) === false;
      clickEl(dockToggle()); await sleep(800);
      topbar.dockReopened = ((await window.nock.dock.getState())?.open) === true;
    }
    topbar.brand = !!$('.brand');
    topbar.searchBtn = !!$$('button[aria-label="Search"]').length;
    topbar.settingsBtn = !!$$('button[aria-label="Settings"]').length;
    topbar.bigSearch = !!$('.btn-search');
    topbar.ok = !!(topbar.themeBtn && topbar.themeCycles && topbar.dockToggle && topbar.dockClosed && topbar.dockReopened && topbar.brand && topbar.searchBtn && topbar.settingsBtn && topbar.bigSearch);
    results.topbar = topbar;

    // ================= DASHBOARD =================
    const dash = {};
    dash.statPills = $$('.stat-pill').length;
    dash.greeting = !!$('.dash-greeting');
    dash.captureBanner = !!$('.capture-banner');
    const banner = $('.capture-banner');
    if (banner) { clickEl(banner); await sleep(300); dash.captureToast = toastText().includes('Win + Shift + S'); }
    const addCard = $('.subject-add');
    dash.subjectAddCard = !!addCard;
    if (addCard) {
      clickEl(addCard); await sleep(300);
      dash.subjectAddModal = !!$('.subject-create-modal');
      const input = $('.subject-create-input');
      dash.subjectInputAutoFocus = document.activeElement === input;
      dash.subjectCreateDisabled = $('.subject-create-submit')?.disabled === true;
      if (input) { setInput(input, 'E2E Dash Subject'); await sleep(200); }
      dash.subjectCreateEnabled = $('.subject-create-submit')?.disabled === false;
      clickEl($('.subject-create-submit')); await sleep(700);
      const created = (await window.nock.subjects.list()).find((s) => s.name === 'E2E Dash Subject');
      dash.subjectCreated = !!created;
      dash.subjectCardAppears = !!$('.subject-card') && $$('.subject-card').some((c) => (c.textContent ?? '').includes('E2E Dash Subject'));
      if (created) await window.nock.subjects.delete(created.id);
      await sleep(400);
    }
    dash.quickNew = !!$('.dash-quick button[data-tooltip="New note (Ctrl+N)"]');
    dash.quickArchive = !!$('.dash-quick button[data-tooltip="View archived notes"]');
    dash.ok = !!(dash.statPills >= 2 && dash.greeting && dash.captureBanner && dash.captureToast && dash.subjectAddCard && dash.subjectAddModal && dash.subjectInputAutoFocus && dash.subjectCreateDisabled && dash.subjectCreateEnabled && dash.subjectCreated && dash.subjectCardAppears && dash.quickNew && dash.quickArchive);
    results.dash = dash;

    // ================= EDITOR =================
    const ed = {};
    await click('.dash-quick button[data-tooltip="New note (Ctrl+N)"]');
    await waitFor('.editor-view', 8000, '.editor-view@quick-create');
    const titleInput = await waitFor('.editor-title');
    setInput(titleInput, 'E2E Full Feature Note');
    await sleep(400);
    ed.titleCommitted = (await window.nock.notes.list()).some((n) => n.title === 'E2E Full Feature Note');

    const doc = await waitFor('.doc[contenteditable]');
    doc.focus();
    document.execCommand('insertText', false, 'The quick brown fox jumps over the lazy dog. ');
    await sleep(200);
    ed.wordCount = ($('.word-count')?.textContent ?? '').trim();
    ed.wordCountOk = /^[0-9]+ words?$/.test(ed.wordCount);
    let sawSaved = false;
    for (let i = 0; i < 24 && !sawSaved; i++) { await sleep(150); sawSaved = !!$('.save-indicator.saved'); }
    ed.saveIndicator = sawSaved;

    // toolbar: every formatting toggle must flip active on/off/on
    const tips = ['Heading 1', 'Bold (Ctrl+B)', 'Italic (Ctrl+I)', 'Underline (Ctrl+U)', 'Strikethrough', 'Inline code', 'Bulleted list', 'Numbered list', 'Checklist', 'Quote', 'Code block'];
    const toggles = {};
    const selDiag = {};
    const tipBtn = (tip) => $$('.tb-btn').find((b) => (b.dataset.tooltip ?? '') === tip);
    const tipActive = (tip) => tipBtn(tip)?.classList.contains('active') ?? false;
    const tipClick = async (tip) => {
      // React may have replaced the button node since the last render — always
      // re-query so the click lands on a live element.
      const b = tipBtn(tip);
      if (b) { b.click(); await sleep(180); }
    };
    const collapseDoc = () => {
      const doc = $('.doc[contenteditable]');
      if (!doc) return;
      const r = document.createRange();
      r.selectNodeContents(doc);
      r.collapse(false);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(r);
    };
    for (const tip of tips) {
      await selectAllDoc();
      if (!tipBtn(tip)) { toggles[tip] = 'missing'; continue; }
      const selLen = (window.getSelection()?.toString() ?? '').length;
      selDiag[tip] = selLen;
      const before = tipActive(tip);
      await tipClick(tip);
      const on = tipActive(tip);
      const htmlAfter = $('.doc')?.innerHTML ?? '';
      if (['Bulleted list', 'Numbered list', 'Checklist', 'Quote'].includes(tip)) {
        results.listDiag = results.listDiag ?? {};
        results.listDiag[tip] = { before: before, on: on, html: htmlAfter.slice(0, 140) };
      }
      // A full-document selection can't be lifted out of a list in one step —
      // collapse to a caret inside the block so the toggle-off unwraps.
      // Marks (code) toggle fine on a full selection; collapsing puts the
      // caret on the mark's end boundary where the off-toggle is a no-op.
      if (['Bulleted list', 'Numbered list', 'Checklist', 'Quote'].includes(tip)) collapseDoc();
      await sleep(120);
      await tipClick(tip);
      const off = tipActive(tip);
      const htmlOff = $('.doc')?.innerHTML ?? '';
      if (['Bulleted list', 'Numbered list', 'Checklist', 'Quote'].includes(tip)) {
        results.listDiag[tip].off = off;
        results.listDiag[tip].htmlOff = htmlOff.slice(0, 140);
      }
      if (tip === 'Inline code' || tip === 'Code block') {
        results.codeDiag = results.codeDiag ?? {};
        results.codeDiag[tip] = { on: on, off: off, htmlOn: htmlAfter.slice(0, 140), htmlOff: htmlOff.slice(0, 140) };
      }
      toggles[tip] = before === false && on === true && off === false;
    }
    ed.toolbar = toggles;
    results.selDiag = selDiag;
    ed.toolbarOk = Object.values(toggles).every((v) => v === true);

    // table insert + undo/redo round-trip
    await selectAllDoc();
    clickEl($$('.tb-btn').find((b) => (b.dataset.tooltip ?? '') === 'Insert table')); await sleep(300);
    ed.tableInserted = !!$('.doc table');
    clickEl($$('.tb-btn').find((b) => (b.dataset.tooltip ?? '') === 'Undo')); await sleep(300);
    ed.tableUndo = !$('.doc table');
    clickEl($$('.tb-btn').find((b) => (b.dataset.tooltip ?? '') === 'Redo')); await sleep(300);
    ed.tableRedo = !!$('.doc table');
    clickEl($$('.tb-btn').find((b) => (b.dataset.tooltip ?? '') === 'Undo')); await sleep(300);

    // link insert/remove (prompt stubbed)
    await selectAllDoc();
    results.edDiag = {
      linkSelLen: (window.getSelection()?.toString() ?? '').length,
      docHtml: ($('.doc')?.innerHTML ?? '').slice(0, 200),
    };
    window.prompt = (msg) => (msg ?? '').includes('Link URL') ? 'https://example.com' : '';
    clickEl($$('.tb-btn').find((b) => (b.dataset.tooltip ?? '') === 'Insert link (Ctrl+K)')); await sleep(300);
    const anchors = $$('.doc a');
    ed.linkInserted = anchors.length >= 1 && (anchors[0]?.getAttribute('href') ?? '').includes('example.com');
    results.edDiag.linkAnchorCount = anchors.length;
    window.prompt = () => '';
    clickEl($$('.tb-btn').find((b) => (b.dataset.tooltip ?? '') === 'Insert link (Ctrl+K)')); await sleep(300);
    ed.linkRemoved = $$('.doc a').length === 0;
    window.prompt = null;

    // highlight + text color dropdowns
    await selectAllDoc();
    const highBtn = () => $$('.tb-btn').find((b) => (b.dataset.tooltip ?? '') === 'Highlight');
    clickEl(highBtn()); await sleep(250);
    ed.highlightPop = !!$('.color-pop');
    results.edDiag.highlightItems = $$('.color-item').map((c) => (c.textContent ?? '').trim());
    results.edDiag.highlightSelLen = (window.getSelection()?.toString() ?? '').length;
    clickEl($$('.color-item').find((c) => (c.textContent ?? '').includes('Yellow'))); await sleep(250);
    ed.highlightSet = !!highBtn()?.querySelector('.tb-dot');
    results.edDiag.highlightAfter = ($('.doc')?.innerHTML ?? '').slice(0, 200);
    clickEl(highBtn()); await sleep(250);
    clickEl($$('.color-item').find((c) => (c.textContent ?? '').includes('None'))); await sleep(250);
    ed.highlightCleared = !highBtn()?.querySelector('.tb-dot');
    await selectAllDoc();
    const colorBtn = () => $$('.tb-btn').find((b) => (b.dataset.tooltip ?? '') === 'Text color');
    clickEl(colorBtn()); await sleep(250);
    clickEl($$('.color-item').find((c) => (c.textContent ?? '').includes('Red'))); await sleep(250);
    ed.colorSet = !!colorBtn()?.querySelector('.tb-dot');
    clickEl(colorBtn()); await sleep(250);
    clickEl($$('.color-item').find((c) => (c.textContent ?? '').includes('Default'))); await sleep(250);
    ed.colorCleared = !colorBtn()?.querySelector('.tb-dot');

    // bubble menu over a selection
    await selectAllDoc();
    let bubble = null;
    for (let i = 0; i < 14 && !bubble; i++) { await sleep(120); bubble = $('.bubble'); }
    ed.bubbleShown = !!bubble;
    ed.bubbleButtons = $$('.bubble .b-btn').length;
    const bBold = $$('.bubble .b-btn').find((b) => (b.dataset.tooltip ?? '') === 'Bold');
    if (bBold) { clickEl(bBold); await sleep(200); ed.bubbleBoldWorks = !!$('.doc strong'); clickEl(bBold); await sleep(200); }

    // tags: add via Enter, remove via chip-x, re-add
    const tagInput = await waitFor('.tag-input');
    setInput(tagInput, 'Exam');
    tagInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await sleep(500);
    ed.tagAdded = $$('.chip-tag').some((c) => (c.textContent ?? '').includes('#Exam'));
    const chipX = $('.chip-tag .chip-x');
    if (chipX) { clickEl(chipX); await sleep(500); ed.tagRemoved = !$$('.chip-tag').some((c) => (c.textContent ?? '').includes('#Exam')); }
    setInput(tagInput, 'Exam');
    tagInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await sleep(500);
    ed.tagReAdded = $$('.chip-tag').some((c) => (c.textContent ?? '').includes('#Exam'));

    // favorite star toggle
    const starBtn = () => $$('.editor-head-actions .btn-icon').find((b) => (b.dataset.tooltip ?? '').startsWith('Add to favorites') || (b.dataset.tooltip ?? '').startsWith('Remove favorite'));
    ed.starBtn = !!starBtn();
    if (starBtn()) {
      starBtn()?.click(); await sleep(700);
      ed.starOn = (starBtn()?.dataset.tooltip ?? '').startsWith('Remove favorite');
      starBtn()?.click(); await sleep(700);
      ed.starOff = (starBtn()?.dataset.tooltip ?? '').startsWith('Add to favorites');
    }

    // version history panel
    const verBtn = () => $$('.editor-head-actions .btn-icon').find((b) => (b.dataset.tooltip ?? '') === 'Version history');
    clickEl(verBtn()); await sleep(600);
    ed.versionPanel = !!$('.version-panel');
    ed.versionItems = $$('.version-item').length;
    ed.versionRestoreBtn = !!$('.version-item .btn');
    const vClose = $('.version-panel [data-tooltip="Close"]');
    if (vClose) clickEl(vClose);
    await sleep(300);
    ed.versionClosed = !$('.version-panel');

    // more menu: duplicate + move-to-subject modal
    const moreBtn = () => $$('.editor-head-actions .menu-anchor .btn-icon')[0];
    clickEl(moreBtn()); await sleep(300);
    const mi = () => $$('.menu .menu-item');
    ed.moreMenuItems = mi().map((m) => (m.textContent ?? '').trim());
    clickEl(mi().find((m) => (m.textContent ?? '').includes('Duplicate note'))); await sleep(600);
    ed.duplicateToast = toastText().includes('Note duplicated');
    clickEl(moreBtn()); await sleep(300);
    clickEl(mi().find((m) => (m.textContent ?? '').includes('Move to subject'))); await sleep(300);
    ed.moveModal = ($('.modal-title')?.textContent ?? '').includes('Move note to');
    const phys = $$('.modal .menu-item').find((m) => (m.textContent ?? '').includes('Physics'));
    if (phys) { clickEl(phys); await sleep(600); ed.moveToast = toastText().includes('Note moved'); }
    ed.ok = !!(ed.titleCommitted && ed.wordCountOk && ed.saveIndicator && ed.toolbarOk && ed.tableInserted && ed.tableUndo && ed.tableRedo && ed.linkInserted && ed.linkRemoved && ed.highlightPop && ed.highlightSet && ed.highlightCleared && ed.colorSet && ed.colorCleared && ed.bubbleShown && ed.bubbleButtons >= 4 && ed.tagAdded && ed.tagRemoved && ed.tagReAdded && ed.starBtn && ed.starOn && ed.starOff && ed.versionPanel && ed.versionRestoreBtn && ed.versionClosed && ed.duplicateToast && ed.moveModal && ed.moveToast);
    results.ed = ed;

    // ================= SUBJECT VIEW =================
    await clickBack();
    // The new note was created for a subject, so Back lands on that subject
    // (not the dashboard) and the fresh note is listed there.
    await waitFor('.subject-view', 8000, '.subject-view-after-editor');
    ed.backLandsOnSubject = true;
    ed.backSubjectHasNote = ($$('.note-card-full').some((c) => (c.textContent ?? '').includes('E2E Full Feature Note')));
    await clickBack();
    await waitFor('.dashboard', 8000, '.dashboard-after-editor');
    clickEl($$('.subject-card').find((c) => (c.textContent ?? '').includes('Physics')));
    await waitFor('.subject-view', 8000, '.subject-view@physics');
    const sv = {};
    sv.title = ($('.sub-title')?.textContent ?? '').trim();
    sv.movedHere = $$('.ncf-title').some((t) => (t.textContent ?? '').includes('E2E Full Feature Note'));
    const f = $('.sub-search-input');
    setInput(f, 'E2E Full Feature Note'); await sleep(300);
    sv.filterHits = $$('.note-card-full').length;
    setInput(f, 'definitely-no-match-xyz'); await sleep(300);
    sv.filterEmpty = ($('.empty-title')?.textContent ?? '').includes('No notes match');
    setInput(f, ''); await sleep(300);
    const examChip = $$('.sub-filters .chip').find((c) => (c.textContent ?? '').includes('#Exam'));
    sv.tagChip = !!examChip;
    if (examChip) { clickEl(examChip); await sleep(300); sv.tagFilter = examChip.classList.contains('chip-active') && $$('.note-card-full').length >= 1; }
    const favChip = $$('.sub-filters .chip').find((c) => (c.textContent ?? '').includes('Favorites'));
    sv.favChip = !!favChip;
    if (favChip) { clickEl(favChip); await sleep(300); sv.favFilter = favChip.classList.contains('chip-active'); }
    clickEl($$('.sub-filters .chip').find((c) => (c.textContent ?? '').includes('All'))); await sleep(300);
    const cardMenu = () => $('.ncf-menu .btn-icon');
    clickEl(cardMenu()); await sleep(300);
    clickEl(mi().find((m) => (m.textContent ?? '').includes('Add to favorites'))); await sleep(500);
    sv.cardFavorite = !!$('.ncf-star');
    clickEl(cardMenu()); await sleep(300);
    clickEl(mi().find((m) => (m.textContent ?? '').includes('Duplicate'))); await sleep(500);
    sv.cardCountAfterDup = $$('.note-card-full').length;
    clickEl(cardMenu()); await sleep(300);
    clickEl(mi().find((m) => (m.textContent ?? '').includes('Delete'))); await sleep(300);
    sv.deleteModal = ($('.modal-title')?.textContent ?? '').includes('Delete this note?');
    results.svDiag = {
      menuItems: mi().map((m) => (m.textContent ?? '').trim()),
      menuOpen: !!$('.menu'),
      modals: $$('.modal-title').map((t) => (t.textContent ?? '').trim()),
      toast: toastText(),
    };
    clickEl($$('.modal-foot .btn').find((b) => (b.dataset.tooltip ?? '') === 'Cancel')); await sleep(300);
    sv.deleteCancelled = !$('.modal');
    clickEl(cardMenu()); await sleep(300);
    clickEl(mi().find((m) => (m.textContent ?? '').includes('Delete'))); await sleep(300);
    clickEl($$('.modal-foot .btn-danger')[0]); await sleep(600);
    sv.cardCountAfterDelete = $$('.note-card-full').length;
    sv.ok = !!(sv.movedHere && sv.filterHits >= 1 && sv.filterEmpty && sv.tagChip && sv.tagFilter && sv.favChip && sv.favFilter && sv.cardFavorite && sv.cardCountAfterDup === 2 && sv.deleteModal && sv.deleteCancelled && sv.cardCountAfterDelete === 1);
    results.sv = sv;

    // ================= DASHBOARD SECTIONS =================
    await clickBack();
    await waitFor('.dashboard', 8000, '.dashboard-after-subject');
    dash.favoritesSection = $$('.section-title').some((t) => (t.textContent ?? '').includes('Favorites'));
    dash.tagsSection = $$('.section-title').some((t) => (t.textContent ?? '').includes('Tags'));
    const openFav = $('button[data-tooltip="Open latest favorite"]');
    dash.openFavoriteBtn = !!openFav;
    if (openFav) { openFav.click(); await sleep(700); dash.openFavoriteWorks = !!$('.editor-view'); await clickBack(); await waitFor('.dashboard', 8000, '.dashboard-after-fav'); }
    const tagChip = $$('.tag-cloud .chip').find((c) => (c.textContent ?? '').includes('#Exam'));
    dash.tagChip = !!tagChip;
    if (tagChip) {
      clickEl(tagChip); await sleep(600);
      dash.tagSearchOpens = !!$('.search-backdrop') && (($('.search-input')?.value ?? '').includes('Exam'));
      key('Escape'); await sleep(300);
      dash.escClosesOverlay = !$('.search-backdrop');
    }
    const searchAll = $('.section-head .btn[data-tooltip="Search across all notes"]');
    dash.searchAllBtn = !!searchAll;
    if (searchAll) { clickEl(searchAll); await sleep(400); dash.searchAllOpens = !!$('.search-backdrop'); key('Escape'); await sleep(300); }

    // ================= ARCHIVE: restore + delete forever =================
    const arch = {};
    clickEl($$('.subject-card').find((c) => (c.textContent ?? '').includes('Physics'))); await waitFor('.subject-view', 8000, '.subject-view@physics2');
    clickEl($('.ncf-menu .btn-icon')); await sleep(300);
    clickEl(mi().find((m) => (m.textContent ?? '').includes('Archive'))); await sleep(700);
    sv.archiveToast = toastText().includes('Note archived');
    await clickBack(); await waitFor('.dashboard', 8000, '.dashboard-after-archive');
    await click('.dash-quick button[data-tooltip="View archived notes"]');
    await waitFor('.archive-item, .empty', 8000, '.archive-open1');
    arch.itemsBefore = $$('.archive-item').length;
    const restoreBtn = $('.archive-item button[data-tooltip="Move back to its subject"]');
    arch.restoreBtnFound = !!restoreBtn;
    if (restoreBtn) {
      restoreBtn.click(); await sleep(700);
      arch.restoreWorks = $$('.archive-item').length === arch.itemsBefore - 1;
      const dbList = await window.nock.notes.list(undefined, true);
      results.archDiag = {
        afterRestore: $$('.archive-item').length,
        toast: toastText(),
        dbCount: dbList.length,
        dbFirst: dbList.slice(0, 3).map((n) => ({ title: n.title, archived: n.isArchived })),
        itemTitles: $$('.archive-title').slice(0, 5).map((t) => (t.textContent ?? '').trim()),
      };
    }
    await clickBack(); await waitFor('.dashboard', 8000, '.dashboard-after-archive2');
    clickEl($$('.subject-card').find((c) => (c.textContent ?? '').includes('Physics'))); await waitFor('.subject-view', 8000, '.subject-view@physics3');
    clickEl($('.ncf-menu .btn-icon')); await sleep(300);
    clickEl(mi().find((m) => (m.textContent ?? '').includes('Archive'))); await sleep(700);
    await clickBack(); await waitFor('.dashboard', 8000, '.dashboard-after-archive3');
    await click('.dash-quick button[data-tooltip="View archived notes"]');
    await waitFor('.archive-item, .empty');
    arch.itemsReArchived = $$('.archive-item').length;
    const delBtn = $('.archive-item button[data-tooltip="Delete forever"]');
    arch.deleteBtn = !!delBtn;
    if (delBtn) {
      delBtn.click(); await sleep(300);
      arch.deleteModal = ($('.modal-title')?.textContent ?? '').includes('Delete forever?');
      results.archDiag = results.archDiag ?? {};
      results.archDiag.deleteModal = {
        modals: $$('.modal-title').map((t) => (t.textContent ?? '').trim()),
        dangerBtns: $$('.modal-foot .btn-danger').length,
      };
      clickEl($$('.modal-foot .btn-danger')[0]); await sleep(700);
      arch.deletedForever = $$('.archive-item').length === 0 && !!$('.empty');
      results.archDiag.afterDelete = { items: $$('.archive-item').length, empty: !!$('.empty'), toast: toastText() };
    }
    await clickBack(); await waitFor('.dashboard', 8000, '.dashboard-after-archive4');
    arch.ok = !!(arch.itemsBefore >= 1 && arch.restoreWorks && arch.deleteBtn && arch.deleteModal && arch.deletedForever && arch.itemsReArchived >= 1);
    results.arch = arch;

    // ================= SETTINGS =================
    const st = {};
    await click('[aria-label="Settings"]');
    await waitFor('.settings-view', 8000, '.settings-view@topbar');
    const setSearch = await waitFor('input[aria-label="Search settings"]');
    setInput(setSearch, 'focus'); await sleep(400);
    st.searchFilters = $$('.settings-row').length >= 1 && $$('.settings-name').some((n) => (n.textContent ?? '').includes('Focus mode'));
    setInput(setSearch, 'zzz-not-a-setting'); await sleep(400);
    st.searchEmpty = !!$('.settings-empty');
    const clearSearch = $('button[data-tooltip="Clear search"]');
    st.clearSearchBtn = !!clearSearch;
    if (clearSearch) { clickEl(clearSearch); await sleep(300); st.searchCleared = !$('.settings-empty'); }

    const themeOption = (label) => $$('.theme-option').find((b) => (b.textContent ?? '').includes(label));
    clickEl(themeOption('Light')); await sleep(300); st.themeLight = document.documentElement.dataset.theme === 'light';
    clickEl(themeOption('Midnight')); await sleep(300); st.themeMidnight = document.documentElement.dataset.theme === 'midnight';
    clickEl(themeOption('Dark')); await sleep(300); st.themeDark = document.documentElement.dataset.theme === 'dark';
    const accentDot = (label) => $$('.accent-dot').find((b) => (b.dataset.tooltip ?? '') === label);
    clickEl(accentDot('Emerald')); await sleep(300); st.accentEmerald = document.documentElement.dataset.accent === 'emerald';
    clickEl(accentDot('Indigo')); await sleep(300); st.accentRestored = document.documentElement.dataset.accent === 'indigo';

    // every toggle flips on then back off
    const labels = [...new Set($$('.switch').map((s) => s.getAttribute('aria-label')).filter(Boolean))];
    st.switchCount = labels.length;
    let switchesOk = true;
    for (const label of labels) {
      const before = swFor(label)?.getAttribute('aria-checked') === 'true';
      clickEl(swFor(label)); await sleep(400);
      const on = swFor(label)?.getAttribute('aria-checked') === 'true';
      clickEl(swFor(label)); await sleep(400);
      const back = swFor(label)?.getAttribute('aria-checked') === 'true';
      if (!(before !== on && on !== back)) switchesOk = false;
    }
    st.switchesToggleBack = switchesOk;

    // transparency presets + slider + glass options
    const preset = (label) => $$('.dock-transparency-preset').find((b) => (b.textContent ?? '').includes(label));
    clickEl(preset('Glass')); await sleep(500);
    let s = await window.nock.settings.get();
    st.presetApplied = s.dockTransparencyEnabled === true && s.dockTransparency === 0.6 && (($('.settings-slider-value')?.textContent ?? '').includes('60%'));
    const slider = $('input[aria-label="Dock transparency"]');
    setRange(slider, 0.45); await sleep(500);
    s = await window.nock.settings.get();
    st.sliderApplied = s.dockTransparency === 0.45 && (($('.settings-slider-value')?.textContent ?? '').includes('45%'));
    const glassBtn = (label) => $$('.dock-glass-option').find((b) => (b.textContent ?? '').includes(label));
    clickEl(glassBtn('Clear')); await sleep(1800);
    st.glassClear = ((await window.nock.settings.get()).dockGlassStyle) === 'clear';
    clickEl(glassBtn('Frosted')); await sleep(1800);
    st.glassFrosted = ((await window.nock.settings.get()).dockGlassStyle) === 'frosted';

    // subjects manager: add + delete (with confirm dialog)
    const addInput = $('.subject-manage-add .input');
    const addBtn = () => $('.subject-manage-add .btn-primary');
    st.addDisabledWhenEmpty = addBtn()?.disabled === true;
    setInput(addInput, 'E2E Test Subject'); await sleep(200);
    st.addEnabledWhenFilled = addBtn()?.disabled === false;
    clickEl(addBtn()); await sleep(700);
    st.subjectAdded = $$('.subject-manage-name').some((n) => (n.textContent ?? '').includes('E2E Test Subject'));
    const delSubject = $$('.subject-manage-item').find((i) => (i.textContent ?? '').includes('E2E Test Subject'))?.querySelector('button[data-tooltip="Delete subject"]');
    clickEl(delSubject); await sleep(300);
    st.deleteSubjectModal = ($('.modal-title')?.textContent ?? '').includes('Delete subject?');
    clickEl($$('.modal-foot .btn-danger')[0]); await sleep(700);
    st.subjectDeleted = !$$('.subject-manage-name').some((n) => (n.textContent ?? '').includes('E2E Test Subject'));

    // reset dialog must offer cancel and keep preferences
    const resetBtn = $('button[data-tooltip="Reset all preferences to defaults"]');
    st.resetBtn = !!resetBtn;
    if (resetBtn) {
      clickEl(resetBtn); await sleep(300);
      st.resetModal = ($('.modal-title')?.textContent ?? '').includes('Reset all preferences?');
      clickEl($$('.modal-foot .btn').find((b) => (b.dataset.tooltip ?? '') === 'Keep current preferences')); await sleep(300);
      st.resetCancelled = !$('.modal');
    }

    st.shortcutRows = $$('.shortcut-row').length;
    st.aboutShown = $$('.settings-name').some((n) => (n.textContent ?? '').includes('Nock v'));
    st.helpSection = $$('.settings-section-title').some((t) => (t.textContent ?? '').includes('Help & Getting Started'));
    st.helpRows = $$('.settings-section').find((s) => (s.textContent ?? '').includes('Help & Getting Started')) ? $$('.settings-row').filter((r) => ['Your first note', 'Capture a screenshot', 'Pin a note to your screen', 'Replay the welcome tour'].some((h) => (r.textContent ?? '').includes(h))).length : 0;
    st.replayTourBtn = !!$('button[data-tooltip="Replay the welcome tour"]');

    // ================= UPDATES (mock scenarios: error → up-to-date → available) =================
    const upd = {};
    try {
      upd.section = $$('.settings-section-title').some((t) => (t.textContent ?? '').includes('Updates'));
      upd.autoToggle = !!swFor('Automatic updates');
      const currentVersion = (await window.nock.appInfo()).version;
      upd.versionShown = ($$('.update-version code')[0]?.textContent ?? '').includes(currentVersion);
      const checkBtn = () => $('button[data-tooltip="Check the Nock GitHub releases for a newer version"]');
      upd.checkBtn = !!checkBtn();

      await window.nock.updates.mockSet('error');
      clickEl(checkBtn()); await sleep(1400);
      upd.errorStatus = (($('.update-status-warn')?.textContent ?? '').includes('Unable to check'));
      upd.diag1 = {
        dom: $$('.update-status').map((s) => (s.textContent ?? '').trim()),
        state: await window.nock.updates.getState(),
      };

      await window.nock.updates.mockSet('up-to-date');
      clickEl(checkBtn()); await sleep(1400);
      upd.upToDateStatus = (($('.update-status-ok')?.textContent ?? '').includes("latest version"));
      upd.diag2 = {
        dom: $$('.update-status').map((s) => (s.textContent ?? '').trim()),
        state: await window.nock.updates.getState(),
      };

      await window.nock.updates.mockSet('available');
      clickEl(checkBtn()); await sleep(1500);
      upd.availableStatus = (($('.update-status-new')?.textContent ?? '').includes('is available'));
      upd.diag3 = {
        dom: $$('.update-status').map((s) => (s.textContent ?? '').trim()),
        state: await window.nock.updates.getState(),
        notice: !!$('.update-notice'),
      };
      upd.noticeShown = !!$('.update-notice');
      upd.noticeVersion = (($('.update-notice-title')?.textContent ?? '').includes('Nock 9.9.9'));

      clickEl($('.update-notice button[data-tooltip="See what changed in this release"]')); await sleep(900);
      upd.notesModal = (($('.modal-title')?.textContent ?? '').includes('Nock 9.9.9'));
      upd.notesText = (($('.update-notes')?.textContent ?? '').includes('Improved dock performance'));
      // Close the notes modal via the Close button (Update Now would open the
      // default browser during QA — never click it).
      clickEl($$('.modal-foot .btn').find((b) => (b.textContent ?? '').trim() === 'Close')); await sleep(300);
      upd.notesClosed = !$('.modal');

      clickEl($('.update-notice button[data-tooltip="Not now — remind me later"]')); await sleep(300);
      upd.laterDismisses = !$('.update-notice');
      // The same release is not re-announced: the settings status still shows
      // the update, but no second notification appears.
      upd.settingsStillShows = (($('.update-status-new')?.textContent ?? '').includes('is available'));
      upd.noDuplicate = !$('.update-notice');
      upd.ok = !!(upd.section && upd.autoToggle && upd.versionShown && upd.checkBtn && upd.errorStatus && upd.upToDateStatus && upd.availableStatus && upd.noticeShown && upd.noticeVersion && upd.notesModal && upd.notesText && upd.notesClosed && upd.laterDismisses && upd.settingsStillShows && upd.noDuplicate);
    } catch (e) {
      upd.error = String(e);
      upd.ok = false;
    }
    results.upd = upd;

    // study/editor extras driven by settings
    st.studyTimerSet = await toggleTo('Study timer', true);
    st.readingProgressSet = await toggleTo('Reading progress', true);
    st.lineNumbersSet = await toggleTo('Show line numbers', true);
    st.dailyStatsSet = await toggleTo('Daily study statistics', true);
    await clickBack(); await waitFor('.dashboard', 8000, '.dashboard-after-settings2');
    st.dailyStatsPill = !!$('.stat-pill[data-tooltip="Today\\'s study activity"]');
    clickEl($('.note-card'));
    const recSeq = [];
    const recT0 = Date.now();
    const recSnap = () => {
      const root = document.querySelector('.app-main')?.firstElementChild;
      return [Date.now() - recT0, root?.className ?? null, document.body.children.length];
    };
    while (Date.now() - recT0 < 8000) {
      recSeq.push(recSnap());
      if (document.querySelector('.app-main')?.firstElementChild?.classList.contains('editor-view')) break;
      await sleep(120);
    }
    // The editor-view mounts as a skeleton while the note loads; wait for the
    // real document before asserting the study extras.
    await waitFor('.editor-view', 8000, '.editor-view@recents');
    await waitFor('.doc[contenteditable]');
    await sleep(400);
    st.studyTimerShown = !!$('.study-timer');
    st.readingProgressShown = !!$('.reading-progress');
    st.lineNumbersShown = !!$('.doc.line-numbers');
    await clickBack(); await waitFor('.dashboard', 8000, '.dashboard-after-editor2');
    await click('[aria-label="Settings"]'); await waitFor('.settings-view', 8000, '.settings-view@topbar2');
    st.studyTimerRestored = await toggleTo('Study timer', false);
    st.readingProgressRestored = await toggleTo('Reading progress', false);
    st.lineNumbersRestored = await toggleTo('Show line numbers', false);
    st.dailyStatsRestored = await toggleTo('Daily study statistics', false);
    await clickBack(); await waitFor('.dashboard', 8000, '.dashboard-after-settings3');
    st.ok = !!(st.searchFilters && st.searchEmpty && st.clearSearchBtn && st.searchCleared && st.themeLight && st.themeMidnight && st.themeDark && st.accentEmerald && st.accentRestored && st.switchCount >= 19 && st.switchesToggleBack && st.presetApplied && st.sliderApplied && st.glassClear && st.glassFrosted && st.addDisabledWhenEmpty && st.addEnabledWhenFilled && st.subjectAdded && st.deleteSubjectModal && st.subjectDeleted && st.resetBtn && st.resetModal && st.resetCancelled && st.shortcutRows >= 10 && st.aboutShown && st.helpSection && st.helpRows >= 4 && st.replayTourBtn && st.studyTimerSet && st.readingProgressSet && st.lineNumbersSet && st.dailyStatsSet && st.dailyStatsPill && st.studyTimerShown && st.readingProgressShown && st.lineNumbersShown && st.studyTimerRestored && st.readingProgressRestored && st.lineNumbersRestored && st.dailyStatsRestored);
    results.st = st;

    // ================= DATA & STORAGE (export → mutate → restore → corrupt) =================
    // Smoke mode: file dialogs are bypassed and the import flow consumes a
    // fixed queue (the exported backup, then a corrupt file pre-written by
    // scripts/smoke.mjs) so the real UI flow can be driven end to end.
    const bk = {};
    try {
      await click('[aria-label="Settings"]'); await waitFor('.settings-view', 8000, '.settings-view@bk');
      bk.section = $$('.settings-section-title').some((t) => (t.textContent ?? '').includes('Data & Storage'));
      bk.exportBtn = !!$('button[data-tooltip="Export Nock Data"]');
      bk.importBtn = !!$('button[data-tooltip="Import Backup"]');
      const countsBefore = await window.nock.backup.counts();
      bk.countsRowShown = (($('.data-panel-counts')?.textContent ?? '').includes(String(countsBefore.notes)));

      clickEl($('button[data-tooltip="Export Nock Data"]'));
      const userData = (await window.nock.appInfo()).userData;
      // The export runs in the main process (snapshot + zip write); poll for
      // the finished file instead of guessing a fixed wait time.
      let exported = null;
      for (let i = 0; i < 24 && !exported; i++) {
        await sleep(500);
        exported = await window.nock.backup.inspect(userData + '/_smoke_export.nockbackup').catch(() => null);
      }
      bk.exportWorked =
        !!exported &&
        exported.counts.notes === countsBefore.notes &&
        exported.counts.subjects === countsBefore.subjects &&
        exported.counts.screenshots === countsBefore.screenshots;

      // Change the data, then restore the exported snapshot over it.
      const subjects = await window.nock.subjects.list();
      const tempNote = await window.nock.notes.create(subjects[0].id, 'Backup E2E temp note');
      bk.notesAfterMutation = (await window.nock.backup.counts()).notes === countsBefore.notes + 1;

      clickEl($('button[data-tooltip="Import Backup"]')); await sleep(1500);
      bk.confirmModal = (($('.modal-title')?.textContent ?? '').includes('Restore Nock Backup?'));
      bk.confirmCounts = !!exported && (($('.modal-body')?.textContent ?? '').includes(String(exported.counts.notes)));
      clickEl($$('.modal-foot .btn').find((b) => (b.textContent ?? '').includes('Backup Current Data & Restore')));
      await sleep(2800);
      bk.modalClosed = !$('.modal');
      const countsAfter = await window.nock.backup.counts();
      bk.diag = {
        before: countsBefore,
        exp: exported ? { notes: exported.counts.notes, subjects: exported.counts.subjects, screenshots: exported.counts.screenshots } : null,
        after: countsAfter,
        afterCorrupt: null,
      };
      bk.restoreWorked =
        !!exported &&
        countsAfter.notes === exported.counts.notes &&
        countsAfter.subjects === exported.counts.subjects &&
        countsAfter.screenshots === exported.counts.screenshots;
      bk.restoreToast = toastText().includes('Restore complete');
      void tempNote;

      // A corrupt backup must be rejected without touching the data.
      clickEl($('button[data-tooltip="Import Backup"]')); await sleep(1800);
      bk.corruptRejected = !$('.modal') && toastText().includes('cannot be restored');
      const countsAfterCorrupt = await window.nock.backup.counts();
      bk.diag.afterCorrupt = countsAfterCorrupt;
      bk.dataIntactAfterCorrupt = countsAfterCorrupt.notes === countsAfter.notes;

      await clickBack(); await waitFor('.dashboard', 8000, '.dashboard-after-bk');
      bk.ok = !!(bk.section && bk.exportBtn && bk.importBtn && bk.countsRowShown && bk.exportWorked && bk.notesAfterMutation && bk.confirmModal && bk.confirmCounts && bk.modalClosed && bk.restoreWorked && bk.restoreToast && bk.corruptRejected && bk.dataIntactAfterCorrupt);
    } catch (e) {
      bk.error = String(e);
      bk.ok = false;
    }
    results.bk = bk;

    // ================= SEARCH OVERLAY + SHORTCUTS =================
    const sr = {};
    key('k', { ctrlKey: true }); await sleep(400);
    sr.ctrlKOpens = !!$('.search-backdrop');
    const searchInput = await waitFor('.search-input');
    setInput(searchInput, 'Nock'); await sleep(700);
    sr.results = $$('.search-result').length;
    searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    await sleep(250);
    sr.arrowNav = $$('.search-result').some((r) => r.classList.contains('active'));
    searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await sleep(800);
    sr.enterOpensNote = !!$('.editor-view');
    key('k', { ctrlKey: true }); await sleep(400);
    key('Escape'); await sleep(300);
    sr.escCloses = !$('.search-backdrop');
    // shortcut bar: Ctrl+N, Ctrl+Shift+F, Ctrl+D, Ctrl+Shift+A
    key('n', { ctrlKey: true }); await sleep(800);
    sr.ctrlN = !!$('.editor-view');
    key('f', { ctrlKey: true, shiftKey: true }); await sleep(500);
    sr.ctrlShiftF = !!$$('.editor-head-actions .btn-icon').find((b) => (b.dataset.tooltip ?? '').startsWith('Remove favorite'));
    key('d', { ctrlKey: true }); await sleep(600);
    sr.ctrlD = toastText().includes('Note duplicated');
    key('a', { ctrlKey: true, shiftKey: true }); await sleep(800);
    sr.ctrlShiftA = !$('.editor-view');
    sr.ok = !!(sr.ctrlKOpens && sr.results >= 1 && sr.arrowNav && sr.enterOpensNote && sr.escCloses && sr.ctrlN && sr.ctrlShiftF && sr.ctrlD && sr.ctrlShiftA);
    results.sr = sr;

    // restore any settings the tour touched
    await window.nock.settings.set('dockTransparencyEnabled', false);
    await window.nock.settings.set('dockTransparency', 1);
    await window.nock.settings.set('dockGlassStyle', 'frosted');

    results.topbar = topbar;
    results.dash = dash;
    results.ed = ed;
    results.sv = sv;
    results.arch = arch;
    results.st = st;
    results.sr = sr;
    results.ok = !!(topbar.ok && dash.ok && ed.ok && sv.ok && arch.ok && st.ok && bk.ok && sr.ok);
  } catch (err) {
    results.error = String(err);
    results.diag = {
      viewRoot: document.querySelector('.app-main')?.firstElementChild?.className ?? null,
      bodyChildren: document.body.children.length,
      noteCards: $$('.note-card').length,
      noteCardFulls: $$('.note-card-full').length,
      recentsSection: !!$('.note-strip'),
      editorLoading: !!$('.editor-loading'),
      toast: $$('.toast').map((t) => t.textContent ?? '').join(' | ')
    };
    // Leave the library on the dashboard so a retry (or the user) always
    // starts from the front door, no matter which section failed.
    try {
      await window.nock.window.openMain('dashboard');
      await sleep(400);
    } catch {
      /* ignore */
    }
  }
  return results;
})()`;

// Comprehensive feature tour of the dock window: every header/footer button,
// dock search, subject chip, note-card controls, editor toolbar, recents,
// resize handles (width/height/corner) and the responsive layout states
// (narrow / short / mini / roomy). Runs after FULL_SCRIPT, which restores the
// dock to frosted glass, expanded, at default size.
const DOCK_FULL_SCRIPT = `(async () => {
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
  const clickEl = (el) => { if (el) el.click(); };
  const setInput = (el, value) => {
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const results = {};
  try {
    const ensureExpanded = async () => {
      for (let i = 0; i < 30; i++) {
        if ($('.dock-collapsed')) {
          const logo = $('.dock-rail-logo');
          if (logo) logo.click();
          else await window.nock.dock.toggleCollapse();
          await sleep(500);
        }
        if ($('.dock-expanded') && $('.dock-btn-new')) return true;
        await sleep(150);
      }
      return !!($('.dock-expanded') && $('.dock-btn-new'));
    };
    await window.nock.settings.set('dockAutoHide', false);
    await ensureExpanded();
    if (!$('.dock-expanded')) return { ok: false, reason: 'dock not expanded' };
    const byTip = (tip) => $$('.dock-btn').find((b) => (b.dataset.tooltip ?? '') === tip);
    results.glassAttr = $('.dock')?.dataset.glass ?? null;
    results.glassFrosted = results.glassAttr === 'frosted';

    // header: New / Dashboard / Settings / Pin
    results.newBtn = !!byTip('Create a new sticky note');
    const before = (await window.nock.notes.list()).length;
    let after = before;
    const att = [];
    const onPD = (e) => att.push('pd:' + (e.target?.className || e.target?.tagName || '?').toString().slice(0, 50));
    document.addEventListener('pointerdown', onPD, true);
    for (let attempt = 0; attempt < 3 && after <= before; attempt++) {
      const b = byTip('Create a new sticky note');
      att.push('att' + attempt + ':found=' + !!b + ':' + ($('.dock')?.className ?? 'none'));
      if (b) b.click();
      for (let i = 0; i < 20 && after <= before; i++) { await sleep(150); after = (await window.nock.notes.list()).length; }
    }
    document.removeEventListener('pointerdown', onPD, true);
    results.newCreatesNote = after > before;
    results.newDiag = {
      before, after, att,
      stateStart: await window.nock.dock.getState(),
      stateEnd: await window.nock.dock.getState(),
      chipText: $('.dock-subject-chip')?.textContent?.trim() ?? null,
      subjects: (await window.nock.subjects.list()).map((s) => s.name),
    };
    results.noteTitleInput = !!$('.dock-note-title');
    results.dashBtn = !!byTip('Library — return to your main notes library');
    results.libraryBtnEmphasis = !!($('.dock-btn-library') && getComputedStyle($('.dock-btn-library')).backgroundColor !== 'rgba(0, 0, 0, 0)');
    results.settingsBtn = !!byTip('Customize Nock — themes, transparency, subjects and shortcuts');
    const pinBtn = () => $$('.dock-btn').find((b) => (b.dataset.tooltip ?? '').startsWith('Pin ') || (b.dataset.tooltip ?? '').startsWith('Unpin '));
    results.pinBtn = !!pinBtn();
    if (pinBtn()) {
      const before = (pinBtn()?.dataset.tooltip ?? '').startsWith('Unpin');
      clickEl(pinBtn()); await sleep(400);
      results.pinToggles = ((pinBtn()?.dataset.tooltip ?? '').startsWith('Unpin')) !== before;
      clickEl(pinBtn()); await sleep(400);
      results.pinRestored = ((pinBtn()?.dataset.tooltip ?? '').startsWith('Unpin')) === before;
    }

    // capture quick toggles: clicking flips the shared settings (the single
    // source of truth for Settings and Dock alike)
    const captureToggles = () => $$('.dock-capture-toggle');
    results.captureToggleRow = captureToggles().length === 2;
    const textToggle = () => $$('.dock-capture-toggle').find((b) => (b.dataset.tooltip ?? '').startsWith('Text Capture') || (b.dataset.tooltip ?? '').startsWith('Click to enable automatic text'));
    const shotToggle = () => $$('.dock-capture-toggle').find((b) => (b.dataset.tooltip ?? '').startsWith('Screenshot Capture') || (b.dataset.tooltip ?? '').startsWith('Click to enable automatic screenshot'));
    if (textToggle() && shotToggle()) {
      const t0 = (await window.nock.settings.get()).autoCaptureText;
      const s0 = (await window.nock.settings.get()).autoInsertScreenshots;
      const tTip0 = textToggle()?.dataset.tooltip ?? '';
      const sTip0 = shotToggle()?.dataset.tooltip ?? '';
      clickEl(textToggle()); await sleep(500);
      clickEl(shotToggle()); await sleep(500);
      results.textToggleFlipped = (await window.nock.settings.get()).autoCaptureText === !t0;
      results.shotToggleFlipped = (await window.nock.settings.get()).autoInsertScreenshots === !s0;
      const tTip1 = textToggle()?.dataset.tooltip ?? '';
      const sTip1 = shotToggle()?.dataset.tooltip ?? '';
      results.textToggleTooltipTracks = (tTip0.startsWith('Text Capture')) !== (tTip1.startsWith('Text Capture'));
      results.shotToggleTooltipTracks = (sTip0.startsWith('Screenshot Capture')) !== (sTip1.startsWith('Screenshot Capture'));
      clickEl(textToggle()); await sleep(500);
      clickEl(shotToggle()); await sleep(500);
      results.captureRestored = (await window.nock.settings.get()).autoCaptureText === t0 && (await window.nock.settings.get()).autoInsertScreenshots === s0;
    }

    // dock search: query, clear, then open a result (opening a result clears
    // the search, so the clear button must be verified before that)
    const ds = $('.dock-search-input');
    results.dockSearch = !!ds;
    if (ds) {
      setInput(ds, 'Hello Nock'); await sleep(800);
      const rows = $$('.dock-search-row');
      results.searchRows = rows.length;
      const clear = $('.dock-search-clear');
      results.searchClearBtn = !!clear;
      if (clear) { clickEl(clear); await sleep(300); results.searchCleared = (ds.value ?? '') === ''; }
      setInput(ds, 'Hello Nock'); await sleep(800);
      const rows2 = $$('.dock-search-row');
      if (rows2.length > 0) { clickEl(rows2[0]); await sleep(900); results.searchOpensNote = true; }
    }

    // subject chip: pop opens with options
    const chip = $('.dock-subject-chip');
    results.subjectChip = !!chip;
    if (chip) {
      clickEl(chip); await sleep(400);
      results.subjectPop = !!$('.dock-subject-pop');
      results.subjectOptions = $$('.dock-subject-option').length;
      results.manageLink = !!$('.dock-subject-manage');
      clickEl(chip); await sleep(300);
    }

    // note card: title commit + star toggle
    const title = $('.dock-note-title');
    if (title) {
      setInput(title, 'Dock E2E Title'); await sleep(600);
      results.titleCommitted = (await window.nock.notes.list()).some((n) => n.title === 'Dock E2E Title');
    }
    const star = () => $$('.dock-btn').find((b) => (b.dataset.tooltip ?? '').startsWith('Add to favorites') || (b.dataset.tooltip ?? '').startsWith('Remove from favorites'));
    results.noteStar = !!star();
    if (star()) {
      const before = (star()?.dataset.tooltip ?? '').startsWith('Remove');
      clickEl(star()); await sleep(400);
      results.starToggles = ((star()?.dataset.tooltip ?? '').startsWith('Remove')) !== before;
      clickEl(star()); await sleep(400);
      results.starRestored = ((star()?.dataset.tooltip ?? '').startsWith('Remove')) === before;
    }

    // dock editor toolbar: all 9 formatting buttons
    const doc = $('.dock-editor .ProseMirror');
    results.dockEditor = !!doc;
    if (doc) {
      doc.focus();
      document.execCommand('insertText', false, 'dock toolbar text ');
      await sleep(200);
      const tips = ['Heading 1 — big section title', 'Heading 2 — sub-section title', 'Bold — make text heavier', 'Italic — slant text for emphasis', 'Bulleted list — add bullet points', 'Numbered list — add steps or order', 'Checklist — track tasks to do', 'Quote — highlight a quotation', 'Code block — show code neatly'];
      const toggles = {};
      for (const tip of tips) {
        const btn = $$('.dock-ttb').find((b) => (b.dataset.tooltip ?? '') === tip);
        if (!btn) { toggles[tip] = 'missing'; continue; }
        const before = btn.classList.contains('active');
        clickEl(btn); await sleep(160);
        const on = btn.classList.contains('active');
        clickEl(btn); await sleep(160);
        const off = btn.classList.contains('active');
        toggles[tip] = before === false && on === true && off === false;
      }
      results.dockToolbar = toggles;
      results.dockToolbarOk = Object.values(toggles).every((v) => v === true);
    }

    // diagnostics: capture the dock chrome state before the recents section so
    // any mid-run regression (focus mode, lock, collapsed, mini…) is visible
    results.dockDiag = {
      cls: $('.dock')?.className ?? null,
      search: !!$('.dock-search'),
      recents: !!$('.dock-recents'),
      foot: !!$('.dock-foot'),
      resize: $$('.dock-resize').length,
      recentsBtn: !!$('.dock-recents-toggle'),
      noteTitle: !!$('.dock-note-title'),
    };

    // recents: expand, rows, star on a row, open library, collapse back
    const recentsToggle = $('.dock-recents-toggle');
    results.recentsToggle = !!recentsToggle;
    if (recentsToggle) {
      clickEl(recentsToggle); await sleep(400);
      results.recentsExpanded = !$('.dock-recents')?.classList.contains('compact');
      results.recentRows = $$('.dock-recent').length;
      const rStar = () => $('.dock-recent-star');
      results.recentStar = !!rStar();
      if (rStar()) {
        const before = rStar()?.classList.contains('on') === true;
        clickEl(rStar()); await sleep(600);
        results.recentStarToggles = (rStar()?.classList.contains('on') === true) !== before;
        clickEl(rStar()); await sleep(600);
        results.recentStarRestored = (rStar()?.classList.contains('on') === true) === before;
      }
      results.openLibrary = !!$('.dock-open-library');
      clickEl($('.dock-recents-toggle')); await sleep(400);
      results.recentsCompactAgain = $('.dock-recents')?.classList.contains('compact') === true;
    }

    // footer: the More (…) menu holds lock / focus / minimize
    const moreBtn = () => $$('.dock-btn').find((b) => (b.dataset.tooltip ?? '') === 'More options — lock, focus and minimize');
    const moreItem = (tip) => $$('.dock-more-item').find((b) => (b.dataset.tooltip ?? '') === tip);
    const openMore = async () => {
      let tries = 0;
      while (!$('.dock-more-pop') && tries < 8) {
        const b = moreBtn();
        if (b) b.click();
        await sleep(250);
        tries++;
      }
      return !!$('.dock-more-pop');
    };
    results.moreBtn = !!moreBtn();
    if (moreBtn()) {
      await openMore();
      results.morePop = !!$('.dock-more-pop');
      results.lockItem = !!moreItem('Lock position') || !!moreItem('Unlock position');
      results.focusItem = !!moreItem('Focus mode');
      results.minimizeItem = !!moreItem('Minimize');
      // lock through the menu: resize handles must disappear
      const lockEl = moreItem('Lock position') ?? moreItem('Unlock position');
      if (lockEl) {
        const wasLocked = (lockEl.dataset.tooltip ?? '') === 'Unlock position';
        lockEl.click(); await sleep(500);
        results.lockHidesHandles = $$('.dock-resize').length === 0;
        await openMore();
        const unlockEl = moreItem('Unlock position');
        results.unlockItemAfter = !!unlockEl;
        if (unlockEl) {
          unlockEl.click(); await sleep(500);
          results.unlockRestoresHandles = $$('.dock-resize').length >= 1;
        }
        if (!wasLocked && !results.unlockItemAfter) {
          // lock flip failed — make sure the dock is left unlocked regardless
          await window.nock.dock.setLocked(false); await sleep(400);
        }
      }
    }

    // focus mode via the menu: chrome hidden, header exit restores
    await openMore();
    results.focusItem2 = !!moreItem('Focus mode');
    const fmItem = moreItem('Focus mode');
    if (fmItem) {
      fmItem.click(); await sleep(600);
      results.focusModeOn = $('.dock')?.classList.contains('focus') === true && !$('.dock-search') && !$('.dock-recents');
      const exit = $$('.dock-btn').find((b) => (b.dataset.tooltip ?? '').startsWith('Exit focus mode'));
      results.focusExitBtn = !!exit;
      if (exit) { exit.click(); await sleep(600); results.focusModeOff = $('.dock')?.classList.contains('focus') !== true; }
    }

    // tooltip audit: EVERY widget with a data-tooltip must show its info on
    // hover — the small dock buttons are only usable if their labels appear.
    await ensureExpanded();
    const tooltips = {};
    const widgetSel = '.dock-btn, .dock-ttb, .dock-subject-chip, .dock-recents-toggle, .dock-note-star, .dock-resize, .dock-resize-t, .dock-resize-b, .dock-resize-tc, .dock-resize-bc, .dock-capture-toggle';
    const widgets = $$(widgetSel);
    results.tooltipState = {
      dockCls: $('.dock')?.className ?? null,
      dockConnected: $('.dock')?.isConnected ?? false,
      widgets: widgets.length,
      noteTitle: !!$('.dock-note-title'),
      recents: $$('.dock-recent').length,
      ttb: $$('.dock-ttb').length,
      search: !!$('.dock-search'),
      subjectRow: !!$('.dock-subject-row'),
      foot: !!$('.dock-foot'),
      resize: $$('.dock-resize').length,
    };
    const hoverEl = (el) => {
      el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
      el.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false }));
      el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    };
    const hoverAway = (el) => {
      el.dispatchEvent(new PointerEvent('pointerout', { bubbles: true }));
      window.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    };
    for (let el of widgets) {
      const tip = el.dataset.tooltip;
      if (!tip) continue;
      if (!el.isConnected) {
        const live = $$(widgetSel).find((b) => (b.dataset.tooltip ?? '') === tip);
        if (!live) { tooltips[tip] = 'stale'; continue; }
        el = live;
      }
      // A tooltip lingering from the previous widget would keep the wrong text
      // visible and fail this check; force it away before hovering the next one.
      const lingering = $('.tooltip');
      if (lingering) {
        lingering.dispatchEvent(new PointerEvent('pointerout', { bubbles: true }));
        lingering.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
        await sleep(80);
      }
      hoverEl(el);
      let shown = false;
      let polls = 0;
      for (let i = 0; i < 20 && !shown; i++) {
        await sleep(100);
        polls++;
        const t = $('.tooltip.show');
        shown = !!t && (t.textContent ?? '').trim() === tip;
      }
      tooltips[tip] = shown;
      results.tooltipDiag = results.tooltipDiag ?? {};
      if (!shown) results.tooltipDiag[tip] = { connected: el.isConnected, polls, tipEls: $$('.dock-ttb').length, tooltipText: $('.tooltip')?.textContent ?? null };
      hoverAway(el);
      await sleep(60);
    }
    results.tooltips = tooltips;
    results.tooltipCount = Object.keys(tooltips).length;
    results.tooltipOk = results.tooltipCount >= 12 && Object.values(tooltips).every((v) => v === true);

    // resize: inner width edge + bottom corner (both dimensions)
    await ensureExpanded();
    const inner = $('.dock-resize');
    results.innerHandle = !!inner;
    if (inner) {
      const w0 = window.innerWidth;
      inner.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, screenX: 300, screenY: 400 }));
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, screenX: 360, screenY: 400 }));
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, screenX: 360, screenY: 400 }));
      await sleep(400);
      results.widthShrank = window.innerWidth < w0 - 20;
      await window.nock.dock.setWidth(320); await sleep(500);
      results.widthRestored = window.innerWidth === 320;
    }
    const corner = $('.dock-resize-bc') ?? $('.dock-resize-tc');
    results.cornerHandle = !!corner;
    if (corner) {
      const h1 = window.innerHeight;
      const w1 = window.innerWidth;
      // Dock is on the right: dragging right (+x) shrinks width, dragging up
      // (-y) shrinks height — a single corner drag must do both.
      corner.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, screenX: 200, screenY: h1 }));
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, screenX: 260, screenY: h1 - 160 }));
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, screenX: 260, screenY: h1 - 160 }));
      await sleep(400);
      results.cornerShrinksWidth = window.innerWidth < w1 - 20;
      results.cornerShrinksHeight = window.innerHeight < h1 - 100;
      await window.nock.dock.setSize(320, window.screen.availHeight); await sleep(500);
      results.cornerRestored = window.innerWidth === 320;
    }

    // responsive layout flags
    await ensureExpanded();
    const resp = {};
    const setSize = async (w, h) => { await window.nock.dock.setSize(w, h); await sleep(550); };
    // Baseline = the dock's own clamped size (main clamps to the primary work
    // area, which may differ from the renderer's screen.avail* on multi-monitor
    // or scaled displays) — restore to that exact size and verify against it.
    const base = await window.nock.dock.getState();
    await setSize(240, 900);
    resp.narrow = $('.dock')?.classList.contains('narrow') === true;
    resp.subjectHiddenNarrow = !$('.dock-subject-row') || getComputedStyle($('.dock-subject-row')).display === 'none';
    await setSize(240, 300);
    resp.short = $('.dock')?.classList.contains('short') === true;
    resp.searchHiddenShort = !$('.dock-search') || getComputedStyle($('.dock-search')).display === 'none';
    await setSize(240, 260);
    resp.mini = $('.dock')?.classList.contains('mini') === true;
    resp.footHiddenMini = !$('.dock-foot') || getComputedStyle($('.dock-foot')).display === 'none';
    await setSize(430, 700);
    resp.roomy = $$('.dock-btn-new .dock-btn-label').some((l) => (l.textContent ?? '').trim() === 'New');
    await setSize(base.width, base.height);
    // poll: the real resize can land a moment after the IPC resolves.
    const restoreOk = () => window.innerWidth === base.width && Math.abs(window.innerHeight - base.height) < 60;
    const r0 = Date.now();
    while (!restoreOk() && Date.now() - r0 < 3000) await sleep(150);
    resp.restored = restoreOk();
    results.responsive = resp;

    // transparency: on (translucent + alpha var) then off
    await ensureExpanded();
    await window.nock.settings.set('dockTransparencyEnabled', true); await sleep(500);
    results.translucent = $('.dock')?.dataset.translucent === 'on';
    results.alphaVar = ($('.dock')?.style.getPropertyValue('--dock-alpha') ?? '').trim() !== '';
    await window.nock.settings.set('dockTransparencyEnabled', false); await sleep(500);
    results.translucentOff = $('.dock')?.dataset.translucent === 'off';

    results.ok = !!(
      results.glassFrosted && results.newBtn && results.newCreatesNote && results.noteTitleInput &&
      results.dashBtn && results.libraryBtnEmphasis && results.settingsBtn && results.pinBtn && results.pinToggles && results.pinRestored &&
      results.captureToggleRow && results.textToggleFlipped && results.shotToggleFlipped && results.textToggleTooltipTracks && results.shotToggleTooltipTracks && results.captureRestored &&
      results.dockSearch && results.searchRows >= 1 && results.searchOpensNote && results.searchClearBtn && results.searchCleared &&
      results.subjectChip && results.subjectPop && results.subjectOptions >= 1 && results.manageLink &&
      results.titleCommitted && results.noteStar && results.starToggles && results.starRestored &&
      results.dockEditor && results.dockToolbarOk &&
      results.recentsToggle && results.recentsExpanded && results.recentRows >= 2 && results.recentStar && results.recentStarToggles && results.recentStarRestored && results.openLibrary && results.recentsCompactAgain &&
      results.moreBtn && results.morePop && results.lockItem && results.focusItem && results.minimizeItem &&
      results.lockHidesHandles && results.unlockRestoresHandles &&
      results.focusModeOn && results.focusExitBtn && results.focusModeOff &&
      results.tooltipOk &&
      results.innerHandle && results.widthShrank && results.widthRestored &&
      results.cornerHandle && results.cornerShrinksWidth && results.cornerShrinksHeight && results.cornerRestored &&
      results.responsive?.narrow && results.responsive?.subjectHiddenNarrow &&
      results.responsive?.short && results.responsive?.searchHiddenShort &&
      results.responsive?.mini && results.responsive?.footHiddenMini &&
      results.responsive?.roomy && results.responsive?.restored &&
      results.translucent && results.alphaVar && results.translucentOff
    );
    return results;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
})()`;
