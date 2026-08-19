!macro customUnInstall
  # Nock can register an autostart entry (Settings → Launch Nock on startup)
  # via Electron's app.setLoginItemSettings, which writes the Windows Run key.
  # That registry value is not covered by deleteAppDataOnUninstall and would
  # otherwise survive uninstall — remove every Nock spelling here.
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Nock"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "nock"
!macroend