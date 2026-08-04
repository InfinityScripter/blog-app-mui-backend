import { z } from 'zod';

const YM_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

export const financeImportSchema = z.object({
  csv: z
    .string()
    .min(1, 'Пустой файл')
    .max(2_000_000, 'Файл больше 2 МБ — выгрузи период покороче'),
  filename: z.string().trim().max(200).optional(),
});

export const financeRangeSchema = z.object({
  from: z.string().regex(YM_REGEX, 'Ожидается месяц в формате YYYY-MM').optional(),
  to: z.string().regex(YM_REGEX, 'Ожидается месяц в формате YYYY-MM').optional(),
});

export const financeExportSchema = financeRangeSchema.extend({
  format: z.enum(['csv', 'json']).optional(),
});

export const financeOperationsSchema = financeRangeSchema.extend({
  bucket: z.string().trim().min(1, 'Нужна категория').max(120),
});
