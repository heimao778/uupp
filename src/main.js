import './style.css';
import {
  MODES,
  MODE_KEYS,
  PERIODS,
  calculate,
  formatMoney,
  summarizeSettings,
  validateSettings,
} from './calc.js';
import {
  addRecord,
  deleteRecord,
  groupRecordsByDate,
  loadRecords,
  loadSettings,
  renameRecord,
  saveSettings,
} from './storage.js';

const app = document.getElementById('app');

const loaded = loadSettings();
const state = {
  settings: loaded.settings,
  isFirstUse: loaded.isFirstUse,
  records: loadRecords(),
  price: '',
  name: '',
  draft: null,
  draftErrors: {},
  editingId: null,
  confirmDeleteId: null,
};

const DISCLAIMERS = {
  labor: '结果按你填写的收入和工作时间估算，不代表购买需要付出的全部时间。',
  living: '天数表示这笔钱相当于多少天的平均预算，并不代表你需要停止消费这么多天。',
  custom: '占比按你设置的预算金额和周期计算，仅供参考。',
};

const FIELD_DEFS = {
  labor: [
    { key: 'monthlyIncome', label: '月收入', unit: '元', show: (s) => s.incomeType !== 'hourly', placeholder: '例如 3300' },
    { key: 'hourlyWage', label: '时薪', unit: '元/小时', show: (s) => s.incomeType === 'hourly', placeholder: '例如 20' },
    { key: 'workDays', label: '每月实际工作天数', unit: '天', placeholder: '例如 22' },
    { key: 'hoursPerDay', label: '每天实际工作小时数', unit: '小时', placeholder: '例如 8' },
  ],
  living: [
    { key: 'monthlyAllowance', label: '每月生活费', unit: '元', placeholder: '例如 1500' },
    { key: 'budgetDays', label: '每月预算天数', unit: '天', placeholder: '例如 30' },
  ],
  custom: [
    { key: 'budget', label: '预算金额', unit: '元', placeholder: '例如 2000' },
    { key: 'customDays', label: '预算天数', unit: '天', show: (s) => s.period === 'custom', placeholder: '例如 45' },
  ],
};

