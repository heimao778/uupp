import { DEFAULT_SETTINGS, MODE_KEYS } from './calc.js';

export const SETTINGS_KEY = 'tc.settings.v1';
export const RECORDS_KEY = 'tc.records.v1';
const MAX_NAME_LENGTH = 40;

function defaultStore() {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

function readJSON(store, key) {
  try {
    const text = store?.getItem(key);
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function writeJSON(store, key, value) {
  try {
    store?.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function cloneDefaults() {
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

/** Returns saved settings merged over defaults, plus whether anything was saved before. */
export function loadSettings(store = defaultStore()) {
  const saved = readJSON(store, SETTINGS_KEY);
  const settings = cloneDefaults();
  if (!isPlainObject(saved)) return { settings, isFirstUse: true };
  if (MODE_KEYS.includes(saved.mode)) settings.mode = saved.mode;
  for (const mode of MODE_KEYS) {
    if (isPlainObject(saved[mode])) {
      for (const key of Object.keys(settings[mode])) {
        if (key in saved[mode]) settings[mode][key] = saved[mode][key];
      }
    }
  }
  return { settings, isFirstUse: false };
}

export function saveSettings(settings, store = defaultStore()) {
  return writeJSON(store, SETTINGS_KEY, settings);
}

export function normalizeName(name) {
  return String(name ?? '').trim().slice(0, MAX_NAME_LENGTH);
}

function isValidRecord(r) {
  return isPlainObject(r) && typeof r.id === 'string' && Number.isFinite(r.price) && typeof r.createdAt === 'number';
}

export function loadRecords(store = defaultStore()) {
  const list = readJSON(store, RECORDS_KEY);
  if (!Array.isArray(list)) return [];
  return list.filter(isValidRecord).sort((a, b) => b.createdAt - a.createdAt);
}

function saveRecords(records, store) {
  return writeJSON(store, RECORDS_KEY, records);
}

function makeId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function addRecord({ name, price, mode, summary, value, unit, label }, store = defaultStore(), now = Date.now()) {
  const record = {
    id: makeId(),
    name: normalizeName(name) || '未命名商品',
    price,
    mode,
    summary,
    label,
    value,
    unit,
    createdAt: now,
  };
  const records = [record, ...loadRecords(store)];
  saveRecords(records, store);
  return record;
}

export function deleteRecord(id, store = defaultStore()) {
  const records = loadRecords(store).filter((r) => r.id !== id);
  saveRecords(records, store);
  return records;
}

export function renameRecord(id, name, store = defaultStore()) {
  const records = loadRecords(store).map((r) =>
    r.id === id ? { ...r, name: normalizeName(name) || '未命名商品' } : r,
  );
  saveRecords(records, store);
  return records;
}

/** Groups records (already sorted desc) by local calendar date. */
export function groupRecordsByDate(records) {
  const groups = [];
  for (const r of records) {
    const d = new Date(r.createdAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const last = groups[groups.length - 1];
    if (last && last.date === key) last.items.push(r);
    else groups.push({ date: key, items: [r] });
  }
  return groups;
}
