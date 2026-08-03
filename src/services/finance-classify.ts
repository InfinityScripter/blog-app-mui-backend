// ----------------------------------------------------------------------
// Classifier for imported bank operations. Splits money into four flows:
// income / expense / internal (перекладывание между своими счетами, вкладами
// и банками — не доход и не расход) / wash (парные ±X переводы в пределах
// трёх минут, которые взаимно гасятся). Expense rows get a human bucket,
// income rows get a source. Rules are household-specific on purpose: this is
// the personal-finance dashboard of the portal owner.

export type FinanceFlow = 'income' | 'expense' | 'internal' | 'wash';

export interface ClassifiableOp {
  opAtMs: number;
  amount: number;
  bankCategory: string;
  description: string;
}

export interface FinanceClassification {
  flow: FinanceFlow;
  bucket: string;
  incomeSource: string;
}

const INTERNAL_DESCRIPTIONS = new Set([
  'Между своими счетами',
  'Перевод между счетами',
  'Перевод собственных средств на счет. НДС не облагается.',
  'Пополнение через Райффайзенбанк',
  'Пополнение счета',
  'Закрытие вклада Т-Банк',
  'Пополнение вклада',
  'Первичное пополнение вклада',
  'Частичное изъятие вклада Т-Банк',
  'Перевод для закрытия накопительного счета',
  'Внесение наличных через банкомат Т-Банк',
  'Пополнение брокерского счета',
  'Вывод с брокерского счета',
  'Михаил Т.',
  'M. T.',
  'Перевод с карты',
]);

const TRANSFER_CATEGORIES = new Set(['Переводы', 'Пополнения']);
const INCOME_CATEGORIES = new Set(['Переводы', 'Пополнения', 'Зарплата', 'Бонусы', 'Проценты']);
const WASH_WINDOW_MS = 180_000;

function isInternal(op: ClassifiableOp): boolean {
  return INTERNAL_DESCRIPTIONS.has(op.description) || op.description.includes('Талалаев Михаил');
}

function looksLikeIncome(op: ClassifiableOp): boolean {
  if (op.amount <= 0) {
    return false;
  }
  const { description } = op;
  return (
    INCOME_CATEGORIES.has(op.bankCategory) ||
    description.includes('Зарплата') ||
    description.toUpperCase().includes('ЕГОРОВА') ||
    description.includes('Процент') ||
    description.includes('УФК')
  );
}

function incomeSourceOf(op: ClassifiableOp): string {
  const { description } = op;
  if (description.includes('Зарплата') || op.bankCategory === 'Зарплата') {
    return 'Зарплата';
  }
  if (description.toUpperCase().includes('ЕГОРОВА ЕЛЕНА')) {
    return 'ИП Егоровой';
  }
  if (op.bankCategory === 'Проценты' || description.includes('Процент')) {
    return 'Проценты по вкладу';
  }
  if (op.bankCategory === 'Бонусы') {
    return 'Кэшбэк и бонусы';
  }
  if (description.includes('УФК')) {
    return 'Возвраты от государства';
  }
  return 'Переводы от людей';
}

function bucketOf(op: ClassifiableOp): string {
  const { description } = op;
  const category = op.bankCategory;
  const lower = description.toLowerCase();

  if (lower.includes('ардшин') || lower.includes('ardshin')) {
    return 'ИИ-инструменты';
  }
  if (description === 'Пополнение от организации') {
    return 'Маркетплейсы';
  }
  if (lower.includes('федеральная налоговая') || lower.includes('фнс')) {
    return 'Налоги';
  }
  if (
    category === 'Турагентства' ||
    lower.includes('лимон трэвел') ||
    lower.includes('limon trevel')
  ) {
    return 'Путешествия';
  }
  if (TRANSFER_CATEGORIES.has(category)) {
    return description === 'Елена Е.' ? 'Переводы Елене (семья)' : 'Переводы другим людям';
  }
  if (description === 'Дом онлайн' || description === 'Platido' || category === 'ЖКХ') {
    return 'ЖКХ и квартира';
  }
  if (lower.includes('подписка') || description === 'Продамус' || lower.includes('рег.ру')) {
    return 'Подписки и домены';
  }
  if (
    lower.includes('petshop') ||
    lower.includes('зоо') ||
    lower.includes('sayenko') ||
    lower.includes('ferret') ||
    lower.includes('четыре лапы') ||
    category === 'Животные'
  ) {
    return 'Питомцы';
  }
  if (category === 'Медицина') {
    return 'Медицина (клиники)';
  }
  if (category === 'Аптеки') {
    return 'Аптеки';
  }
  if (category === 'Супермаркеты') {
    return 'Продукты (супермаркеты)';
  }
  if (category === 'Фастфуд' || category === 'Рестораны') {
    return 'Кафе, фастфуд, доставка';
  }
  if (description === 'Club-S') {
    return 'Авто: ремонт и сервис';
  }
  if (category === 'Заправки') {
    return 'Авто: топливо и мойка';
  }
  if (category === 'Автоуслуги' || category === 'Автосалоны' || lower.includes('парковка')) {
    return 'Авто: ремонт и сервис';
  }
  if (category === 'Местный транспорт' || category === 'Такси') {
    return 'Транспорт и такси';
  }
  if (category === 'Одежда и обувь') {
    return 'Одежда и обувь';
  }
  if (category === 'Госуслуги') {
    return lower.includes('налогов') ? 'Налоги' : 'Госпошлины';
  }
  if (category === 'Наличные' && lower.includes('нятие')) {
    return 'Снятие наличных';
  }
  if (lower.includes('сравни') || lower.includes('страхование')) {
    return 'Страховки';
  }
  if (
    lower.includes('arbital') ||
    description === 'еТелеком' ||
    description === 'AT HOME Домашние Сети' ||
    description === 'Билайн' ||
    description === 'Совкомбанк'
  ) {
    return 'Связь и интернет';
  }
  if (category === 'Финансы' || category === 'Услуги банка' || category === 'Наличные') {
    return 'Комиссии и финсервисы';
  }
  if (category === 'Цифровые товары') {
    return 'Игры и цифровые товары';
  }
  if (category === 'Маркетплейсы') {
    return 'Маркетплейсы';
  }
  if (category === 'Красота') {
    return 'Красота и уход';
  }
  if (category === 'Цветы') {
    return 'Цветы и подарки';
  }
  if (category === 'Ремонт и мебель') {
    return 'Дом и ремонт';
  }
  if (category === 'Связь' || category === 'Мобильная связь') {
    return 'Связь и интернет';
  }
  if (category === 'Различные товары') {
    return 'Хозтовары и разное';
  }
  return 'Остальное';
}

