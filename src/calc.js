export const MODES = {
  labor: { key: 'labor', name: '劳动时间', desc: '适合上班族、兼职、自由职业者' },
  living: { key: 'living', name: '生活费', desc: '适合学生、依靠固定生活费的人' },
  custom: { key: 'custom', name: '自定义预算', desc: '适合没有固定收入、依靠储蓄的人' },
};

export const MODE_KEYS = Object.keys(MODES);

export const PERIODS = {
  week: { label: '每周', days: 7 },
  month: { label: '每月', days: 30 },
  quarter: { label: '每季度', days: 90 },
  year: { label: '每年', days: 365 },
  custom: { label: '自定义天数', days: null },
};

export const DEFAULT_SETTINGS = {
  mode: 'labor',
  labor: { incomeType: 'monthly', monthlyIncome: '', hourlyWage: '', workDays: '22', hoursPerDay: '8' },
  living: { monthlyAllowance: '', budgetDays: '30', isDisposable: false },
  custom: { budget: '', period: 'month', customDays: '30' },
};

const MAX_AMOUNT = 1e10;
const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)$/;

/**
 * Parses user input into a number and validates it.
 * Accepts strings (raw input) or numbers.
 */
export function parseNumber(raw, { label = '数值', allowZero = false, min, max = MAX_AMOUNT, integer = false } = {}) {
  const text = raw === null || raw === undefined ? '' : String(raw).trim().replace(/[,，]/g, '');
  if (text === '') return { ok: false, error: `请输入${label}` };
  if (!NUMBER_RE.test(text)) return { ok: false, error: `${label}请输入数字` };
  const value = Number(text);
  if (!Number.isFinite(value)) return { ok: false, error: `${label}请输入数字` };
  if (value < 0) return { ok: false, error: `${label}不能为负数` };
  if (value === 0 && !allowZero) return { ok: false, error: `${label}必须大于 0` };
  if (integer && !Number.isInteger(value)) return { ok: false, error: `${label}请输入整数` };
  if (min !== undefined && value < min) return { ok: false, error: `${label}不能小于 ${min}` };
  if (value > max) return { ok: false, error: `${label}不能大于 ${formatNumber(max)}` };
  return { ok: true, value };
}

export function parsePrice(raw) {
  return parseNumber(raw, { label: '商品价格' });
}

function collect(fields) {
  const errors = {};
  const values = {};
  for (const [key, result] of Object.entries(fields)) {
    if (result.ok) values[key] = result.value;
    else errors[key] = result.error;
  }
  return { ok: Object.keys(errors).length === 0, errors, values };
}

export function validateLabor(s = {}) {
  const fields = {
    workDays: parseNumber(s.workDays, { label: '每月工作天数', max: 31 }),
    hoursPerDay: parseNumber(s.hoursPerDay, { label: '每天工作小时数', max: 24 }),
  };
  if (s.incomeType === 'hourly') {
    fields.hourlyWage = parseNumber(s.hourlyWage, { label: '时薪' });
  } else {
    fields.monthlyIncome = parseNumber(s.monthlyIncome, { label: '月收入' });
  }
  const res = collect(fields);
  if (res.ok) {
    const v = res.values;
    v.hourlyWage = s.incomeType === 'hourly' ? v.hourlyWage : v.monthlyIncome / (v.workDays * v.hoursPerDay);
  }
  return res;
}

export function validateLiving(s = {}) {
  const res = collect({
    monthlyAllowance: parseNumber(s.monthlyAllowance, { label: '每月生活费' }),
    budgetDays: parseNumber(s.budgetDays, { label: '每月预算天数', max: 31 }),
  });
  if (res.ok) {
    res.values.dailyBudget = res.values.monthlyAllowance / res.values.budgetDays;
    res.values.isDisposable = Boolean(s.isDisposable);
  }
  return res;
}

export function getPeriodDays(s = {}) {
  const period = PERIODS[s.period] ? s.period : 'month';
  if (period !== 'custom') return { ok: true, value: PERIODS[period].days };
  return parseNumber(s.customDays, { label: '预算天数', max: 3660 });
}

export function validateCustom(s = {}) {
  const res = collect({
    budget: parseNumber(s.budget, { label: '预算金额' }),
    periodDays: getPeriodDays(s),
  });
  if (res.ok) {
    res.values.period = PERIODS[s.period] ? s.period : 'month';
    res.values.dailyBudget = res.values.budget / res.values.periodDays;
  }
  return res;
}

const VALIDATORS = { labor: validateLabor, living: validateLiving, custom: validateCustom };

export function validateSettings(mode, settings) {
  const validator = VALIDATORS[mode];
  if (!validator) return { ok: false, errors: { mode: '未知的计算模式' }, values: {} };
  return validator(settings);
}

/** Rounds to at most `digits` decimals and drops trailing zeros. */
export function formatNumber(n, digits = 1) {
  if (!Number.isFinite(n)) return '-';
  const factor = 10 ** digits;
  const rounded = Math.round(n * factor) / factor;
  return rounded.toLocaleString('zh-CN', { maximumFractionDigits: digits });
}

