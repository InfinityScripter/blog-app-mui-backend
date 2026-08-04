import '@jest/globals';
import jwt from 'jsonwebtoken';
import User from '@/src/models/User';
import { dbQuery } from '@/src/lib/db';
import { JWT_SECRET } from '@/src/lib/jwt';
import { createMocks } from 'node-mocks-http';
import { HTTP_METHOD } from '@/src/constants/http';
import { financeService } from '@/src/services/finance';
import importHandler from '@/src/pages/api/finance/import';
import exportHandler from '@/src/pages/api/finance/export';
import summaryHandler from '@/src/pages/api/finance/summary';
import { parseTinkoffCsv } from '@/src/services/finance-csv';
import operationsHandler from '@/src/pages/api/finance/operations';
import { classifyFinanceOps } from '@/src/services/finance-classify';

function makeToken(userId: string, role: string) {
  return `Bearer ${jwt.sign({ userId, role }, JWT_SECRET)}`;
}

const HEADER =
  '"Дата операции";"Дата платежа";"Номер карты";"Статус";"Сумма операции";"Валюта операции";"Сумма платежа";"Валюта платежа";"Кэшбэк";"Категория";"MCC";"Описание";"Бонусы (включая кэшбэк)";"Округление на инвесткопилку";"Сумма операции с округлением"';

interface FixtureRow {
  date: string;
  amount: string;
  category: string;
  desc: string;
  status?: string;
  card?: string;
  mcc?: string;
  cashback?: string;
}

function csvRow(row: FixtureRow) {
  const payDate = row.date.slice(0, 10);
  const cells = [
    row.date,
    payDate,
    row.card ?? '',
    row.status ?? 'OK',
    row.amount,
    'RUB',
    row.amount,
    'RUB',
    row.cashback ?? '',
    row.category,
    row.mcc ?? '',
    row.desc,
    '0,00',
    '0,00',
    row.amount,
  ];
  return cells.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(';');
}

const FIXTURE_ROWS: FixtureRow[] = [
  {
    date: '01.07.2026 12:00:00',
    amount: '84251,00',
    category: 'Зарплата',
    desc: 'Пополнение. ООО "ТЕХНОЛОГИИ 211". Зарплата',
    card: '*5874',
  },
  {
    date: '02.07.2026 10:00:00',
    amount: '-1157,30',
    category: 'Другое',
    mcc: '4900',
    desc: 'Platido',
  },
  {
    date: '03.07.2026 10:00:00',
    amount: '-46150,00',
    category: 'Заправки',
    mcc: '5541',
    desc: 'Club-S',
  },
  {
    date: '04.07.2026 10:00:00',
    amount: '-20000,00',
    category: 'Переводы',
    desc: 'ОАО Ардшинбанк',
  },
  {
    date: '05.07.2026 10:00:00',
    amount: '-15000,00',
    category: 'Переводы',
    desc: 'Федеральная Налоговая Служба',
  },
  {
    date: '06.07.2026 10:00:00',
    amount: '-20368,00',
    category: 'Ремонт и мебель',
    mcc: '5200',
    desc: 'Всеинструменты.ру',
  },
  { date: '07.07.2026 10:00:00', amount: '-5000,00', category: 'Переводы', desc: 'Елена Е.' },
  { date: '07.07.2026 10:00:30', amount: '5000,00', category: 'Переводы', desc: 'Елена Е.' },
  { date: '08.07.2026 10:00:00', amount: '-23000,00', category: 'Переводы', desc: 'Елена Е.' },
  {
    date: '09.07.2026 09:00:00',
    amount: '1532532,76',
    category: 'Переводы',
    desc: 'Закрытие вклада Т-Банк',
  },
  {
    date: '09.07.2026 09:05:00',
    amount: '-1530000,00',
    category: 'Переводы',
    desc: 'Пополнение вклада',
  },
  {
    date: '10.07.2026 10:00:00',
    amount: '-158,00',
    category: 'Цифровые товары',
    desc: 'Steambuy',
    status: 'FAILED',
  },
  {
    date: '11.07.2026 10:00:00',
    amount: '854,18',
    category: 'Супермаркеты',
    mcc: '5411',
    desc: "О'КЕЙ",
  },
  { date: '11.07.2026 22:00:00', amount: '118,00', category: 'Бонусы', desc: 'Зачисление кэшбэка' },
  {
    date: '12.07.2026 10:00:00',
    amount: '-300,00',
    category: 'Мобильная связь',
    desc: 'МегаФон +7 922 248-37-50',
  },
];

