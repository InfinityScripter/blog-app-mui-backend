import '@jest/globals';
import {
  formatDogsDate,
  formatDogsClock,
  dogsServiceTitle,
  formatDogsDateTime,
  formatDogsDayLabel,
} from '@/src/utils/dogs-format';

// 2027-04-10 is a Saturday. 09:00 UTC = 14:00 in Asia/Yekaterinburg (UTC+5) —
// the assertions below fail if formatting ever falls back to the server TZ.
const SATURDAY_UTC = '2027-04-10T09:00:00.000Z';

describe('dogs-format', () => {
  afterEach(() => {
    delete process.env.DOGS_TIMEZONE;
  });

  it('renders dates in the business timezone (UTC+5), not the server one', () => {
    expect(formatDogsClock(SATURDAY_UTC)).toBe('14:00');
    expect(formatDogsDate(SATURDAY_UTC)).toBe('суббота, 10 апреля');
    expect(formatDogsDateTime(SATURDAY_UTC)).toBe('суббота, 10 апреля в 14:00');
  });

  it('respects DOGS_TIMEZONE override', () => {
    process.env.DOGS_TIMEZONE = 'UTC';
    expect(formatDogsClock(SATURDAY_UTC)).toBe('09:00');
  });

  it('labels today and tomorrow relative to the business timezone', () => {
    const now = new Date('2027-04-09T10:00:00.000Z');
    expect(formatDogsDayLabel('2027-04-09T12:00:00.000Z', now)).toBe('сегодня');
    expect(formatDogsDayLabel(SATURDAY_UTC, now)).toBe('завтра');
    expect(formatDogsDayLabel('2027-04-20T09:00:00.000Z', now)).toBeNull();
  });

  it('rolls the day over at the business midnight, not the UTC one', () => {
    // 2027-04-09 21:00 UTC is already 2027-04-10 02:00 in UTC+5.
    const now = new Date('2027-04-09T10:00:00.000Z');
    expect(formatDogsDayLabel('2027-04-09T21:00:00.000Z', now)).toBe('завтра');
  });

  it('maps known service ids and falls back to the raw id', () => {
    expect(dogsServiceTitle('training')).toBe('Дрессировка собак');
    expect(dogsServiceTitle('correction')).toBe('Коррекция поведения');
    expect(dogsServiceTitle('unknown-service')).toBe('unknown-service');
    expect(dogsServiceTitle(undefined)).toBeNull();
  });
});
