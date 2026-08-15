/**
 * Clipboard change notifier worker.
 *
 * Runs in a dedicated worker thread. Registers a hidden message-only window
 * with the Windows clipboard-change notification API (AddClipboardFormatListener
 * / WM_CLIPBOARDUPDATE) and pumps messages with a blocking GetMessageW loop —
 * zero polling, zero CPU when idle. Every clipboard change is reported to the
 * main process via a single { type: 'change' } message.
 *
 * Requires the `koffi` FFI module (N-API, loads in Electron without rebuild).
 */
import { parentPort } from 'node:worker_threads';

const WM_CLIPBOARDUPDATE = 0x031d;
const HWND_MESSAGE = -3n;

function main(): void {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const koffi = require('koffi');
  const user32 = koffi.load('user32.dll');
  const kernel32 = koffi.load('kernel32.dll');

  const WndProc = koffi.proto(
    'intptr_t __stdcall WndProc(void *hwnd, uint32_t msg, intptr_t wParam, intptr_t lParam)',
  );

  const WNDCLASSEXW = koffi.struct('WNDCLASSEXW', {
    cbSize: 'uint32_t',
    style: 'uint32_t',
    lpfnWndProc: koffi.pointer(WndProc),
    cbClsExtra: 'int',
    cbWndExtra: 'int',
    hInstance: 'void *',
    hIcon: 'void *',
    hCursor: 'void *',
    hbrBackground: 'void *',
    lpszMenuName: 'str16',
    lpszClassName: 'str16',
    hIconSm: 'void *',
  });

  const MSG = koffi.struct('MSG', {
    hwnd: 'void *',
    message: 'uint32_t',
    wParam: 'intptr_t',
    lParam: 'intptr_t',
    time: 'uint32_t',
    pt_x: 'int',
    pt_y: 'int',
  });

  const RegisterClassExW = user32.func('uint16_t RegisterClassExW(const WNDCLASSEXW *cls)');
  const CreateWindowExW = user32.func(
    'void * CreateWindowExW(uint32_t exstyle, str16 cls, str16 name, uint32_t style, int x, int y, int w, int h, void *parent, void *menu, void *inst, void *param)',
  );
  const AddClipboardFormatListener = user32.func('int AddClipboardFormatListener(void *hwnd)');
  const RemoveClipboardFormatListener = user32.func('int RemoveClipboardFormatListener(void *hwnd)');
  const DefWindowProcW = user32.func(
    'intptr_t DefWindowProcW(void *hwnd, uint32_t msg, intptr_t wParam, intptr_t lParam)',
  );
  const GetMessageW = user32.func(
    'int GetMessageW(_Out_ MSG *lpMsg, void *hWnd, uint32_t wMsgFilterMin, uint32_t wMsgFilterMax)',
  );
  const DispatchMessageW = user32.func('intptr_t DispatchMessageW(const MSG *lpMsg)');
  const GetCurrentThreadId = kernel32.func('uint32_t GetCurrentThreadId()');

  const wndProc = koffi.register(
    (hwnd: unknown, msg: number, wParam: unknown, lParam: unknown) => {
      if (msg === WM_CLIPBOARDUPDATE) parentPort?.postMessage({ type: 'change' });
      return DefWindowProcW(hwnd, msg, wParam, lParam);
    },
    koffi.pointer(WndProc),
  );

  const atom = RegisterClassExW(
    koffi.as(
      {
        cbSize: koffi.sizeof(WNDCLASSEXW),
        style: 0,
        lpfnWndProc: wndProc,
        cbClsExtra: 0,
        cbWndExtra: 0,
        hInstance: 0n,
        hIcon: 0n,
        hCursor: 0n,
        hbrBackground: 0n,
        lpszMenuName: null,
        lpszClassName: 'NockClipWatcher',
        hIconSm: 0n,
      },
      'WNDCLASSEXW *',
    ),
  );
  if (!atom) throw new Error('RegisterClassExW failed: ' + koffi.errno());

  const hwnd = CreateWindowExW(0, 'NockClipWatcher', null, 0, 0, 0, 0, 0, HWND_MESSAGE, 0n, 0n, 0n);
  if (!hwnd) throw new Error('CreateWindowExW failed: ' + koffi.errno());
  if (!AddClipboardFormatListener(hwnd)) {
    throw new Error('AddClipboardFormatListener failed: ' + koffi.errno());
  }

  // Expose the thread id so the main process can post WM_QUIT to unblock
  // this thread on shutdown (worker.terminate() cannot interrupt a thread
  // blocked inside the GetMessageW native call).
  parentPort?.postMessage({ type: 'ready', threadId: GetCurrentThreadId() });

  // Blocking message pump. GetMessageW sleeps the thread until a message is
  // posted (WM_CLIPBOARDUPDATE on clipboard change, WM_QUIT on shutdown), so
  // the worker consumes no CPU while idle.
  const msg = koffi.alloc(MSG, 1);
  for (;;) {
    const r = GetMessageW(msg, 0n, 0, 0);
    if (r === 0 || r === -1) break;
    DispatchMessageW(msg);
  }

  RemoveClipboardFormatListener(hwnd);
  koffi.unregister(wndProc);
  parentPort?.postMessage({ type: 'exiting' });
}

try {
  main();
} catch (e) {
  parentPort?.postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) });
}