const FIXTURE_CSV = [HEADER, ...FIXTURE_ROWS.map(csvRow)].join('\n');
const STORED_ROWS = 14;

describe('finance services', () => {
  it('parses the Т-Банк CSV format', () => {
    const parsed = parseTinkoffCsv(FIXTURE_CSV);
    expect(parsed.ops).toHaveLength(STORED_ROWS);
    expect(parsed.skippedFailed).toBe(1);
    expect(parsed.badRows).toBe(0);

    const salary = parsed.ops[0];
    expect(salary.amount).toBeCloseTo(84251);
    expect(salary.ym).toBe('2026-07');
    expect(salary.opAt).toBe('2026-07-01T12:00:00+03:00');
    expect(salary.description).toBe('Пополнение. ООО "ТЕХНОЛОГИИ 211". Зарплата');

    const repair = parsed.ops.find((op) => op.description === 'Всеинструменты.ру');
    expect(repair?.bankCategory).toBe('Ремонт и мебель');
  });

  it('rejects text without the Т-Банк header', () => {
    expect(() => parseTinkoffCsv('hello;world\n1;2')).toThrow('Т-Банка');
  });

  it('classifies flows and buckets, including household overrides', () => {
    const parsed = parseTinkoffCsv(FIXTURE_CSV);
    const classified = classifyFinanceOps(
      parsed.ops.map((op) => ({
        opAtMs: new Date(op.opAt).getTime(),
        amount: op.amount,
        bankCategory: op.bankCategory,
        description: op.description,
      }))
    );
    const byDesc = new Map(
      parsed.ops.map((op, index) => [`${op.description}|${op.amount}`, classified[index]])
    );

    expect(byDesc.get('Пополнение. ООО "ТЕХНОЛОГИИ 211". Зарплата|84251')).toMatchObject({
      flow: 'income',
      incomeSource: 'Зарплата',
    });
    expect(byDesc.get('Platido|-1157.3')?.bucket).toBe('ЖКХ и квартира');
    expect(byDesc.get('Club-S|-46150')?.bucket).toBe('Авто: ремонт и сервис');
    expect(byDesc.get('ОАО Ардшинбанк|-20000')?.bucket).toBe('ИИ-инструменты');
    expect(byDesc.get('Федеральная Налоговая Служба|-15000')?.bucket).toBe('Налоги');
    expect(byDesc.get('Всеинструменты.ру|-20368')?.bucket).toBe('Дом и ремонт');
    expect(byDesc.get('Елена Е.|-5000')?.flow).toBe('wash');
    expect(byDesc.get('Елена Е.|5000')?.flow).toBe('wash');
    expect(byDesc.get('Елена Е.|-23000')).toMatchObject({
      flow: 'expense',
      bucket: 'Переводы Елене (семья)',
    });
    expect(byDesc.get('Закрытие вклада Т-Банк|1532532.76')?.flow).toBe('internal');
    expect(byDesc.get('Пополнение вклада|-1530000')?.flow).toBe('internal');
    expect(byDesc.get("О'КЕЙ|854.18")).toMatchObject({
      flow: 'expense',
      bucket: 'Продукты (супермаркеты)',
    });
    expect(byDesc.get('Зачисление кэшбэка|118')).toMatchObject({
      flow: 'income',
      incomeSource: 'Кэшбэк и бонусы',
    });
    expect(byDesc.get('МегаФон +7 922 248-37-50|-300')?.bucket).toBe('Связь и интернет');
  });
});

