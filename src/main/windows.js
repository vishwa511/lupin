'use strict';

const path = require('node:path');
const { BrowserWindow, screen } = require('electron');

const OVERLAY_WIDTH = 220;
const OVERLAY_HEIGHT = 48;
const OVERLAY_BOTTOM_MARGIN = 80;
const ERROR_VISIBLE_MS = 4000;

const rendererFile = (name) => path.join(__dirname, '..', 'renderer', name);
const preloadFile = (name) => path.join(__dirname, '..', 'preload', name);

/** Hidden window that owns the microphone (getUserMedia needs a renderer). */
function createRecorderWindow() {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: preloadFile('recorder.js'),
      contextIsolation: true,
      sandbox: true,
      // Hidden windows are throttled by default, which starves audio processing.
      backgroundThrottling: false,
    },
  });
  win.loadFile(rendererFile('recorder.html'));
  return win;
}

/** Small always-on-top pill that never takes focus, so the paste lands in the user's app. */
function createOverlay() {
  const win = new BrowserWindow({
    width: OVERLAY_WIDTH,
    height: OVERLAY_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    type: 'panel',
    webPreferences: { preload: preloadFile('overlay.js'), contextIsolation: true, sandbox: true },
  });
  win.setIgnoreMouseEvents(true);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(rendererFile('overlay.html'));

  let hideTimer = null;

  function position() {
    const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    win.setBounds({
      x: Math.round(workArea.x + (workArea.width - OVERLAY_WIDTH) / 2),
      y: Math.round(workArea.y + workArea.height - OVERLAY_HEIGHT - OVERLAY_BOTTOM_MARGIN),
      width: OVERLAY_WIDTH,
      height: OVERLAY_HEIGHT,
    });
  }

  function show(status, detail) {
    clearTimeout(hideTimer);
    if (win.isDestroyed()) {
      return;
    }
    if (status === 'idle') {
      win.hide();
      return;
    }
    win.webContents.send('overlay:status', status, detail ?? null);
    if (!win.isVisible()) {
      position();
      win.showInactive();
    }
    if (status === 'error') {
      hideTimer = setTimeout(() => win.hide(), ERROR_VISIBLE_MS);
    }
  }

  return { window: win, show };
}

module.exports = { createOverlay, createRecorderWindow };
