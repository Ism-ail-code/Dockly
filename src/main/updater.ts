// Automatic update checking for Nock.
//
// Sources of truth, in priority order:
//   1. QA mock  — NOCK_UPDATE_MOCK env (smoke harness only; never in production)
//   2. electron-updater — the packaged NSIS install (established electron-builder
//      infrastructure; GitHub provider reads the official repository)
//   3. GitHub API fallback — used in dev mode and for portable builds, where
//      electron-updater cannot self-install. The API only returns public
//      release metadata (tag/version/notes/url) — no user data ever leaves
//      the machine.
//
// The check never blocks startup, never throws into the app, and only
// announces a version once per session. All state is pushed to the renderers
// over 'updates:state'.

import { app, ipcMain, shell } from 'electron';
import { autoUpdater, type UpdateInfo } from 'electron-updater';
import { isNewerVersion, stripVersionPrefix } from '../shared/version';
import type { Settings, UpdateInfo as UpdateInfoMsg, UpdateState } from '../shared/types';
import { hub } from './state';
import { getSettings } from './db';

const REPO_OWNER = 'Ism-ail-code';
const REPO_NAME = 'Nock';
const RELEASES_LATEST_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
const RELEASE_PAGE_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases`;

const CHECK_TIMEOUT_MS = 10_000;
const AUTO_CHECK_DELAY_MS = 6_000;

let state: UpdateState = { phase: 'idle' };
let checkedThisSession = false;
let autoCheckScheduled = false;
const notesCache = new Map<string, string>();

function broadcast(): void {
  for (const win of [hub.main, hub.dock]) {
    if (win && !win.isDestroyed()) win.webContents.send('updates:state', state);
  }
}

function setState(next: UpdateState): void {
  state = next;
  broadcast();
}

function currentVersion(): string {
  return app.getVersion();
}

function getRepoProvider(): string {
  // NOCK_UPDATE_MOCK is a QA-only switch: when set, the value is the
  // scenario to simulate ('error' | 'up-to-date' | 'available').
  if (process.env.NOCK_UPDATE_MOCK) return 'mock';
  return app.isPackaged ? 'electron-updater' : 'github-api';
}

function updateInfo(): UpdateInfoMsg {
  return {
    currentVersion: currentVersion(),
    isPackaged: app.isPackaged,
    installSupported: app.isPackaged && autoUpdater.isUpdaterActive(),
  };
}

function mockScenario(): string {
  return process.env.NOCK_UPDATE_MOCK ?? '';
}

// ---------- GitHub API provider (dev + portable + notes) ----------

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'Nock' },
    signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`github ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

async function checkViaGitHubApi(): Promise<UpdateState> {
  const release = await fetchJson(RELEASES_LATEST_URL);
  const tag = String(release.tag_name ?? '');
  const version = stripVersionPrefix(tag);
  if (!isNewerVersion(version, currentVersion())) {
    return { phase: 'up-to-date', checkedAt: Date.now() };
  }
  const htmlUrl = String(release.html_url ?? `${RELEASE_PAGE_URL}/tag/${tag}`);
  const body = typeof release.body === 'string' && release.body.trim() ? release.body.trim() : null;
  if (body) notesCache.set(version, body);
  return { phase: 'available', version, htmlUrl, notes: body, releasedAt: String(release.published_at ?? '') };
}

// ---------- electron-updater provider (packaged NSIS) ----------

function wireElectronUpdater(): void {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('checking-for-update', () => {
    setState({ phase: 'checking' });
  });
  autoUpdater.on('update-available', (info: UpdateInfo) => {
    const version = stripVersionPrefix(info.version);
    // The updater only fires this for strictly newer versions, but guard
    // anyway so a misconfigured feed can never cause a "downgrade" prompt.
    if (!isNewerVersion(version, currentVersion())) {
      setState({ phase: 'up-to-date', checkedAt: Date.now() });
      return;
    }
    const htmlUrl = `${RELEASE_PAGE_URL}/tag/v${version}`;
    const notes = typeof info.releaseNotes === 'string' ? info.releaseNotes.trim() : null;
    setState({ phase: 'available', version, htmlUrl, notes });
    if (notes) notesCache.set(version, notes);
  });
  autoUpdater.on('update-not-available', () => {
    setState({ phase: 'up-to-date', checkedAt: Date.now() });
  });
  autoUpdater.on('download-progress', (p) => {
    if (state.phase === 'available' || state.phase === 'downloading') {
      setState({ phase: 'downloading', version: state.version, percent: Math.round(p.percent) });
    }
  });
  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    setState({ phase: 'downloaded', version: stripVersionPrefix(info.version) });
  });
  autoUpdater.on('error', (err) => {
    console.log('[updater] error:', err?.message ?? err);
    setState({ phase: 'error', message: 'Unable to check for updates right now.' });
  });
}

async function checkViaElectronUpdater(): Promise<UpdateState> {
  // Throws synchronously when the provider can't run (e.g. portable build
  // without app-update.yml) — the caller falls back to the GitHub API.
  if (!autoUpdater.isUpdaterActive()) throw new Error('updater inactive');
  void autoUpdater.checkForUpdates();
  // The result arrives asynchronously via the events above; keep the current
  // state ('checking' was already emitted by the event handler).
  return state;
}

// ---------- QA mock provider (smoke harness only) ----------