function findWashPairs(ops: ClassifiableOp[]): Set<number> {
  const wash = new Set<number>();
  const groups = new Map<string, number[]>();

  ops.forEach((op, index) => {
    if (isInternal(op) || !TRANSFER_CATEGORIES.has(op.bankCategory)) {
      return;
    }
    const key = `${op.description}|${Math.abs(op.amount).toFixed(2)}`;
    const group = groups.get(key);
    if (group) {
      group.push(index);
    } else {
      groups.set(key, [index]);
    }
  });

  groups.forEach((indexes) => {
    const positives = indexes.filter((index) => ops[index].amount > 0);
    const negatives = indexes.filter((index) => ops[index].amount < 0);
    positives.forEach((positive) => {
      if (wash.has(positive)) {
        return;
      }
      let best = -1;
      let bestDelta = Infinity;
      negatives.forEach((negative) => {
        if (wash.has(negative)) {
          return;
        }
        const delta = Math.abs(ops[positive].opAtMs - ops[negative].opAtMs);
        if (delta <= WASH_WINDOW_MS && delta < bestDelta) {
          best = negative;
          bestDelta = delta;
        }
      });
      if (best !== -1) {
        wash.add(positive);
        wash.add(best);
      }
    });
  });

  return wash;
}

export function classifyFinanceOps(ops: ClassifiableOp[]): FinanceClassification[] {
  const wash = findWashPairs(ops);
  return ops.map((op, index) => {
    if (isInternal(op)) {
      return { flow: 'internal', bucket: '', incomeSource: '' };
    }
    if (wash.has(index)) {
      return { flow: 'wash', bucket: '', incomeSource: '' };
    }
    if (looksLikeIncome(op)) {
      return { flow: 'income', bucket: '', incomeSource: incomeSourceOf(op) };
    }
    return { flow: 'expense', bucket: bucketOf(op), incomeSource: '' };
  });
}

const MERCHANT_ALIASES: Array<[string, string]> = [
  ['steambuy', 'Steambuy (ключи игр)'],
  ['plati.market', 'Plati.Market (ключи игр)'],
  ['arbital', 'Arbital (интернет)'],
  ['sayenko', 'Ветклиника IP Sayenko'],
  ['гасанова', 'ИП Гасанова (табак)'],
  ['gasanova', 'ИП Гасанова (табак)'],
  ['метрополь', 'Метрополь (Казань)'],
  ['лимон', 'Лимон Трэвел (туры)'],
  ['limon', 'Лимон Трэвел (туры)'],
  ['offprice', 'OFFPRICE'],
  ['teterina', 'IP Teterina (продукты)'],
  ['пятёрочка', 'Пятёрочка (+доставка)'],
  ['снятие в банкомате', 'Снятие в банкомате'],
  ['shaverlend', 'Shaverlend (шаверма)'],
  ['федеральная налоговая', 'Налоговая (ФНС)'],
  ['дом онлайн', 'Дом онлайн/Platido (квартплата)'],
  ['platido', 'Дом онлайн/Platido (квартплата)'],
  ['еирц', 'ЕИРЦ СПб (коммуналка)'],
  ['i24', 'Клиника I24 (стоматология)'],
  ['мегафон +7 922', 'МегаФон +7 922 (свой)'],
  ['мой телефон', 'Мой телефон +7 922'],
  ['кицуня', 'Кицуня Сот +7 953'],
  ['fit service', 'FIT Service (автосервис)'],
  ['babyuk', 'Мойка IP Babyuk'],
  ['rostic', "Rostic's"],
  ['pho-king', 'Pho-King'],
  ['phoking', 'Pho-King'],
  ['evo_soprano', 'Салон Evo Soprano'],
  ['technology', 'Technology (финсервис)'],
  ['достаевский', 'Достаевский (доставка)'],
  ['достоевский', 'Достаевский (доставка)'],
  ['ардшин', 'ОАО Ардшинбанк (ИИ-подписки)'],
];

export function normalizeMerchant(description: string): string {
  const lower = description.toLowerCase();
  const alias = MERCHANT_ALIASES.find(([needle]) => lower.includes(needle));
  return alias ? alias[1] : description;
}
