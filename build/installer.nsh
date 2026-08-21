!macro customUnInit
  ${ifNot} ${Silent}
    ${ifNot} ${isUpdated}
      MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION|MB_DEFBUTTON2|MB_SETFOREGROUND "Uninstall Nock?$\r$\n$\r$\nThis will remove Nock and permanently delete all locally stored notes, screenshots and settings from this PC.$\r$\nThis cannot be undone.$\r$\n$\r$\nClick 'OK' to uninstall, or 'Cancel' to keep Nock and your data." IDOK +2
      Quit
    ${endif}
  ${endif}
!macroend