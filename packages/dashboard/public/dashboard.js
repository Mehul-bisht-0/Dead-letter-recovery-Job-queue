'use strict';
let stream;
const login = document.getElementById('login');
const content = document.getElementById('dashboard');
const status = document.getElementById('status');
const csrf = () =>
  document.cookie
    .split('; ')
    .find((item) => item.startsWith('rq_csrf='))
    ?.split('=')[1] ?? '';
async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf(), ...options.headers },
  });
  if (response.status === 401) {
    showLogin();
    throw new Error('Login required');
  }
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? 'Request failed');
  return body;
}
function showLogin() {
  stream?.close();
  login.hidden = false;
  content.hidden = true;
}
function cell(row, value) {
  const td = document.createElement('td');
  td.textContent = String(value ?? '');
  row.append(td);
  return td;
}
function empty(tbody, columns, message) {
  const row = document.createElement('tr');
  const td = cell(row, message);
  td.colSpan = columns;
  tbody.append(row);
}
function renderMetrics(data) {
  for (const id of ['queueDepth', 'jobsPerSecond', 'retryRate', 'dlqSize'])
    document.getElementById(id).textContent = String(data[id]);
  const tbody = document.querySelector('#workersTable tbody');
  tbody.replaceChildren();
  if (!data.workers.length) empty(tbody, 4, 'No workers found');
  for (const worker of data.workers) {
    const row = document.createElement('tr');
    cell(row, worker.id);
    cell(row, worker.status);
    cell(row, worker.jobsInFlight);
    cell(row, new Date(worker.lastSeen).toLocaleTimeString());
    tbody.append(row);
  }
}
async function loadDLQ() {
  try {
    const data = await request('/api/dlq');
    const tbody = document.querySelector('#dlqTable tbody');
    tbody.replaceChildren();
    if (!data.items.length) empty(tbody, 5, 'DLQ is empty');
    for (const item of data.items) {
      const row = document.createElement('tr');
      cell(row, item.original_job_id);
      cell(row, item.queue_name);
      cell(row, item.failure_reason);
      cell(row, new Date(item.moved_at).toLocaleString());
      const button = document.createElement('button');
      button.textContent = 'Replay';
      cell(row, '').append(button);
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          await request(`/api/dlq/${item.id}/replay`, { method: 'POST' });
          await loadDLQ();
        } catch (error) {
          status.textContent = error.message;
          button.disabled = false;
        }
      });
      tbody.append(row);
    }
  } catch (error) {
    status.textContent = error.message;
  }
}
async function start() {
  await request('/api/auth/session');
  login.hidden = true;
  content.hidden = false;
  stream?.close();
  stream = new EventSource('/api/metrics/stream');
  stream.onopen = () => {
    status.textContent = 'Live';
  };
  stream.onerror = () => {
    status.textContent = 'Disconnected — retrying';
    void request('/api/auth/session').catch(() => {});
  };
  stream.onmessage = (event) => renderMetrics(JSON.parse(event.data));
  await loadDLQ();
}
document.getElementById('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  try {
    await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: form.get('username'), password: form.get('password') }),
    });
    event.target.reset();
    await start();
  } catch (error) {
    document.getElementById('login-error').textContent = error.message;
  }
});
document.getElementById('logout').addEventListener('click', async () => {
  await request('/api/auth/logout', { method: 'POST' });
  showLogin();
});
void start().catch(() => showLogin());
setInterval(() => {
  if (!content.hidden) void loadDLQ();
}, 10000);
window.addEventListener('beforeunload', () => stream?.close());
