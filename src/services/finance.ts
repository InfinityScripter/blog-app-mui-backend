import type { FinanceFlow } from '@/src/services/finance-classify';

import uuidv4 from '@/src/utils/uuidv4';
import dbConnect, { dbQuery } from '@/src/lib/db';
import { parseTinkoffCsv } from '@/src/services/finance-csv';
import { normalizeMerchant, classifyFinanceOps } from '@/src/services/finance-classify';

// ----------------------------------------------------------------------
// Personal finance ledger. Import stores raw statement rows, then the whole
// table is reclassified (wash-pair detection needs neighbours, so per-row
// classification at insert time would be incomplete). Summary/export read the
// stored classification, so every endpoint sees the same numbers.

interface FinanceOperationRow {
  id: string;
  op_at: Date | string;
  ym: string;
  pay_date: string;
  card: string;
  amount: string | number;
  currency: string;
  bank_category: string;
  mcc: string;
  description: string;
  cashback: string | number;
  flow: FinanceFlow;
  bucket: string;
  income_source: string;
}

export interface FinanceOperation {
  id: string;
  opAt: string;
  ym: string;
  payDate: string;
  card: string;
  amount: number;
  currency: string;
  bankCategory: string;
  mcc: string;
  description: string;
  cashback: number;
  flow: FinanceFlow;
  bucket: string;
  incomeSource: string;
}

export interface FinanceImportResult {
  inserted: number;
  duplicates: number;
  skippedFailed: number;
  badRows: number;
}

export interface FinanceMerchant {
  name: string;
  total: number;
  count: number;
}

export interface FinanceBucketOperation {
  id: string;
  opAt: string;
  merchant: string;
  description: string;
  amount: number;
  card: string;
  mcc: string;
  bankCategory: string;
  cashback: number;
}