describe('finance routes', () => {
  beforeEach(async () => {
    await User.deleteMany({});
    const hash = await import('bcrypt').then((b) => b.hash('pass', 10));
    await User.create({
      name: 'Admin',
      email: 'admin@test.com',
      passwordHash: hash,
      isEmailVerified: true,
      role: 'admin',
    });
    await User.create({
      name: 'User',
      email: 'user@test.com',
      passwordHash: hash,
      isEmailVerified: true,
      role: 'user',
    });
  });

  async function adminAuth() {
    const admin = await User.findOne({ email: 'admin@test.com' });
    return makeToken(admin!._id, 'admin');
  }

  async function importFixture() {
    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      headers: { authorization: await adminAuth() },
      body: { csv: FIXTURE_CSV, filename: 'july.csv' },
    });
    await importHandler(req, res);
    return { req, res };
  }

  it('401 without a token and 403 for a non-admin', async () => {
    const anon = createMocks({ method: HTTP_METHOD.POST, body: { csv: FIXTURE_CSV } });
    await importHandler(anon.req, anon.res);
    expect(anon.res._getStatusCode()).toBe(401);

    const user = await User.findOne({ email: 'user@test.com' });
    const forbidden = createMocks({
      method: HTTP_METHOD.POST,
      headers: { authorization: makeToken(user!._id, 'user') },
      body: { csv: FIXTURE_CSV },
    });
    await importHandler(forbidden.req, forbidden.res);
    expect(forbidden.res._getStatusCode()).toBe(403);
  });

  it('405 for a wrong method and 400 for a non-CSV body', async () => {
    const wrongMethod = createMocks({
      method: HTTP_METHOD.GET,
      headers: { authorization: await adminAuth() },
    });
    await importHandler(wrongMethod.req, wrongMethod.res);
    expect(wrongMethod.res._getStatusCode()).toBe(405);

    const garbage = createMocks({
      method: HTTP_METHOD.POST,
      headers: { authorization: await adminAuth() },
      body: { csv: 'просто текст без выписки' },
    });
    await importHandler(garbage.req, garbage.res);
    expect(garbage.res._getStatusCode()).toBe(400);
  });

  it('imports operations once and reports duplicates on a re-import', async () => {
    const first = await importFixture();
    expect(first.res._getStatusCode()).toBe(200);
    const firstData = JSON.parse(first.res._getData());
    expect(firstData.data).toMatchObject({
      inserted: STORED_ROWS,
      duplicates: 0,
      skippedFailed: 1,
      badRows: 0,
    });

    const second = await importFixture();
    expect(second.res._getStatusCode()).toBe(200);
    const secondData = JSON.parse(second.res._getData());
    expect(secondData.data).toMatchObject({ inserted: 0, duplicates: STORED_ROWS });
  });

  it('returns a summary with months, buckets and internal volumes', async () => {
    await importFixture();
    const { req, res } = createMocks({
      method: HTTP_METHOD.GET,
      headers: { authorization: await adminAuth() },
    });
    await summaryHandler(req, res);
    expect(res._getStatusCode()).toBe(200);
    const { data } = JSON.parse(res._getData());

    expect(data.months).toHaveLength(1);
    expect(data.months[0].ym).toBe('2026-07');
    expect(data.months[0].income).toBeCloseTo(84251 + 118);
    expect(data.months[0].expense).toBeCloseTo(
      1157.3 + 46150 + 20000 + 15000 + 20368 + 23000 + 300 - 854.18
    );

    const buckets = new Map(
      data.buckets.map((b: { bucket: string; total: number }) => [b.bucket, b.total])
    );
    expect(buckets.get('Авто: ремонт и сервис')).toBeCloseTo(46150);
    expect(buckets.get('ИИ-инструменты')).toBeCloseTo(20000);
    expect(buckets.get('Налоги')).toBeCloseTo(15000);
    expect(buckets.get('Переводы Елене (семья)')).toBeCloseTo(23000);

    expect(data.internalVolume).toBeCloseTo(1532532.76 + 1530000);
    expect(data.washVolume).toBeCloseTo(10000);
    expect(data.coverage[0]).toMatchObject({ ym: '2026-07', count: STORED_ROWS });
  });

  it('lists every operation of a bucket, newest first, with the merchant alias', async () => {
    await importFixture();
    const { req, res } = createMocks({
      method: HTTP_METHOD.GET,
      headers: { authorization: await adminAuth() },
      query: { bucket: 'Продукты (супермаркеты)' },
    });
    await operationsHandler(req, res);
    expect(res._getStatusCode()).toBe(200);
    const { data } = JSON.parse(res._getData());

    expect(data.operations).toHaveLength(1);
    expect(data.operations[0]).toMatchObject({
      description: "О'КЕЙ",
      merchant: "О'КЕЙ",
      amount: 854.18,
      bankCategory: 'Супермаркеты',
    });

    const alias = createMocks({
      method: HTTP_METHOD.GET,
      headers: { authorization: await adminAuth() },
      query: { bucket: 'ИИ-инструменты', from: '2026-07', to: '2026-07' },
    });
    await operationsHandler(alias.req, alias.res);
    expect(JSON.parse(alias.res._getData()).data.operations[0]).toMatchObject({
      description: 'ОАО Ардшинбанк',
      merchant: 'ОАО Ардшинбанк (ИИ-подписки)',
      amount: -20000,
    });
  });

  it('keeps non-expense flows and other months out of the bucket drill-down', async () => {
    await importFixture();
    const otherMonth = createMocks({
      method: HTTP_METHOD.GET,
      headers: { authorization: await adminAuth() },
      query: { bucket: 'Налоги', from: '2026-08' },
    });
    await operationsHandler(otherMonth.req, otherMonth.res);
    expect(JSON.parse(otherMonth.res._getData()).data.operations).toHaveLength(0);

    const missingBucket = createMocks({
      method: HTTP_METHOD.GET,
      headers: { authorization: await adminAuth() },
    });
    await operationsHandler(missingBucket.req, missingBucket.res);
    expect(missingBucket.res._getStatusCode()).toBe(400);
  });

  it('exports the range as CSV and as JSON', async () => {
    await importFixture();

    const csv = createMocks({
      method: HTTP_METHOD.GET,
      headers: { authorization: await adminAuth() },
      query: { from: '2026-07', to: '2026-07' },
    });
    await exportHandler(csv.req, csv.res);
    expect(csv.res._getStatusCode()).toBe(200);
    expect(csv.res.getHeader('content-type')).toContain('text/csv');
    const body = csv.res._getData() as string;
    expect(body).toContain('Дата операции');
    expect(body).toContain('Club-S');
    expect(body).toContain('01.07.2026 12:00:00');

    const json = createMocks({
      method: HTTP_METHOD.GET,
      headers: { authorization: await adminAuth() },
      query: { from: '2026-07', to: '2026-07', format: 'json' },
    });
    await exportHandler(json.req, json.res);
    expect(json.res._getStatusCode()).toBe(200);
    const { data } = JSON.parse(json.res._getData());
    expect(data.operations).toHaveLength(STORED_ROWS);
    expect(data.operations[0]).toHaveProperty('bucket');
  });
});

