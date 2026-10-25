'use strict';

const path = require('node:path');
const {
  app, clipboard, ClipboardItem, ipcMain, Menu, nativeImage, session, shell, systemPreferences, Tray,
} = require('electron');
const { createDictationController } = require('./dictation');
const { createFnHelper } = require('./fnHelper');
const { createRecorderBridge } = require('./recorderBridge');
const { createTextInserter } = require('./textInserter');
const { createTranscriber } = require('./whisper');
const { createOverlay, createRecorderWindow } = require('./windows');

const ACCESSIBILITY_SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility';
const MICROPHONE_SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone';

// Packaged builds ship the helper and model in Contents/Resources (see "extraResources").
const resourceRoot = app.isPackaged ? process.resourcesPath : app.getAppPath();
const modelPath = process.env.LUPINE_MODEL ?? path.join(resourceRoot, 'models', 'ggml-base.en.bin');
const helperPath = path.join(resourceRoot, 'bin', 'lupine-fn-helper');

const status = { accessibility: false, microphone: 'unknown', helperReady: false, lastError: null };
let tray = null;
let helper = null;

function refreshTray() {
  const lines = [
    { label: status.helperReady ? 'Hold Fn to dictate' : 'Waiting for Accessibility permission…', enabled: false },
    { label: `Microphone: ${status.microphone}`, enabled: false },
    ...(status.lastError ? [{ label: `Last error: ${status.lastError.slice(0, 60)}`, enabled: false }] : []),
    { type: 'separator' },
    { label: 'Open Accessibility Settings…', click: () => shell.openExternal(ACCESSIBILITY_SETTINGS_URL) },
    { label: 'Open Microphone Settings…', click: () => shell.openExternal(MICROPHONE_SETTINGS_URL) },
    { type: 'separator' },
    { label: 'Quit Lupine', role: 'quit' },
  ];
  tray?.setContextMenu(Menu.buildFromTemplate(lines));
}

function allowOnlyOwnMicrophoneRequests() {
  const isOwnPage = (url) => url.startsWith('file://');
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === 'media' && isOwnPage(webContents.getURL()));
  });
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => (
    permission === 'media' && isOwnPage(webContents?.getURL() ?? '')
  ));
}

async function ensureMicrophoneAccess() {
  const granted = await systemPreferences.askForMediaAccess('microphone');
  status.microphone = granted ? 'allowed' : 'denied';
  refreshTray();
}

function start() {
  app.dock?.hide();
  allowOnlyOwnMicrophoneRequests();

  // createFromPath also picks up tray@2x.png for Retina menu bars.
  const trayImage = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'assets', 'tray.png'));
  tray = new Tray(trayImage);
  if (trayImage.isEmpty()) {
    tray.setTitle('✿');
  }
  tray.setToolTip('Lupine — hold Fn to dictate');
  refreshTray();

  const recorderWindow = createRecorderWindow();
  const overlay = createOverlay();
  helper = createFnHelper({ binaryPath: helperPath });

  const controller = createDictationController({
    recorder: createRecorderBridge({ ipcMain, getWebContents: () => recorderWindow.webContents }),
    transcribe: createTranscriber({ modelPath }),
    insertText: createTextInserter({ clipboard, ClipboardItem, paste: () => helper.paste() }),
    showStatus: (state, detail) => {
      if (state === 'error') {
        status.lastError = detail;
        refreshTray();
      }
      overlay.show(state, detail);
    },
  });

  helper.events.on('fn', (isDown) => (isDown ? controller.fnDown() : controller.fnUp()));
  helper.events.on('chord', () => controller.cancel());
  helper.events.on('permission', (granted) => {
    status.accessibility = granted;
    refreshTray();
  });
  helper.events.on('ready', () => {
    status.helperReady = true;
    refreshTray();
  });
  helper.events.on('error', (message) => {
    console.error('[Lupine] helper:', message);
    status.lastError = message;
    refreshTray();
  });
  helper.start();

  ensureMicrophoneAccess().catch((error) => console.error('[Lupine] microphone access', error));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(start);
  app.on('window-all-closed', (event) => event.preventDefault());
  app.on('before-quit', () => helper?.stop());
}
