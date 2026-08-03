import { AppError } from '@/src/types/api';
import { HTTP } from '@/src/constants/http';

// ----------------------------------------------------------------------
// Parser for Т-Банк CSV statements ("Операции" export): semicolon-separated,
// double-quoted cells with "" escapes, comma decimal separator, dd.mm.yyyy
// timestamps in Moscow time. Bank categories occasionally contain a non-breaking
// space (U+00A0) instead of a regular one — normalized here so the classifier can
// match them by plain string equality.

export interface ParsedFinanceOp {
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
}

export interface ParsedTinkoffCsv {
  ops: ParsedFinanceOp[];
  skippedFailed: number;
  badRows: number;
}

const OP_DATE_REGEX = /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2}):(\d{2})$/;

function splitCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ';') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function parseNumber(raw: string): number {
  return Number(
    raw
      .replace(/\u00a0/g, '')
      .replace(/\s/g, '')
      .replace(',', '.')
  );
}

function cellAt(row: string[], index: number): string {
  return index >= 0 && index < row.length ? row[index] : '';
}

export function parseTinkoffCsv(text: string): ParsedTinkoffCsv {
  const rows = splitCsv(text);
  const headerIndex = rows.findIndex((row) => row.some((cell) => cell.trim() === 'Дата операции'));
  if (headerIndex === -1) {
    throw new AppError(
      HTTP.BAD_REQUEST,
      'Это не похоже на CSV-выписку Т-Банка: не нашла колонку «Дата операции»'
    );
  }

  const header = rows[headerIndex].map((cell) => cell.trim());
  const columns = {
    opAt: header.indexOf('Дата операции'),
    payDate: header.indexOf('Дата платежа'),
    card: header.indexOf('Номер карты'),
    status: header.indexOf('Статус'),
    amount: header.indexOf('Сумма операции'),
    currency: header.indexOf('Валюта операции'),
    cashback: header.indexOf('Кэшбэк'),
    category: header.indexOf('Категория'),
    mcc: header.indexOf('MCC'),
    description: header.indexOf('Описание'),
  };
  if (columns.amount === -1 || columns.description === -1) {
    throw new AppError(
      HTTP.BAD_REQUEST,
      'Это не похоже на CSV-выписку Т-Банка: нет колонок «Сумма операции» и «Описание»'
    );
  }

  const ops: ParsedFinanceOp[] = [];
  let skippedFailed = 0;
  let badRows = 0;

  rows.slice(headerIndex + 1).forEach((row) => {
    if (row.every((cell) => cell.trim() === '')) {
      return;
    }
    const status = cellAt(row, columns.status).trim() || 'OK';
    if (status !== 'OK') {
      skippedFailed += 1;
      return;
    }
    const dateMatch = OP_DATE_REGEX.exec(cellAt(row, columns.opAt).trim());
    const amount = parseNumber(cellAt(row, columns.amount));
    if (!dateMatch || !Number.isFinite(amount)) {
      badRows += 1;
      return;
    }
    const [, day, month, year, hours, minutes, seconds] = dateMatch;
    const cashback = parseNumber(cellAt(row, columns.cashback));
    ops.push({
      opAt: `${year}-${month}-${day}T${hours}:${minutes}:${seconds}+03:00`,
      ym: `${year}-${month}`,
      payDate: cellAt(row, columns.payDate).trim(),
      card: cellAt(row, columns.card).trim(),
      amount,
      currency: cellAt(row, columns.currency).trim() || 'RUB',
      bankCategory: cellAt(row, columns.category)
        .replace(/\u00a0/g, ' ')
        .trim(),
      mcc: cellAt(row, columns.mcc).trim(),
      description: cellAt(row, columns.description).trim(),
      cashback: Number.isFinite(cashback) ? cashback : 0,
    });
  });

  return { ops, skippedFailed, badRows };
}
