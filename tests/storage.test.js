import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadSettings,
  saveSettings,
  loadRecords,
  addRecord,
  deleteRecord,
  renameRecord,
  groupRecordsByDate,
  SETTINGS_KEY,
  RECORDS_KEY,
} from '../src/storage.js';

function memoryStore() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
}

let store;
beforeEach(() => {
  store = memoryStore();
});

describe('设置持久化', () => {
  it('首次使用返回默认值', () => {
    const { settings, isFirstUse } = loadSettings(store);
    expect(isFirstUse).toBe(true);
    expect(settings.mode).toBe('labor');
    expect(settings.labor.workDays).toBe('22');
  });

  it('保存后重新读取（模拟关闭后重新打开）', () => {
    const { settings } = loadSettings(store);
    settings.mode = 'living';
    settings.living.monthlyAllowance = '1500';
    saveSettings(settings, store);
    const reloaded = loadSettings(store);
    expect(reloaded.isFirstUse).toBe(false);
    expect(reloaded.settings.mode).toBe('living');
    expect(reloaded.settings.living.monthlyAllowance).toBe('1500');
  });

  it('数据损坏时回退到默认值', () => {
    store.setItem(SETTINGS_KEY, '{not json');
    expect(loadSettings(store).isFirstUse).toBe(true);
    store.setItem(SETTINGS_KEY, JSON.stringify({ mode: 'hack', labor: { workDays: '20', evil: 1 } }));
    const { settings } = loadSettings(store);
    expect(settings.mode).toBe('labor');
    expect(settings.labor.workDays).toBe('20');
    expect(settings.labor.evil).toBeUndefined();
  });

  it('存储不可用时不抛错', () => {
    const broken = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
    expect(loadSettings(broken).isFirstUse).toBe(true);
    expect(saveSettings({}, broken)).toBe(false);
  });
});

describe('消费记录', () => {
  const base = { price: 300, mode: 'labor', summary: '需工作约 16 小时', label: '需要工作', value: '16', unit: '小时' };

  it('新增、按时间倒序读取', () => {
    addRecord({ ...base, name: 'A' }, store, 1000);
    addRecord({ ...base, name: 'B' }, store, 2000);
    const list = loadRecords(store);
    expect(list.map((r) => r.name)).toEqual(['B', 'A']);
  });

  it('空名称使用默认名，过长名称截断', () => {
    expect(addRecord({ ...base, name: '  ' }, store).name).toBe('未命名商品');
    expect(addRecord({ ...base, name: 'x'.repeat(100) }, store).name).toHaveLength(40);
  });

  it('删除记录', () => {
    const r = addRecord({ ...base, name: 'A' }, store);
    addRecord({ ...base, name: 'B' }, store);
    expect(deleteRecord(r.id, store).map((x) => x.name)).toEqual(['B']);
    expect(loadRecords(store)).toHaveLength(1);
  });

  it('修改商品名称', () => {
    const r = addRecord({ ...base, name: 'A' }, store);
    renameRecord(r.id, ' 新名字 ', store);
    expect(loadRecords(store)[0].name).toBe('新名字');
  });

  it('过滤损坏的记录', () => {
    store.setItem(RECORDS_KEY, JSON.stringify([{ id: 'ok', price: 1, createdAt: 1 }, { id: 2 }, null, 'x']));
    expect(loadRecords(store)).toHaveLength(1);
    store.setItem(RECORDS_KEY, '{"a":1}');
    expect(loadRecords(store)).toEqual([]);
  });

  it('按日期分组', () => {
    const d1 = new Date(2026, 10, 17, 10).getTime();
    const d2 = new Date(2026, 10, 17, 9).getTime();
    const d3 = new Date(2026, 10, 16, 20).getTime();
    const groups = groupRecordsByDate([
      { createdAt: d1 }, { createdAt: d2 }, { createdAt: d3 },
    ]);
    expect(groups.map((g) => [g.date, g.items.length])).toEqual([['2026-11-17', 2], ['2026-11-16', 1]]);
  });
});
