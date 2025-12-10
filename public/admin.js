const statusEl = document.getElementById('status');
const usersCountEl = document.getElementById('users-count');
const pdfStatusEl = document.getElementById('pdf-status');
const snapshotEl = document.getElementById('snapshot');

function setStatus(msg) { statusEl.textContent = msg; }
function setPdfStatus(msg) { pdfStatusEl.textContent = msg; }

async function fetchJSON(url, options = {}) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

async function loadSnapshot() {
  try {
    const health = await fetchJSON('/api/health');
    const dashboard = await fetchJSON('/api/dashboard');
    snapshotEl.textContent = JSON.stringify({ health, sampleArticle: dashboard.articles[0] }, null, 2);
    usersCountEl.textContent = `Users: ${health.counts.users}`;
    setStatus('Online');
  } catch (err) {
    setStatus('Offline');
    snapshotEl.textContent = err.message;
  }
}

// User form
const userForm = document.getElementById('user-form');
userForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(userForm).entries());
  try {
    await fetchJSON('/api/users', { method: 'POST', body: JSON.stringify(data) });
    setStatus('User registered');
    userForm.reset();
    loadSnapshot();
  } catch (err) {
    setStatus(err.message);
  }
});

// Notification form
const notifyForm = document.getElementById('notify-form');
notifyForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(notifyForm).entries());
  try {
    await fetchJSON('/api/notifications', { method: 'POST', body: JSON.stringify(data) });
    setStatus('Notification created');
    notifyForm.reset();
    loadSnapshot();
  } catch (err) {
    setStatus(err.message);
  }
});

// Content form
const contentForm = document.getElementById('content-form');
contentForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(contentForm).entries());
  try {
    await fetchJSON('/api/content', { method: 'POST', body: JSON.stringify(data) });
    setStatus('Content added');
    contentForm.reset();
    loadSnapshot();
  } catch (err) {
    setStatus(err.message);
  }
});

// PDF upload
const pdfForm = document.getElementById('pdf-form');
pdfForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const file = pdfForm.pdf.files[0];
  if (!file) return setPdfStatus('Select a PDF first');
  setPdfStatus('Uploading...');
  const base64 = await toBase64(file);
  const payload = { fileName: file.name, data: base64 };
  try {
    const result = await fetchJSON('/api/upload/pdf', { method: 'POST', body: JSON.stringify(payload) });
    setPdfStatus(result.message || 'Uploaded');
    loadSnapshot();
  } catch (err) {
    setPdfStatus(err.message);
  }
});

function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

loadSnapshot();
