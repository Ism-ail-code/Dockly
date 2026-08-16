import { useEffect } from 'react';
import { Download, RefreshCw, Sparkles, X } from 'lucide-react';
import { useApp } from '@/app/store';

const NOTES_FALLBACK = 'New version available. See the release page for details.';

/**
 * Update surface: a small non-blocking notification (shown once per version
 * per session), the "What's New" notes modal and the restart-to-install
 * prompt. All of it lives in the main window; Settings → Updates shows the
 * same state.
 */
export function UpdateUI() {
  const updateState = useApp((s) => s.updateState);
  const updateInfo = useApp((s) => s.updateInfo);
  const updateNotes = useApp((s) => s.updateNotes);
  const updateNotifiedVersion = useApp((s) => s.updateNotifiedVersion);
  const updateNotesOpen = useApp((s) => s.updateNotesOpen);
  const updateInstallPrompt = useApp((s) => s.updateInstallPrompt);
  const dismissUpdate = useApp((s) => s.dismissUpdate);
  const downloadUpdate = useApp((s) => s.downloadUpdate);
  const installUpdate = useApp((s) => s.installUpdate);
  const openReleasePage = useApp((s) => s.openReleasePage);
  const openUpdateNotes = useApp((s) => s.openUpdateNotes);
  const closeUpdateNotes = useApp((s) => s.closeUpdateNotes);
  const setUpdateInstallPrompt = useApp((s) => s.setUpdateInstallPrompt);

  // Once the download finishes, ask to restart — a single prompt, no nagging.
  useEffect(() => {
    if (updateState.phase === 'downloaded' && updateInfo?.installSupported) {
      setUpdateInstallPrompt(true);
    }
  }, [updateState.phase, updateInfo?.installSupported, setUpdateInstallPrompt]);

  const canInstall = updateInfo?.installSupported === true;

  const updateNow = () => {
    if (updateState.phase === 'available') {
      if (canInstall) void downloadUpdate();
      else void openReleasePage();
    }
  };

  const visible =
    updateState.phase === 'available' &&
    updateNotifiedVersion !== updateState.version &&
    !updateNotesOpen &&
    !updateInstallPrompt;

  const status =
    updateState.phase === 'downloading'
      ? `Downloading update… ${updateState.percent}%`
      : updateState.phase === 'downloaded'
        ? 'Update ready to install'
        : `Nock ${updateState.phase === 'available' ? updateState.version : ''} is available`;

  return (
    <>
      {visible && (
        <div className="update-notice" role="status" aria-live="polite">
          <div className="update-notice-head">
            <div className="update-notice-icon">
              <Download size={14} />
            </div>
            <div className="update-notice-title">{status}</div>
            <button className="btn btn-icon btn-ghost sm" onClick={dismissUpdate} data-tooltip="Remind me later" aria-label="Remind me later">
              <X size={13} />
            </button>
          </div>
          <div className="update-notice-sub">We've made improvements and fixed some issues.</div>
          <div className="update-notice-actions">
            <button className="btn sm" onClick={() => void openUpdateNotes()} data-tooltip="See what changed in this release">
              <Sparkles size={13} />
              What's New
            </button>
            <button className="btn btn-primary sm" onClick={updateNow} data-tooltip={canInstall ? 'Download and install the update' : 'Open the release page to download'}>
              <Download size={13} />
              Update Now
            </button>
            <button className="btn sm" onClick={dismissUpdate} data-tooltip="Not now — remind me later">
              Later
            </button>
          </div>
        </div>
      )}

      {updateNotesOpen && updateState.phase === 'available' && (
        <div className="modal-backdrop" onClick={closeUpdateNotes}>
          <div className="modal" style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div className="modal-title">Nock {updateState.version}</div>
              <button className="btn btn-icon btn-ghost sm" onClick={closeUpdateNotes} data-tooltip="Close" aria-label="Close">
                <X size={14} />
              </button>
            </div>
            <div className="modal-body">
              <div className="update-notes-title">What's new</div>
              <pre className="update-notes">{updateNotes ?? NOTES_FALLBACK}</pre>
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={closeUpdateNotes} data-tooltip="Keep this version for now">
                Close
              </button>
              <button className="btn btn-primary" onClick={updateNow} data-tooltip={canInstall ? 'Download and install the update' : 'Open the release page to download'}>
                <Download size={14} />
                Update Now
              </button>
            </div>
          </div>
        </div>
      )}

      {updateInstallPrompt && updateState.phase === 'downloaded' && (
        <div className="modal-backdrop" onClick={() => setUpdateInstallPrompt(false)}>
          <div className="modal" style={{ width: 380 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div className="modal-title">Restart to install Nock {updateState.version}?</div>
            </div>
            <div className="modal-body">
              <p className="t-sub">
                Your notes, subjects and preferences stay untouched — only the app files are replaced.
              </p>
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={() => setUpdateInstallPrompt(false)} data-tooltip="Install next time Nock quits">
                Later
              </button>
              <button className="btn btn-primary" onClick={installUpdate} data-tooltip="Restart Nock and finish installing">
                <RefreshCw size={14} />
                Restart now
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}