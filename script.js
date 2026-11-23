(() => {
  'use strict';

  /* ---------- Config ---------- */
  const PROGRESS_KEY = 'bookLibrary.progress.v1'; // your bookmarks and last pages

  /* ---------- Helpers ---------- */
  const $ = (sel) => document.querySelector(sel);
  const el = {
    shelves: $('#shelves'), syncInfo: $('#syncInfo'),
    search: $('#search'), viewFilter: $('#viewFilter'),
    results: $('#results'), list: $('#list'), empty: $('#empty'),
    stats: $('#stats'), toast: $('#toast'),
  };

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const readJson = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  };
  const writeJson = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch { toast('Could not save. Your browser may be blocking local storage.'); }
  };

  let toastTimer;
  function toast(message) {
    el.toast.textContent = message;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), 3200);
  }

  /* ---------- Library from books.js ---------- */
  // The key that saved progress is stored under: the Drive file id when the link has one.
  const keyFor = (link) => {
    const m = link.match(/\/d\/([\w-]+)/) || link.match(/[?&]id=([\w-]+)/);
    return m ? m[1] : link;
  };

  function buildCatalog(list) {
    const seen = new Set();
    const books = [];
    (Array.isArray(list) ? list : []).forEach((item) => {
      const title = String(item?.title || '').trim();
      const link = String(item?.link || '').trim();
      if (!title || !/^https?:\/\//i.test(link)) return; // skip incomplete entries
      const key = keyFor(link);
      if (seen.has(key)) return;
      seen.add(key);
      const parts = String(item.folder || '').split('/').map((p) => p.trim()).filter(Boolean);
      books.push({
        path: key,
        title,
        shelf: parts[0] || 'Library',
        folder: parts.length ? parts.join('/') : 'Library',
        format: String(item.format || '').trim(),
        pages: Math.max(0, parseInt(item.pages, 10) || 0),
        url: link,
      });
    });
    return books.sort((a, b) =>
      a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }));
  }

  /* ---------- State ---------- */
  const catalog = buildCatalog(window.BOOKS);
  const defaultTotals = Object.fromEntries(catalog.map((b) => [b.path, b.pages]));
  let progress = readJson(PROGRESS_KEY, {});      // { [key]: { bookmarked, page, total, finished } }
  const view = { folder: '', query: '', filter: 'All' };

  /* ---------- Reading progress ---------- */
  const getP = (path) => ({ total: defaultTotals[path] || 0, ...(progress[path] || {}) });

  function setP(path, patch) {
    progress[path] = { ...getP(path), ...patch, updatedAt: Date.now() };
    writeJson(PROGRESS_KEY, progress);
  }

  function statusOf(path) {
    const p = getP(path);
    if (p.finished) return 'Completed';
    if (p.page > 0) return 'Reading';
    return 'To Read';
  }

  function progressText(p) {
    if (p.finished) return 'Finished';
    if (!p.page) return 'Not started';
    if (p.total > 0) return `Page ${p.page} of ${p.total} · ${Math.min(100, Math.round((p.page / p.total) * 100))}%`;
    return `Last read: page ${p.page}`;
  }

  const percent = (p) => (p.finished ? 100 : p.total > 0 ? Math.min(100, ((p.page || 0) / p.total) * 100) : 0);

  /* ---------- Filtering ---------- */
  function visibleBooks() {
    const q = view.query.trim().toLowerCase();
    return catalog.filter((b) => {
      if (view.folder && !(b.folder === view.folder || b.folder.startsWith(view.folder + '/'))) return false;
      if (view.filter === 'Bookmarked' && !getP(b.path).bookmarked) return false;
      if (['To Read', 'Reading', 'Completed'].includes(view.filter) && statusOf(b.path) !== view.filter) return false;
      if (q && !`${b.title} ${b.folder}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }

  /* ---------- Rendering ---------- */
  function render() {
    renderStats();
    renderShelves();
    renderList();
  }

  function renderStats() {
    const count = (s) => catalog.filter((b) => statusOf(b.path) === s).length;
    const marked = catalog.filter((b) => getP(b.path).bookmarked).length;
    el.stats.innerHTML = [
      [catalog.length, 'books in library'],
      [marked, 'bookmarked'],
      [count('Reading'), 'in progress'],
      [count('Completed'), 'completed'],
    ].map(([n, label]) => `<div class="stat"><b>${n}</b><span>${label}</span></div>`).join('');
  }

  function renderShelves() {
    const folders = new Set();
    catalog.forEach((b) => {
      const parts = b.folder.split('/');
      for (let i = 1; i <= parts.length; i++) folders.add(parts.slice(0, i).join('/'));
    });
    const count = (f) => catalog.filter((b) => b.folder === f || b.folder.startsWith(f + '/')).length;

    // Show a shelf's subfolders only while that shelf is open.
    const openTop = view.folder.split('/')[0];
    const rows = [...folders]
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
      .filter((f) => !f.includes('/') || f.split('/')[0] === openTop)
      .map((f) => {
        const depth = f.split('/').length - 1;
        const label = f.split('/').pop();
        return `<button class="shelf ${depth ? 'shelf--sub' : 'shelf--top'}" type="button" style="--depth:${depth}"
                  data-folder="${esc(f)}" aria-current="${view.folder === f}">
                  <span>${esc(label)}</span><small>${count(f)}</small></button>`;
      }).join('');

    el.shelves.innerHTML =
      `<button class="shelf shelf--top" type="button" data-folder="" aria-current="${view.folder === ''}">
         <span>All shelves</span><small>${catalog.length}</small></button>` + rows;

    el.syncInfo.textContent = `${catalog.length} book${catalog.length === 1 ? '' : 's'} listed in books.js`;
  }

  function renderList() {
    const items = visibleBooks();
    el.list.innerHTML = items.map(bookHtml).join('');

    const where = view.folder ? view.folder.split('/').join(' › ') : 'all shelves';
    el.results.textContent = catalog.length ? `${items.length} book${items.length === 1 ? '' : 's'} in ${where}` : '';

    let message = '';
    if (!catalog.length) message = 'Your library is empty. Add your books to books.js (title, folder and Drive link), then reload this page.';
    else if (!items.length) message = 'No books match your search or filters.';

    el.empty.hidden = !message;
    el.empty.textContent = message;
  }

  function bookHtml(b) {
    const p = getP(b.path);
    const status = statusOf(b.path);
    return `
      <li class="book" data-path="${esc(b.path)}" data-status="${status}">
        <div class="book__head">
          <h3 class="book__title"><a href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.title)}</a></h3>
          <div class="book__meta">
            ${b.format ? `<span class="chip">${esc(b.format)}</span>` : ''}
            <span class="chip chip--status">${status}</span>
          </div>
        </div>
        <p class="book__path">${esc(b.folder.split('/').join(' › '))}</p>
        <div class="tracker">
          <div class="pages">
            <label for="page-${esc(b.path)}">Last page</label>
            <input id="page-${esc(b.path)}" type="number" min="0" inputmode="numeric" data-field="page" value="${p.page || ''}" placeholder="0">
            <label for="total-${esc(b.path)}">of</label>
            <input id="total-${esc(b.path)}" type="number" min="0" inputmode="numeric" data-field="total" value="${p.total || ''}" placeholder="total">
          </div>
          <div class="progress">
            <div class="bar" aria-hidden="true"><span style="width:${percent(p)}%"></span></div>
            <p class="progress-text">${progressText(p)}</p>
          </div>
          <div class="book__actions">
            <button class="btn btn--outline" type="button" data-action="bookmark" aria-pressed="${!!p.bookmarked}">${p.bookmarked ? 'Bookmarked' : 'Bookmark'}</button>
            <button class="btn btn--outline" type="button" data-action="finish">${p.finished ? 'Reopen' : 'Mark finished'}</button>
            <a class="btn btn--primary" href="${esc(b.url)}" target="_blank" rel="noopener">Open book</a>
          </div>
        </div>
      </li>`;
  }

  /* ---------- Events ---------- */
  el.shelves.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-folder]');
    if (!btn) return;
    view.folder = btn.dataset.folder;
    render();
  });

  el.search.addEventListener('input', () => { view.query = el.search.value; renderList(); });
  el.viewFilter.addEventListener('change', () => { view.filter = el.viewFilter.value; renderList(); });

  el.list.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const path = btn.closest('.book').dataset.path;
    const p = getP(path);

    if (btn.dataset.action === 'bookmark') {
      setP(path, { bookmarked: !p.bookmarked });
      toast(p.bookmarked ? 'Bookmark removed.' : 'Book bookmarked.');
    }
    if (btn.dataset.action === 'finish') {
      setP(path, { finished: !p.finished });
    }
    render();
  });

  // Saving a page number updates this row in place so typing is not interrupted.
  el.list.addEventListener('change', (e) => {
    const field = e.target.dataset.field;
    if (!field) return;
    const li = e.target.closest('.book');
    const path = li.dataset.path;

    let value = Math.max(0, parseInt(e.target.value, 10) || 0);
    const p = getP(path);
    const total = field === 'total' ? value : p.total || 0;
    if (field === 'page' && total && value > total) value = total;

    setP(path, { [field]: value, ...(field === 'page' && value > 0 ? { finished: false } : {}) });
    e.target.value = value || '';

    const updated = getP(path);
    li.dataset.status = statusOf(path);
    li.querySelector('.chip--status').textContent = statusOf(path);
    li.querySelector('.bar > span').style.width = `${percent(updated)}%`;
    li.querySelector('.progress-text').textContent = progressText(updated);
    li.querySelector('[data-action="finish"]').textContent = updated.finished ? 'Reopen' : 'Mark finished';
    renderStats();
    toast(field === 'page' ? `Saved: page ${value}.` : 'Saved.');
  });

  /* ---------- Start ---------- */
  render();
})();