export interface FinanceSummary {
  range: { from: string | null; to: string | null };
  months: Array<{ ym: string; income: number; expense: number }>;
  coverage: Array<{ ym: string; count: number }>;
  totals: { income: number; expense: number; saved: number };
  incomeBySource: Array<{ source: string; total: number }>;
  buckets: Array<{ bucket: string; total: number; merchants: FinanceMerchant[] }>;
  subscriptions: Array<{ name: string; average: number; monthsCount: number; total: number }>;
  internalVolume: number;
  washVolume: number;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

const toMs = (opAt: Date | string) =>
  opAt instanceof Date ? opAt.getTime() : new Date(opAt).getTime();

const dedupKey = (opAtMs: number, amount: number, description: string, card: string) =>
  `${opAtMs}|${amount.toFixed(2)}|${description}|${card}`;

function toOperation(row: FinanceOperationRow): FinanceOperation {
  return {
    id: row.id,
    opAt: new Date(toMs(row.op_at)).toISOString(),
    ym: row.ym,
    payDate: row.pay_date,
    card: row.card,
    amount: Number(row.amount),
    currency: row.currency,
    bankCategory: row.bank_category,
    mcc: row.mcc,
    description: row.description,
    cashback: Number(row.cashback),
    flow: row.flow,
    bucket: row.bucket,
    incomeSource: row.income_source,
  };
}

// Batches keep the shared pg pool (max 10, serves the public blog too) from
// being saturated by a large statement: at most one chunk of statements is in
// flight at a time instead of thousands of parallel queries.
const WRITE_CHUNK = 100;

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function reclassifyAll(): Promise<void> {
  const { rows } = await dbQuery<FinanceOperationRow>(
    'SELECT id, op_at, ym, pay_date, card, amount, currency, bank_category, mcc, description, cashback, flow, bucket, income_source FROM finance_operations ORDER BY op_at ASC, id ASC'
  );
  const classified = classifyFinanceOps(
    rows.map((row) => ({
      opAtMs: toMs(row.op_at),
      amount: Number(row.amount),
      bankCategory: row.bank_category,
      description: row.description,
    }))
  );
  const changed = rows
    .map((row, index) => ({ row, next: classified[index] }))
    .filter(
      ({ row, next }) =>
        row.flow !== next.flow ||
        row.bucket !== next.bucket ||
        row.income_source !== next.incomeSource
    );
  await chunkArray(changed, WRITE_CHUNK).reduce(async (previous, chunk) => {
    await previous;
    await Promise.all(
      chunk.map(({ row, next }) =>
        dbQuery(
          'UPDATE finance_operations SET flow = $1, bucket = $2, income_source = $3 WHERE id = $4',
          [next.flow, next.bucket, next.incomeSource, row.id]
        )
      )
    );
  }, Promise.resolve());
}

async function importCsv(csv: string): Promise<FinanceImportResult> {
  await dbConnect();
  const parsed = parseTinkoffCsv(csv);

  const existing = await dbQuery<
    Pick<FinanceOperationRow, 'op_at' | 'amount' | 'description' | 'card'>
  >('SELECT op_at, amount, description, card FROM finance_operations');
  const seen = new Set(
    existing.rows.map((row) =>
      dedupKey(toMs(row.op_at), Number(row.amount), row.description, row.card)
    )
  );

  const fresh = parsed.ops.filter((op) => {
    const key = dedupKey(new Date(op.opAt).getTime(), op.amount, op.description, op.card);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  // ON CONFLICT DO NOTHING closes the race with a concurrent import of an
  // overlapping statement: the in-memory dedup snapshot above can be stale,
  // and without it the second INSERT would 500 on the unique index.
  const INSERT_COLUMNS = 11;
  await chunkArray(fresh, WRITE_CHUNK).reduce(async (previous, chunk) => {
    await previous;
    const placeholders = chunk
      .map((op, rowIndex) => {
        const base = rowIndex * INSERT_COLUMNS;
        const cols = Array.from(
          { length: INSERT_COLUMNS },
          (unused, colIndex) => `$${base + colIndex + 1}`
        );
        return `(${cols.join(', ')})`;
      })
      .join(', ');
    const params: unknown[] = [];
    chunk.forEach((op) => {
      params.push(
        uuidv4(),
        op.opAt,
        op.ym,
        op.payDate,
        op.card,
        op.amount,
        op.currency,
        op.bankCategory,
        op.mcc,
        op.description,
        op.cashback
      );
    });
    await dbQuery(
      `INSERT INTO finance_operations
         (id, op_at, ym, pay_date, card, amount, currency, bank_category, mcc, description, cashback)
       VALUES ${placeholders}
       ON CONFLICT (op_at, amount, description, card) DO NOTHING`,
      params
    );
  }, Promise.resolve());
  if (fresh.length > 0) {
    await reclassifyAll();
  }

  return {
    inserted: fresh.length,
    duplicates: parsed.ops.length - fresh.length,
    skippedFailed: parsed.skippedFailed,
    badRows: parsed.badRows,
  };
}

async function getSummary(from?: string, to?: string): Promise<FinanceSummary> {
  await dbConnect();
  const { rows } = await dbQuery<FinanceOperationRow>(
    'SELECT * FROM finance_operations ORDER BY op_at ASC, id ASC'
  );
  const ops = rows.map(toOperation);

  const monthMap = new Map<string, { income: number; expense: number }>();
  const coverageMap = new Map<string, number>();
  ops.forEach((op) => {
    coverageMap.set(op.ym, (coverageMap.get(op.ym) ?? 0) + 1);
    if (op.flow !== 'income' && op.flow !== 'expense') {
      return;
    }
    const month = monthMap.get(op.ym) ?? { income: 0, expense: 0 };
    if (op.flow === 'income') {
      month.income += op.amount;
    } else {
      month.expense += -op.amount;
    }
    monthMap.set(op.ym, month);
  });
  const monthKeys = Array.from(coverageMap.keys()).sort();
  const months = monthKeys.map((ym) => ({
    ym,
    income: round2(monthMap.get(ym)?.income ?? 0),
    expense: round2(monthMap.get(ym)?.expense ?? 0),
  }));
  const coverage = monthKeys.map((ym) => ({ ym, count: coverageMap.get(ym) ?? 0 }));

  const resolvedTo = to ?? monthKeys[monthKeys.length - 1] ?? null;
  const resolvedFrom = from ?? monthKeys[Math.max(0, monthKeys.length - 12)] ?? null;
  const rangeOps = ops.filter(
    (op) =>
      resolvedFrom !== null && resolvedTo !== null && op.ym >= resolvedFrom && op.ym <= resolvedTo
  );

  let income = 0;
  let expense = 0;
  let internalVolume = 0;
  let washVolume = 0;
  const sources = new Map<string, number>();
  const buckets = new Map<string, { total: number; merchants: Map<string, FinanceMerchant> }>();
  const recurring = new Map<
    string,
    { name: string; total: number; count: number; months: Set<string>; min: number; max: number }
  >();

  rangeOps.forEach((op) => {
    if (op.flow === 'internal') {
      internalVolume += Math.abs(op.amount);
      return;
    }
    if (op.flow === 'wash') {
      washVolume += Math.abs(op.amount);
      return;
    }
    if (op.flow === 'income') {
      income += op.amount;
      sources.set(op.incomeSource, (sources.get(op.incomeSource) ?? 0) + op.amount);
      return;
    }
    expense += -op.amount;
    const bucket = buckets.get(op.bucket) ?? {
      total: 0,
      merchants: new Map<string, FinanceMerchant>(),
    };
    bucket.total += -op.amount;
    const name = normalizeMerchant(op.description);
    const merchantKey = name.toLowerCase();
    const merchant = bucket.merchants.get(merchantKey) ?? { name, total: 0, count: 0 };
    merchant.total += -op.amount;
    if (op.amount < 0) {
      merchant.count += 1;
    }
    bucket.merchants.set(merchantKey, merchant);
    buckets.set(op.bucket, bucket);

    if (op.amount < 0) {
      const spent = -op.amount;
      const entry =
        recurring.get(merchantKey) ??
        ({ name, total: 0, count: 0, months: new Set<string>(), min: Infinity, max: 0 } as {
          name: string;
          total: number;
          count: number;
          months: Set<string>;
          min: number;
          max: number;
        });
      entry.total += spent;
      entry.count += 1;
      entry.months.add(op.ym);
      entry.min = Math.min(entry.min, spent);
      entry.max = Math.max(entry.max, spent);
      recurring.set(merchantKey, entry);
    }
  });

  const bucketList = Array.from(buckets.entries())
    .map(([bucket, value]) => ({
      bucket,
      total: round2(value.total),
      merchants: Array.from(value.merchants.values())
        .filter((merchant) => Math.abs(merchant.total) >= 0.005)
        .sort((a, b) => b.total - a.total)
        .map((merchant) => ({ ...merchant, total: round2(merchant.total) })),
    }))
    .filter((bucket) => Math.abs(bucket.total) >= 0.005)
    .sort((a, b) => b.total - a.total);

  const subscriptions = Array.from(recurring.values())
    .filter((entry) => {
      const mean = entry.total / entry.count;
      return (
        entry.months.size >= 6 && mean > 50 && (entry.max - entry.min) / Math.max(mean, 1) < 0.25
      );
    })
    .map((entry) => ({
      name: entry.name,
      average: Math.round(entry.total / entry.count),
      monthsCount: entry.months.size,
      total: round2(entry.total),
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 15);

  return {
    range: { from: resolvedFrom, to: resolvedTo },
    months,
    coverage,
    totals: { income: round2(income), expense: round2(expense), saved: round2(income - expense) },
    incomeBySource: Array.from(sources.entries())
      .map(([source, total]) => ({ source, total: round2(total) }))
      .sort((a, b) => b.total - a.total),
    buckets: bucketList,
    subscriptions,
    internalVolume: round2(internalVolume),
    washVolume: round2(washVolume),
  };
}

// Дрилл-даун из карточки категории: сводка агрегирует траты до получателя, а
// здесь отдаются сами операции — та же выборка, что суммируется в bucket.total
// (flow='expense'), поэтому суммы строк сходятся с итогом категории.
async function getBucketOperations(
  bucket: string,
  from?: string,
  to?: string
): Promise<FinanceBucketOperation[]> {
  await dbConnect();
  const params: string[] = [bucket];
  const conditions = ["flow = 'expense'", 'bucket = $1'];
  if (from) {
    params.push(from);
    conditions.push(`ym >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    conditions.push(`ym <= $${params.length}`);
  }
  const { rows } = await dbQuery<FinanceOperationRow>(
    `SELECT * FROM finance_operations WHERE ${conditions.join(' AND ')} ORDER BY op_at DESC, id ASC`,
    params
  );
  return rows.map(toOperation).map((op) => ({
    id: op.id,
    opAt: op.opAt,
    merchant: normalizeMerchant(op.description),
    description: op.description,
    amount: op.amount,
    card: op.card,
    mcc: op.mcc,
    bankCategory: op.bankCategory,
    cashback: op.cashback,
  }));
}

async function getExport(from?: string, to?: string): Promise<FinanceOperation[]> {
  await dbConnect();
  const conditions: string[] = [];
  const params: string[] = [];
  if (from) {
    params.push(from);
    conditions.push(`ym >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    conditions.push(`ym <= $${params.length}`);
  }
  const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await dbQuery<FinanceOperationRow>(
    `SELECT * FROM finance_operations${where} ORDER BY op_at ASC, id ASC`,
    params
  );
  return rows.map(toOperation);
}

const EXPORT_COLUMNS = [
  'Дата операции',
  'Дата платежа',
  'Номер карты',
  'Статус',
  'Сумма операции',
  'Валюта операции',
  'Сумма платежа',
  'Валюта платежа',
  'Кэшбэк',
  'Категория',
  'MCC',
  'Описание',
  'Бонусы (включая кэшбэк)',
  'Округление на инвесткопилку',
  'Сумма операции с округлением',
  'Поток',
  'Категория учёта',
  'Источник дохода',
];

const MSK_FORMAT = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function formatMskDateTime(iso: string): string {
  const parts = new Map(
    MSK_FORMAT.formatToParts(new Date(iso)).map((part) => [part.type, part.value])
  );
  return `${parts.get('day')}.${parts.get('month')}.${parts.get('year')} ${parts.get('hour')}:${parts.get('minute')}:${parts.get('second')}`;
}

const csvCell = (value: string) => `"${value.replace(/"/g, '""')}"`;
const csvAmount = (value: number) => value.toFixed(2).replace('.', ',');

// Excel/Sheets execute a cell starting with =, + or @ as a formula, and the
// description of an incoming P2P transfer is written by the SENDER — hostile
// input (CWE-1236). Neutralized with a leading apostrophe on export. «-» is
// left alone: legitimate bank text starts with it far too often.
const FORMULA_PREFIX = /^[=+@\t]/;
const csvText = (value: string) => (FORMULA_PREFIX.test(value) ? `'${value}` : value);

function toCsv(operations: FinanceOperation[]): string {
  const lines = operations.map((op) => {
    const amount = csvAmount(op.amount);
    return [
      formatMskDateTime(op.opAt),
      op.payDate,
      op.card,
      'OK',
      amount,
      op.currency,
      amount,
      op.currency,
      op.cashback ? csvAmount(op.cashback) : '',
      csvText(op.bankCategory),
      csvText(op.mcc),
      csvText(op.description),
      '0,00',
      '0,00',
      amount,
      op.flow,
      op.bucket,
      op.incomeSource,
    ]
      .map(csvCell)
      .join(';');
  });
  return [EXPORT_COLUMNS.map(csvCell).join(';'), ...lines].join('\n');
}

export const financeService = {
  importCsv,
  getSummary,
  getBucketOperations,
  getExport,
  toCsv,
};
