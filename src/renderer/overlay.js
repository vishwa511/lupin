'use strict';

const LABELS = {
  listening: 'Listening…',
  transcribing: 'Transcribing…',
};

const pill = document.querySelector('.pill');
const label = document.querySelector('.label');

window.lupineOverlay.onStatus((status, detail) => {
  pill.dataset.status = status;
  label.textContent = status === 'error' ? (detail || 'Something went wrong') : (LABELS[status] ?? status);
  label.title = label.textContent;
});
