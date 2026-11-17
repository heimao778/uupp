import { describe, it, expect } from 'vitest';
import {
  calculate,
  parseNumber,
  parsePrice,
  formatNumber,
  validateSettings,
  summarizeSettings,
  getPeriodDays,
} from '../src/calc.js';

const labor = { incomeType: 'monthly', monthlyIncome: '3300', workDays: '22', hoursPerDay: '8' };
const living = { monthlyAllowance: '1500', budgetDays: '30', isDisposable: false };
const custom = { budget: '2000', period: 'custom', customDays: '30' };

describe('PRD 10.1 劳动时间模式', () => {
  it('月收入 3300、22 天、8 小时，300 元约 16 小时、2 个工作日', () => {
    const r = calculate('labor', labor, '300');
    expect(r.ok).toBe(true);
    expect(r.result.raw.hours).toBeCloseTo(16, 6);
    expect(r.result.raw.workDays).toBeCloseTo(2, 6);
    expect(r.result.value).toBe('16');
    expect(r.result.unit).toBe('小时');
    expect(r.result.details[0]).toContain('2 个工作日');
    expect(r.result.raw.hourlyWage).toBeCloseTo(18.75, 6);
  });

  it('直接填写时薪', () => {
    const r = calculate('labor', { incomeType: 'hourly', hourlyWage: '50', workDays: '22', hoursPerDay: '8' }, '100');
    expect(r.result.raw.hours).toBe(2);
    expect(r.result.details).toHaveLength(1);
  });

  it('不足 1 小时显示分钟', () => {
    const r = calculate('labor', labor, '9.375');
    expect(r.result.value).toBe('30');
    expect(r.result.unit).toBe('分钟');
  });
});

describe('PRD 10.2 生活费模式', () => {
  it('每月 1500、30 天，300 元相当于 6 天生活费预算', () => {
    const r = calculate('living', living, '300');
    expect(r.result.raw.days).toBe(6);
    expect(r.result.value).toBe('6');
    expect(r.result.unit).toBe('天生活费预算');
    expect(r.result.approx).toBe(false);
  });

  it('可支配预算会明确标记', () => {
    const r = calculate('living', { ...living, isDisposable: true }, '300');
    expect(r.result.unit).toBe('天可支配预算');
    expect(r.result.summary).toContain('可支配预算');
  });
});

describe('PRD 10.3 自定义预算模式', () => {
  it('预算 2000、30 天，200 元占 10%、等效 3 天', () => {
    const r = calculate('custom', custom, '200');
    expect(r.result.raw.percent).toBeCloseTo(10, 6);
    expect(r.result.raw.days).toBeCloseTo(3, 6);
    expect(r.result.value).toBe('10');
    expect(r.result.unit).toBe('%');
    expect(r.result.details[0]).toBe('等效 3 天预算');
    expect(r.result.details[1]).toBe('按 30 天预算 2,000 元计算');
    expect(calculate('custom', { budget: '2000', period: 'month' }, '200').result.details[1]).toBe('按每月预算 2,000 元计算');
  });

  it.each([
    ['week', 7],
    ['month', 30],
    ['quarter', 90],
    ['year', 365],
  ])('预设周期 %s 对应 %i 天', (period, days) => {
    expect(getPeriodDays({ period })).toEqual({ ok: true, value: days });
  });

  it('每年预算按 365 天折算', () => {
    const r = calculate('custom', { budget: '36500', period: 'year' }, '100');
    expect(r.result.raw.days).toBeCloseTo(1, 6);
  });
});

describe('PRD 10.4 异常输入', () => {
  it('商品价格为空', () => {
    expect(calculate('labor', labor, '')).toMatchObject({ ok: false, field: 'price', error: '请输入商品价格' });
    expect(calculate('labor', labor, '   ').ok).toBe(false);
  });

  it('商品价格为负数', () => {
    expect(calculate('labor', labor, '-5')).toMatchObject({ ok: false, error: '商品价格不能为负数' });
  });

  it('输入非数字', () => {
    for (const bad of ['abc', '12abc', '1.2.3', '--1', 'NaN', 'Infinity', '1e5']) {
      expect(parsePrice(bad).ok, bad).toBe(false);
    }
    expect(parsePrice('abc').error).toBe('商品价格请输入数字');
  });

  it('小数金额', () => {
    expect(parsePrice('19.9')).toEqual({ ok: true, value: 19.9 });
    expect(parsePrice('.5')).toEqual({ ok: true, value: 0.5 });
    expect(parsePrice('1,299.5')).toEqual({ ok: true, value: 1299.5 });
    const r = calculate('living', living, '0.5');
    expect(r.ok).toBe(true);
    expect(r.result.value).toBe('不到 0.1');
  });

  it('价格为 0 提示必须大于 0', () => {
    expect(parsePrice('0').error).toBe('商品价格必须大于 0');
  });

  it('时薪为零', () => {
    const r = calculate('labor', { incomeType: 'hourly', hourlyWage: '0', workDays: '22', hoursPerDay: '8' }, '100');
    expect(r).toMatchObject({ ok: false, field: 'settings', error: '时薪必须大于 0' });
    expect(calculate('labor', { ...labor, monthlyIncome: '0' }, '100').error).toBe('月收入必须大于 0');
    expect(calculate('labor', { ...labor, workDays: '0' }, '100').error).toBe('每月工作天数必须大于 0');
  });

  it('预算金额为零', () => {
    expect(calculate('custom', { ...custom, budget: '0' }, '100').error).toBe('预算金额必须大于 0');
    expect(calculate('living', { ...living, monthlyAllowance: '0' }, '100').error).toBe('每月生活费必须大于 0');
  });

  it('超出范围的天数和小时数', () => {
    expect(validateSettings('labor', { ...labor, hoursPerDay: '25' }).errors.hoursPerDay).toBe('每天工作小时数不能大于 24');
    expect(validateSettings('labor', { ...labor, workDays: '32' }).errors.workDays).toBe('每月工作天数不能大于 31');
  });

  it('修改计算模式后重新计算', () => {
    const settings = { labor, living, custom };
    expect(calculate('labor', settings.labor, '300').result.value).toBe('16');
    expect(calculate('living', settings.living, '300').result.value).toBe('6');
    expect(calculate('custom', settings.custom, '300').result.value).toBe('15');
  });

  it('未知模式', () => {
    expect(validateSettings('foo', {}).ok).toBe(false);
  });
});

describe('格式化', () => {
  it('formatNumber 最多保留 1 位小数', () => {
    expect(formatNumber(16.000000000000004)).toBe('16');
    expect(formatNumber(2.345)).toBe('2.3');
    expect(formatNumber(12345.6)).toBe('12,345.6');
  });

  it('parseNumber 整数校验', () => {
    expect(parseNumber('1.5', { label: '天数', integer: true }).error).toBe('天数请输入整数');
  });

  it('summarizeSettings', () => {
    expect(summarizeSettings('labor', labor)).toBe('月收入 3,300 元 · 每月 22 天 · 每天 8 小时');
    expect(summarizeSettings('living', living)).toBe('每月生活费 1,500 元 · 预算 30 天');
    expect(summarizeSettings('custom', { budget: '2000', period: 'month' })).toBe('每月预算 2,000 元');
    expect(summarizeSettings('labor', { ...labor, monthlyIncome: '' })).toBeNull();
  });
});