async function checkViaMock(): Promise<UpdateState> {
  await new Promise((r) => setTimeout(r, 600));
  const scenario = mockScenario();
  console.log('[updater] mock check scenario =', JSON.stringify(scenario));
  if (scenario === 'error') throw new Error('mock network failure');
  if (scenario === 'up-to-date' || scenario === 'latest') {
    return { phase: 'up-to-date', checkedAt: Date.now() };
  }
  const version = process.env.NOCK_UPDATE_MOCK_VERSION ?? '9.9.9';
  return {
    phase: 'available',
    version,
    htmlUrl: `${RELEASE_PAGE_URL}/tag/v${version}`,
    notes: process.env.NOCK_UPDATE_MOCK_NOTES ?? `Improved dock performance\nFixed clipboard capture\nImproved screenshot handling\nAdded better tooltips`,
    releasedAt: new Date().toISOString(),
  };
}

// ---------- Orchestration ----------

async function runCheck(): Promise<void> {
  if (state.phase === 'checking') return;
  setState({ phase: 'checking' });
  try {
    const provider = getRepoProvider();
    if (provider === 'mock') {
      setState(await checkViaMock());
    } else if (provider === 'electron-updater') {
      try {
        await checkViaElectronUpdater();
      } catch {
        // Portable (or missing app-update.yml): no self-install possible, but
        // the user still deserves to know a new version exists.
        setState(await checkViaGitHubApi());
      }
    } else {
      setState(await checkViaGitHubApi());
    }
  } catch (e) {
    console.log('[updater] check failed:', e instanceof Error ? e.message : String(e));
    setState({ phase: 'error', message: 'Unable to check for updates right now.' });
  }
}

/** Manual "Check Now" from the Settings page — always allowed. */
export function checkForUpdates(): void {
  void runCheck();
}

/** Downloads the announced update (NSIS installs only). */
export function downloadUpdate(): void {
  if (state.phase !== 'available') return;
  if (!app.isPackaged || !autoUpdater.isUpdaterActive()) return;
  void autoUpdater.downloadUpdate().catch((e) => {
    console.log('[updater] download failed:', e?.message ?? String(e));
    setState({ phase: 'error', message: 'Unable to check for updates right now.' });
  });
}

/** Installs the downloaded update and restarts Nock. */
export function installUpdate(): void {
  if (state.phase !== 'downloaded') return;
  if (!app.isPackaged || !autoUpdater.isUpdaterActive()) return;
  autoUpdater.quitAndInstall(false, true);
}

/** Release notes for the announced version, fetched on demand. */
export async function fetchReleaseNotes(): Promise<string | null> {
  if (state.phase !== 'available') return null;
  // The check result usually carries the notes already (GitHub API provider
  // and mock); the network round-trip below only happens as a fallback.
  if (state.notes) return state.notes;
  const version = state.version;
  const cached = notesCache.get(version);
  if (cached) return cached;
  try {
    const release = await fetchJson(`${RELEASES_LATEST_URL.replace('/latest', `/tags/v${version}`)}`);
    const body = typeof release.body === 'string' && release.body.trim() ? release.body.trim() : null;
    if (body) notesCache.set(version, body);
    return body;
  } catch {
    return null;
  }
}

/** Opens the GitHub release page in the default browser. */
export function openReleasePage(): void {
  const url = state.phase === 'available' ? state.htmlUrl : RELEASE_PAGE_URL;
  void shell.openExternal(url);
}

export function getUpdateState(): UpdateState {
  return state;
}

export function getUpdateInfo(): UpdateInfoMsg {
  return updateInfo();
}

/** QA-only: re-point the mock scenario mid-session (smoke harness). */
function setMockScenario(scenario: string): void {
  if (process.env.NOCK_UPDATE_MOCK) process.env.NOCK_UPDATE_MOCK = scenario;
}

export function initUpdater(): void {
  wireElectronUpdater();
  registerUpdateIpc();
  // Quiet start-of-session check. Delayed so the app is fully interactive
  // first, and skipped entirely in dev so `npm start` never talks to the
  // release feed or the updater unless the user explicitly asks.
  if (!app.isPackaged && !process.env.NOCK_UPDATE_MOCK) return;
  if (autoCheckScheduled) return;
  autoCheckScheduled = true;
  setTimeout(() => {
    autoCheckScheduled = false;
    const settings: Settings = getSettings();
    if (!settings.autoCheckUpdates) return;
    if (checkedThisSession) return;
    void runCheck();
  }, AUTO_CHECK_DELAY_MS);
}

function registerUpdateIpc(): void {
  const handle = (channel: string, fn: (...args: unknown[]) => unknown): void => {
    ipcMain.handle(channel, async (_event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => {
      try {
        return { ok: true, data: await fn(...args) };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    });
  };

  handle('updates:get-state', () => getUpdateState());
  handle('updates:get-info', () => getUpdateInfo());
  handle('updates:check', () => {
    checkedThisSession = true;
    checkForUpdates();
    return null;
  });
  handle('updates:download', () => {
    downloadUpdate();
    return null;
  });
  handle('updates:install', () => {
    installUpdate();
    return null;
  });
  handle('updates:notes', async () => fetchReleaseNotes());
  handle('updates:open-release', () => {
    openReleasePage();
    return null;
  });
  // Mock control is only exposed while a mock scenario is armed (dev/QA).
  if (process.env.NOCK_UPDATE_MOCK) {
    handle('updates:mock-set', (...args: unknown[]) => {
      setMockScenario(String(args[0] ?? ''));
      return null;
    });
  }
}