import { app, screen, protocol } from 'electron';
import { initDb, getSettings } from './db';
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
          console.log('E2E_RESULT ' + JSON.stringify(result));
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
    const dockState = await window.dockly.dock.open(notes[0]?.id);
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
    };
  } catch (err) {
    return { error: String(err) };
  }
})()`;