export function formatMoney(n) {
  return formatNumber(n, 2);
}

function isApprox(n, digits = 1) {
  const factor = 10 ** digits;
  return Math.abs(Math.round(n * factor) / factor - n) > 1e-9;
}

/** Formats a small quantity, avoiding misleading "0". */
function formatQuantity(n, digits = 1) {
  const min = 1 / 10 ** digits;
  if (n > 0 && n < min) return { text: `不到 ${min}`, approx: false };
  return { text: formatNumber(n, digits), approx: isApprox(n, digits) };
}

function formatDuration(hours) {
  if (hours < 1) {
    const minutes = hours * 60;
    if (minutes < 1) return { value: '不到 1', unit: '分钟', approx: false };
    return { value: formatNumber(minutes, 0), unit: '分钟', approx: isApprox(minutes, 0) };
  }
  const q = formatQuantity(hours);
  return { value: q.text, unit: '小时', approx: q.approx };
}

function calcLaborResult(v, price) {
  const hours = price / v.hourlyWage;
  const workDays = hours / v.hoursPerDay;
  const d = formatDuration(hours);
  const details = [`按时薪 ${formatMoney(v.hourlyWage)} 元计算`];
  if (hours >= v.hoursPerDay) {
    const wd = formatQuantity(workDays);
    details.unshift(`${wd.approx ? '约' : '即'} ${wd.text} 个工作日（每天 ${formatNumber(v.hoursPerDay)} 小时）`);
  }
  return {
    label: '需要工作',
    value: d.value,
    unit: d.unit,
    approx: true,
    details,
    summary: `需工作约 ${d.value} ${d.unit}`,
    raw: { hours, workDays, hourlyWage: v.hourlyWage },
  };
}

function calcLivingResult(v, price) {
  const days = price / v.dailyBudget;
  const q = formatQuantity(days);
  const kind = v.isDisposable ? '可支配预算' : '生活费预算';
  return {
    label: '相当于',
    value: q.text,
    unit: `天${kind}`,
    approx: q.approx,
    details: [`每日${v.isDisposable ? '可支配' : '生活费'}预算 ${formatMoney(v.dailyBudget)} 元`],
    summary: `相当于${q.approx ? '约 ' : ' '}${q.text} 天${kind}`,
    raw: { days, dailyBudget: v.dailyBudget },
  };
}

function calcCustomResult(v, price) {
  const percent = (price / v.budget) * 100;
  const days = price / v.dailyBudget;
  const p = formatQuantity(percent);
  const d = formatQuantity(days);
  const periodLabel = v.period === 'custom' ? ` ${formatNumber(v.periodDays)} 天` : PERIODS[v.period].label;
  return {
    label: '占预算',
    value: p.text,
    unit: '%',
    approx: p.approx,
    details: [
      `等效 ${d.approx ? '约 ' : ''}${d.text} 天预算`,
      `按${periodLabel}预算 ${formatMoney(v.budget)} 元计算`,
    ],
    summary: `占预算${p.approx ? '约 ' : ' '}${p.text}%，等效 ${d.text} 天`,
    raw: { percent, days, dailyBudget: v.dailyBudget },
  };
}

const CALCULATORS = { labor: calcLaborResult, living: calcLivingResult, custom: calcCustomResult };

/**
 * Converts a price into personal resource cost for the given mode.
 * Returns { ok, result } or { ok: false, error, field }.
 */
export function calculate(mode, settings, priceRaw) {
  const price = parsePrice(priceRaw);
  if (!price.ok) return { ok: false, field: 'price', error: price.error };
  const s = validateSettings(mode, settings);
  if (!s.ok) return { ok: false, field: 'settings', error: Object.values(s.errors)[0], errors: s.errors };
  return { ok: true, price: price.value, result: CALCULATORS[mode](s.values, price.value) };
}

export function summarizeSettings(mode, settings) {
  const s = validateSettings(mode, settings);
  if (!s.ok) return null;
  const v = s.values;
  if (mode === 'labor') {
    const income = settings.incomeType === 'hourly'
      ? `时薪 ${formatMoney(v.hourlyWage)} 元`
      : `月收入 ${formatMoney(v.monthlyIncome)} 元`;
    return `${income} · 每月 ${formatNumber(v.workDays)} 天 · 每天 ${formatNumber(v.hoursPerDay)} 小时`;
  }
  if (mode === 'living') {
    const name = v.isDisposable ? '可支配生活费' : '每月生活费';
    return `${name} ${formatMoney(v.monthlyAllowance)} 元 · 预算 ${formatNumber(v.budgetDays)} 天`;
  }
  const periodLabel = v.period === 'custom' ? `${formatNumber(v.periodDays)} 天` : PERIODS[v.period].label;
  return `${periodLabel}预算 ${formatMoney(v.budget)} 元`;
}
