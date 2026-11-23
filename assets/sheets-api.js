/* Google Sheets is the only persistent storage for learning progress.
   OAuth tokens and progress are kept in RAM only, never localStorage/IndexedDB/cookies.
   Requires https://accounts.google.com/gsi/client and Google Sheets API v4. */
(() => {
  'use strict';
  const HEADERS = ['type', 'id', 'course', 'title', 'status', 'updated_at', 'html_path'];
  const TAB = 'Progress';
  const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
  const DEFAULT_CONFIG = { clientId: '', spreadsheetId: '' };

  class GoogleSheetsStore {
    constructor(config, data, hooks = {}) {
      this.config = { ...DEFAULT_CONFIG, ...config };
      this.data = data;
      this.hooks = hooks;
      this.token = null;
      this.expiresAt = 0;
      this.client = null;
      this.rowsById = new Map();
      this.connected = false;
    }
    get configured() {
      return /^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(this.config.clientId || '') &&
        /^[A-Za-z0-9_-]{15,}$/.test(this.config.spreadsheetId || '') &&
        !this.config.clientId.startsWith('REPLACE_') && !this.config.spreadsheetId.startsWith('REPLACE_');
    }
    get sheetUrl() {
      return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(this.config.spreadsheetId)}/edit`;
    }
    notify(type, value) {
      if (typeof this.hooks[type] === 'function') this.hooks[type](value);
    }
    connect() {
      if (!this.configured) {
        this.notify('onError', 'Please set clientId and spreadsheetId in assets/config.js.');
        return;
      }
      if (!window.google?.accounts?.oauth2?.initTokenClient) {
        this.notify('onError', 'Google login is not available. Check internet access and browser extensions.');
        return;
      }
      if (!this.client) {
        this.client = google.accounts.oauth2.initTokenClient({
          client_id: this.config.clientId,
          scope: SCOPE,
          callback: async response => {
            if (!response || response.error || !response.access_token) {
              this.notify('onError', response?.error_description || response?.error || 'Google authorization failed.');
              return;
            }
            this.token = response.access_token;
            this.expiresAt = Date.now() + Math.max(0, Number(response.expires_in || 3600) - 30) * 1000;
            await this.refresh();
          },
          error_callback: error => this.notify('onError', error?.type || 'Google login popup was closed or blocked.')
        });
      }
      try {
        // Must be called synchronously as a result of a real click (popup blockers).
        this.client.requestAccessToken({ prompt: 'select_account' });
      } catch (error) {
        this.notify('onError', error.message);
      }
    }
    async request(path, method = 'GET', body = null) {
      if (!this.token || Date.now() > this.expiresAt) {
        this.connected = false;
        throw new Error('Google authorization expired. Please connect again.');
      }
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(this.config.spreadsheetId)}${path}`;
      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        cache: 'no-store'
      });
      let result;
      try { result = await response.json(); }
      catch (_) { result = {}; }
      if (!response.ok) {
        if (response.status === 401) {
          this.token = null;
          this.connected = false;
        }
        const detail = result?.error?.message || response.statusText || 'Google Sheets API error';
        throw new Error(`Google Sheets (${response.status}): ${detail}`);
      }
      return result;
    }
    range(name) { return '/' + 'values/' + encodeURIComponent(`'${TAB}'!${name}`); }
    catalogRows() {
      const lessonRows = this.data.lessons.map(l => ['lesson', l.id, l.courseId, l.title, 'todo', '', '']);
      const exerciseRows = this.data.exercises.map(e => ['exercise', e.id, e.courseId, e.title, 'todo', '', e.path]);
      return [...lessonRows, ...exerciseRows];
    }
    async ensureProgressTab() {
      const meta = await this.request('?fields=spreadsheetId,sheets.properties.title');
      const found = (meta.sheets || []).some(sheet => sheet.properties?.title === TAB);
      if (!found) {
        await this.request(':batchUpdate', 'POST', {
          requests: [{ addSheet: { properties: { title: TAB, gridProperties: { rowCount: 1000, columnCount: 7 } } } }]
        });
      }
    }
    async readRows() {
      const result = await this.request(this.range('A1:G') + '?valueRenderOption=FORMATTED_VALUE');
      return result.values || [];
    }
    async initialize() {
      const all = [HEADERS, ...this.catalogRows()];
      await this.request(this.range(`A1:G${all.length}`) + '?valueInputOption=RAW', 'PUT', { values: all });
    }
    async refresh() {
      if (!this.token) {
        this.notify('onError', 'Connect your Google account first.');
        return;
      }
      this.notify('onBusy', true);
      try {
        await this.ensureProgressTab();
        let rows = await this.readRows();
        if (rows.length === 0) {
          await this.initialize();
          rows = await this.readRows();
        }
        if (HEADERS.some((value, index) => rows[0]?.[index] !== value)) {
          throw new Error(`The ${TAB} tab already contains unrelated data. Please rename that tab before connecting.`);
        }
        const expected = this.catalogRows();
        const expectedMap = new Map(expected.map(row => [row[1], row]));
        const availableIds = new Set();
        for (const row of rows.slice(1)) if (expectedMap.has(row[1])) availableIds.add(row[1]);
        const missing = expected.filter(row => !availableIds.has(row[1]));
        if (missing.length) {
          await this.request(this.range('A:G') + ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS', 'POST', { values: missing });
          rows = await this.readRows();
        }
        const next = { lessons: {}, exercises: {} };
        const newIndex = new Map();
        rows.slice(1).forEach((row, index) => {
          const [type, id, , , status, updatedAt] = row;
          if (!expectedMap.has(id) || newIndex.has(id)) return;
          newIndex.set(id, index + 2);
          if (type === 'lesson' && ['todo', 'doing', 'done'].includes(status)) {
            next.lessons[id] = { status, updatedAt: updatedAt || null };
          } else if (type === 'exercise') {
            next.exercises[id] = { completed: status === 'done', updatedAt: updatedAt || null };
          }
        });
        this.rowsById = newIndex;
        this.connected = true;
        this.notify('onReady', next);
      } catch (error) {
        this.connected = false;
        this.notify('onError', error.message);
      } finally {
        this.notify('onBusy', false);
      }
    }
    async setStatus(type, id, status) {
      if (!this.connected) throw new Error('Connect Google Sheets before saving.');
      const row = this.rowsById.get(id);
      if (!row) throw new Error('The item is missing from Google Sheets. Refresh to synchronize.');
      if (type === 'lesson' ? !['todo', 'doing', 'done'].includes(status) : !['todo', 'done'].includes(status)) {
        throw new Error('Invalid progress status.');
      }
      const updatedAt = new Date().toISOString();
      await this.request(this.range(`E${row}:F${row}`) + '?valueInputOption=RAW', 'PUT', { values: [[status, updatedAt]] });
      return { updatedAt };
    }
    disconnect() {
      if (this.token && window.google?.accounts?.oauth2?.revoke) {
        try { google.accounts.oauth2.revoke(this.token, () => {}); } catch (_) { /* not fatal */ }
      }
      this.token = null;
      this.expiresAt = 0;
      this.connected = false;
      this.rowsById.clear();
      this.notify('onDisconnected');
    }
  }
  window.GoogleSheetsStore = GoogleSheetsStore;
})();