describe('finance hardening', () => {
  const ORIGINAL_BOT_TOKEN = process.env.BOT_API_TOKEN;
  const ORIGINAL_OWNER_EMAIL = process.env.OWNER_EMAIL;

  afterEach(() => {
    process.env.BOT_API_TOKEN = ORIGINAL_BOT_TOKEN;
    process.env.OWNER_EMAIL = ORIGINAL_OWNER_EMAIL;
  });

  it('403 for the bot service token on every finance route', async () => {
    process.env.BOT_API_TOKEN = 'bot-secret-token';
    process.env.OWNER_EMAIL = 'owner@test.com';
    await User.create({
      _id: 'owner',
      name: 'Owner',
      email: 'owner@test.com',
      passwordHash: 'x',
      role: 'admin',
    });
    const botAuth = { authorization: 'Bearer bot-secret-token' };

    const imp = createMocks({
      method: HTTP_METHOD.POST,
      headers: botAuth,
      body: { csv: FIXTURE_CSV },
    });
    await importHandler(imp.req, imp.res);
    expect(imp.res._getStatusCode()).toBe(403);
    expect(JSON.parse(imp.res._getData()).message).toBe('Forbidden: service token');

    const sum = createMocks({ method: HTTP_METHOD.GET, headers: botAuth });
    await summaryHandler(sum.req, sum.res);
    expect(sum.res._getStatusCode()).toBe(403);

    const exp = createMocks({ method: HTTP_METHOD.GET, headers: botAuth });
    await exportHandler(exp.req, exp.res);
    expect(exp.res._getStatusCode()).toBe(403);

    const ops = createMocks({
      method: HTTP_METHOD.GET,
      headers: botAuth,
      query: { bucket: 'Налоги' },
    });
    await operationsHandler(ops.req, ops.res);
    expect(ops.res._getStatusCode()).toBe(403);
  });

  it('concurrent overlapping imports neither fail nor duplicate rows', async () => {
    await Promise.all([
      financeService.importCsv(FIXTURE_CSV),
      financeService.importCsv(FIXTURE_CSV),
    ]);
    const { rows } = await dbQuery('SELECT id FROM finance_operations');
    expect(rows).toHaveLength(STORED_ROWS);
  });

  it('neutralizes formula-looking descriptions in the CSV export', async () => {
    const evil = [
      HEADER,
      csvRow({
        date: '15.07.2026 10:00:00',
        amount: '-100,00',
        category: 'Переводы',
        desc: '=HYPERLINK("http://evil.tld")',
      }),
    ].join('\n');
    await financeService.importCsv(evil);
    const operations = await financeService.getExport('2026-07', '2026-07');
    const csvOut = financeService.toCsv(operations);
    expect(csvOut).toContain('"\'=HYPERLINK');
    expect(csvOut).not.toContain(';"=HYPERLINK');
  });
});