function esc(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function persistSettings() {
  saveSettings(state.settings);
  state.isFirstUse = false;
}

let toastTimer;
function toast(message) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

function navigate(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

/* ---------- Home ---------- */

function modeTabs(active, attr) {
  return `
    <div class="segmented" role="tablist" aria-label="计算模式">
      ${MODE_KEYS.map((k) => `
        <button type="button" role="tab" class="seg-btn${k === active ? ' active' : ''}"
          aria-selected="${k === active}" ${attr}="${k}">${MODES[k].name}</button>`).join('')}
    </div>`;
}

function renderHome() {
  const { mode } = state.settings;
  const summary = summarizeSettings(mode, state.settings[mode]);
  app.innerHTML = `
    <main class="page home">
      <header class="topbar">
        <div>
          <h1 class="brand">时间换算器</h1>
          <p class="tagline">把价格换算成你真正付出的东西</p>
        </div>
        <a class="icon-link" href="#/records" aria-label="消费记录">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h12a1 1 0 0 1 1 1v15l-3-2-3 2-3-2-3 2-2-1.3V5a1 1 0 0 1 1-1Zm2 5h8M8 13h6" /></svg>
          <span>记录${state.records.length ? `<em>${state.records.length}</em>` : ''}</span>
        </a>
      </header>

      ${modeTabs(mode, 'data-mode')}

      <section class="params ${summary ? '' : 'params-empty'}">
        <div class="params-text">
          <span class="params-label">${MODES[mode].name}模式</span>
          <span class="params-value">${summary ? esc(summary) : '还没有设置参数'}</span>
        </div>
        <a class="link-btn" href="#/settings">${summary ? '修改' : '去设置'}</a>
      </section>

      <section class="price-card">
        <label class="price-label" for="price">商品价格</label>
        <div class="price-input">
          <span class="currency" aria-hidden="true">¥</span>
          <input id="price" type="text" inputmode="decimal" autocomplete="off" placeholder="0.00"
            value="${esc(state.price)}" aria-describedby="price-error" ${summary ? '' : 'disabled'} />
        </div>
        <p id="price-error" class="field-error" role="alert"></p>
      </section>

      <section class="result" id="result" aria-live="polite"></section>

      <section class="save-row">
        <input id="item-name" type="text" maxlength="40" placeholder="商品名称（选填）" value="${esc(state.name)}" aria-label="商品名称" />
        <button type="button" id="save-btn" class="btn primary">保存记录</button>
      </section>

      <p class="disclaimer">${DISCLAIMERS[mode]}</p>
    </main>`;

  app.querySelectorAll('[data-mode]').forEach((btn) =>
    btn.addEventListener('click', () => {
      if (state.settings.mode === btn.dataset.mode) return;
      state.settings.mode = btn.dataset.mode;
      persistSettings();
      renderHome();
    }),
  );

  const priceInput = app.querySelector('#price');
  priceInput.addEventListener('input', () => {
    state.price = priceInput.value;
    updateResult();
  });
  app.querySelector('#item-name').addEventListener('input', (e) => {
    state.name = e.target.value;
  });
  app.querySelector('#save-btn').addEventListener('click', saveCurrent);
  updateResult();
}

function updateResult() {
  const { mode } = state.settings;
  const resultEl = app.querySelector('#result');
  const errorEl = app.querySelector('#price-error');
  const saveBtn = app.querySelector('#save-btn');
  const settingsOk = validateSettings(mode, state.settings[mode]).ok;

  errorEl.textContent = '';
  saveBtn.disabled = true;

  if (!settingsOk) {
    resultEl.innerHTML = `
      <div class="result-empty">
        <p>先告诉我们你的${MODES[mode].name}情况，才能换算。</p>
        <a class="btn primary" href="#/settings">设置${MODES[mode].name}参数</a>
      </div>`;
    return;
  }

  if (state.price.trim() === '') {
    resultEl.innerHTML = '<div class="result-empty"><p>输入商品价格，立即看到它对你意味着什么。</p></div>';
    return;
  }

  const r = calculate(mode, state.settings[mode], state.price);
  if (!r.ok) {
    errorEl.textContent = r.error;
    resultEl.innerHTML = '<div class="result-empty muted"><p>请输入正确的价格</p></div>';
    return;
  }

  const res = r.result;
  saveBtn.disabled = false;
  resultEl.innerHTML = `
    <div class="result-card">
      <p class="result-price">商品价格：${formatMoney(r.price)} 元</p>
      <p class="result-label">${res.label}</p>
      <p class="result-value">
        ${res.approx ? '<span class="approx">约</span>' : ''}
        <strong>${esc(res.value)}</strong><span class="unit">${esc(res.unit)}</span>
      </p>
      <ul class="result-details">${res.details.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>
    </div>`;
}

function saveCurrent() {
  const { mode } = state.settings;
  const r = calculate(mode, state.settings[mode], state.price);
  if (!r.ok) {
    toast(r.error);
    return;
  }
  addRecord({
    name: state.name,
    price: r.price,
    mode,
    summary: r.result.summary,
    label: r.result.label,
    value: r.result.value,
    unit: r.result.unit,
  });
  state.records = loadRecords();
  state.name = '';
  toast('已保存到消费记录');
  renderHome();
}

/* ---------- Settings ---------- */

function renderSettings() {
  if (!state.draft) state.draft = clone(state.settings);
  const d = state.draft;
  const mode = d.mode;
  const s = d[mode];
  const errors = state.draftErrors;
  const first = state.isFirstUse;

  const fields = FIELD_DEFS[mode]
    .filter((f) => !f.show || f.show(s))
    .map((f) => `
      <div class="field${errors[f.key] ? ' has-error' : ''}">
        <label for="f-${f.key}">${f.label}</label>
        <div class="input-wrap">
          <input id="f-${f.key}" data-field="${f.key}" type="text" inputmode="decimal" autocomplete="off"
            placeholder="${f.placeholder}" value="${esc(s[f.key])}" aria-invalid="${Boolean(errors[f.key])}"
            aria-describedby="e-${f.key}" />
          <span class="suffix">${f.unit}</span>
        </div>
        <p class="field-error" id="e-${f.key}">${esc(errors[f.key] || '')}</p>
      </div>`)
    .join('');

  let extra = '';
  if (mode === 'labor') {
    extra = `
      <div class="field">
        <span class="field-title">收入填写方式</span>
        <div class="chips" role="radiogroup" aria-label="收入填写方式">
          ${[['monthly', '月收入'], ['hourly', '时薪']].map(([v, l]) => `
            <button type="button" role="radio" class="chip${s.incomeType === v ? ' active' : ''}"
              aria-checked="${s.incomeType === v}" data-income="${v}">${l}</button>`).join('')}
        </div>
      </div>`;
  } else if (mode === 'custom') {
    extra = `
      <div class="field">
        <span class="field-title">预算周期</span>
        <div class="chips" role="radiogroup" aria-label="预算周期">
          ${Object.entries(PERIODS).map(([v, p]) => `
            <button type="button" role="radio" class="chip${s.period === v ? ' active' : ''}"
              aria-checked="${s.period === v}" data-period="${v}">${p.label}</button>`).join('')}
        </div>
      </div>`;
  }

  const disposable = mode === 'living' ? `
    <label class="check">
      <input type="checkbox" id="f-disposable" ${s.isDisposable ? 'checked' : ''} />
      <span>这是扣除房租、话费等固定支出后的<b>可支配生活费</b></span>
    </label>` : '';

  app.innerHTML = `
    <main class="page settings">
      <header class="topbar">
        ${first ? '' : '<a class="back" href="#/" aria-label="返回首页">‹ 返回</a>'}
        <h1 class="page-title">${first ? '欢迎使用时间换算器' : '个人设置'}</h1>
      </header>
      ${first ? '<p class="intro">钱不仅是一个数字。选择最贴近你经济来源的方式，我们帮你把价格换算成你真正付出的东西。</p>' : ''}

      <h2 class="section-title">${first ? '第一步：选择计算方式' : '计算模式'}</h2>
      <div class="mode-cards" role="radiogroup" aria-label="计算模式">
        ${MODE_KEYS.map((k) => `
          <button type="button" role="radio" class="mode-card${k === mode ? ' active' : ''}"
            aria-checked="${k === mode}" data-pick="${k}">
            <span class="mode-name">${MODES[k].name}</span>
            <span class="mode-desc">${MODES[k].desc}</span>
          </button>`).join('')}
      </div>

      <h2 class="section-title">${first ? '第二步：填写你的情况' : `${MODES[mode].name}参数`}</h2>
      <form class="form" id="settings-form" novalidate>
        ${extra}
        ${fields}
        ${disposable}
        <p class="privacy">所有信息仅保存在你的设备上，不会上传。</p>
        <button type="submit" class="btn primary block">${first ? '开始换算' : '保存设置'}</button>
      </form>
    </main>`;

  app.querySelectorAll('[data-pick]').forEach((btn) =>
    btn.addEventListener('click', () => {
      d.mode = btn.dataset.pick;
      state.draftErrors = {};
      renderSettings();
    }),
  );
  app.querySelectorAll('[data-income]').forEach((btn) =>
    btn.addEventListener('click', () => {
      s.incomeType = btn.dataset.income;
      state.draftErrors = {};
      renderSettings();
    }),
  );
  app.querySelectorAll('[data-period]').forEach((btn) =>
    btn.addEventListener('click', () => {
      s.period = btn.dataset.period;
      state.draftErrors = {};
      renderSettings();
    }),
  );
  app.querySelectorAll('[data-field]').forEach((input) =>
    input.addEventListener('input', () => {
      s[input.dataset.field] = input.value;
    }),
  );
  const checkbox = app.querySelector('#f-disposable');
  if (checkbox) checkbox.addEventListener('change', () => { s.isDisposable = checkbox.checked; });

  app.querySelector('#settings-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const result = validateSettings(mode, s);
    if (!result.ok) {
      state.draftErrors = result.errors;
      renderSettings();
      const firstError = app.querySelector('[aria-invalid="true"]');
      if (firstError) firstError.focus();
      return;
    }
    state.settings = clone(d);
    persistSettings();
    state.draft = null;
    state.draftErrors = {};
    toast('设置已保存');
    navigate('#/');
  });
}

/* ---------- Records ---------- */

function formatDateLabel(key) {
  const today = new Date();
  const fmt = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (key === fmt(today)) return '今天';
  if (key === fmt(yesterday)) return '昨天';
  const [y, m, dd] = key.split('-');
  return y === String(today.getFullYear()) ? `${Number(m)}月${Number(dd)}日` : `${y}年${Number(m)}月${Number(dd)}日`;
}

function formatTime(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function recordItem(r) {
  const modeName = MODES[r.mode]?.name ?? '';
  const editing = state.editingId === r.id;
  const confirming = state.confirmDeleteId === r.id;
  const nameBlock = editing
    ? `<form class="rename" data-rename="${r.id}">
        <input type="text" maxlength="40" value="${esc(r.name)}" aria-label="商品名称" />
        <button type="submit" class="btn small primary">保存</button>
        <button type="button" class="btn small" data-cancel>取消</button>
      </form>`
    : `<p class="rec-name">${esc(r.name)}</p>`;
  return `
    <li class="record">
      <div class="rec-main">
        ${nameBlock}
        <p class="rec-summary">${esc(r.summary || '')}</p>
        <p class="rec-meta"><span class="tag tag-${esc(r.mode)}">${esc(modeName)}</span>${formatTime(r.createdAt)}</p>
      </div>
      <div class="rec-side">
        <p class="rec-price">¥${formatMoney(r.price)}</p>
        ${editing ? '' : `
        <div class="rec-actions">
          <button type="button" class="text-btn" data-edit="${r.id}">改名</button>
          <button type="button" class="text-btn danger${confirming ? ' confirming' : ''}" data-delete="${r.id}">${confirming ? '确认删除' : '删除'}</button>
        </div>`}
      </div>
    </li>`;
}

function renderRecords() {
  const groups = groupRecordsByDate(state.records);
  app.innerHTML = `
    <main class="page records">
      <header class="topbar">
        <a class="back" href="#/" aria-label="返回首页">‹ 返回</a>
        <h1 class="page-title">消费记录</h1>
      </header>
      ${groups.length === 0
        ? `<div class="empty-state">
            <p>还没有记录</p>
            <p class="muted">在首页换算后点“保存记录”，就能在这里回看。</p>
            <a class="btn primary" href="#/">去换算</a>
          </div>`
        : groups.map((g) => `
          <section class="day">
            <h2 class="day-title">${formatDateLabel(g.date)}<span>${g.items.length} 条 · 合计 ¥${formatMoney(g.items.reduce((sum, r) => sum + r.price, 0))}</span></h2>
            <ul class="record-list">${g.items.map(recordItem).join('')}</ul>
          </section>`).join('')}
    </main>`;

  app.querySelectorAll('[data-edit]').forEach((btn) =>
    btn.addEventListener('click', () => {
      state.editingId = btn.dataset.edit;
      state.confirmDeleteId = null;
      renderRecords();
      const input = app.querySelector('.rename input');
      input.focus();
      input.select();
    }),
  );
  app.querySelectorAll('[data-rename]').forEach((form) => {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      state.records = renameRecord(form.dataset.rename, form.querySelector('input').value);
      state.editingId = null;
      toast('已修改');
      renderRecords();
    });
    form.querySelector('[data-cancel]').addEventListener('click', () => {
      state.editingId = null;
      renderRecords();
    });
  });
  app.querySelectorAll('[data-delete]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const id = btn.dataset.delete;
      if (state.confirmDeleteId !== id) {
        state.confirmDeleteId = id;
        renderRecords();
        return;
      }
      state.records = deleteRecord(id);
      state.confirmDeleteId = null;
      toast('已删除');
      renderRecords();
    }),
  );
}

/* ---------- Router ---------- */

function render() {
  const route = location.hash.replace(/^#/, '') || '/';
  state.editingId = null;
  state.confirmDeleteId = null;
  if (state.isFirstUse || route === '/settings') {
    if (route !== '/settings') state.draft = null;
    renderSettings();
  } else if (route === '/records') {
    state.records = loadRecords();
    renderRecords();
  } else {
    state.draft = null;
    state.draftErrors = {};
    renderHome();
  }
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', render);
render();
