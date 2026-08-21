!macro customUnInit
  ${ifNot} ${Silent}
    ${ifNot} ${isUpdated}
      MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION|MB_DEFBUTTON2|MB_SETFOREGROUND "Uninstall Nock?$\r$\n$\r$\nThis will remove Nock and permanently delete all locally stored notes, screenshots and settings from this PC.$\r$\nThis cannot be undone.$\r$\n$\r$\nClick 'OK' to uninstall, or 'Cancel' to keep Nock and your data." IDOK +2
      Quit
    ${endif}
  ${endif}
!macroend

!macro customUnInstall
  # Nock can register an autostart entry (Settings → Launch Nock on startup)
  # via Electron's app.setLoginItemSettings, which writes the Windows Run key.
  # That registry value is not covered by deleteAppDataOnUninstall and would
  # otherwise survive uninstall — remove every Nock spelling here.
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Nock"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "nock"
!macroend
