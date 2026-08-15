# Nock clipboard-change watcher (fallback when the koffi FFI module cannot be used).
#
# Event-driven: hosts a hidden WinForms form that calls AddClipboardFormatListener
# (WM_CLIPBOARDUPDATE) and prints a single 'CHANGE' line to stdout on every
# clipboard change. No polling. Killed by the parent app on shutdown.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;
public sealed class NockClipWatcher : Form {
    [DllImport("user32.dll")]
    private static extern bool AddClipboardFormatListener(IntPtr hwnd);
    [DllImport("user32.dll")]
    private static extern bool RemoveClipboardFormatListener(IntPtr hwnd);
    public event EventHandler Changed;
    protected override void WndProc(ref Message m) {
        if (m.Msg == 0x031D) {
            EventHandler h = Changed;
            if (h != null) h(this, EventArgs.Empty);
        }
        base.WndProc(ref m);
    }
    protected override void OnHandleCreated(EventArgs e) {
        base.OnHandleCreated(e);
        AddClipboardFormatListener(this.Handle);
    }
    protected override void OnHandleDestroyed(EventArgs e) {
        RemoveClipboardFormatListener(this.Handle);
        base.OnHandleDestroyed(e);
    }
}
'@ -ReferencedAssemblies System.Windows.Forms

$watcher = New-Object NockClipWatcher
$script:changed = {
    [Console]::Out.WriteLine('CHANGE')
    [Console]::Out.Flush()
}
$watcher.Add_Changed($script:changed)
[System.Windows.Forms.Application]::Run($watcher)
