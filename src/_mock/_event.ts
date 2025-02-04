import dayjs from 'dayjs';
import cloneDeep from 'lodash/cloneDeep';

import { fSub, fAdd } from 'src/utils/format-time';

import { _mock } from 'src/_mock';

import COLORS from '../colors.json';

// ----------------------------------------------------------------------

const primaryMain = COLORS.primary.main;
const secondaryMain = COLORS.secondary.main;
const infoMain = COLORS.info.main;
const infoDarker = COLORS.info.darker;
const successMain = COLORS.success.main;
const warningMain = COLORS.warning.main;
const errorMain = COLORS.error.main;
const errorDarker = COLORS.error.darker;

const _events = [
  {
    id: _mock.id(1),
    title: _mock.eventNames(1),
    allDay: false,
    color: primaryMain,
    description: _mock.description(1),
    start: fSub({ days: 12, hours: 3, minutes: 30 }),
    end: fSub({ days: 12, hours: 0, minutes: 0 }),
  },
  {
    id: _mock.id(2),
    title: _mock.eventNames(2),
    allDay: false,
    color: infoMain,
    description: _mock.description(2),
    start: fSub({ days: 6, hours: 3, minutes: 30 }),
    end: fSub({ days: 6, hours: 0, minutes: 0 }),
  },
  {
    id: _mock.id(3),
    title: _mock.eventNames(3),
    allDay: false,
    color: successMain,
    description: _mock.description(3),
    start: fAdd({ days: 3, hours: 0, minutes: 0 }),
    end: fAdd({ days: 3, hours: 4, minutes: 15 }),
  },
  {
    id: _mock.id(4),
    title: _mock.eventNames(4),
    allDay: false,
    color: secondaryMain,
    description: _mock.description(4),
    start: fSub({ days: 0, hours: 4, minutes: 0 }),
    end: fSub({ days: 0, hours: 0, minutes: 0 }),
  },
  {
    id: _mock.id(5),
    title: _mock.eventNames(5),
    allDay: false,
    color: warningMain,
    description: _mock.description(5),
    start: fAdd({ days: 3, hours: 0, minutes: 0 }),
    end: fAdd({ days: 3, hours: 0, minutes: 30 }),
  },
  {
    id: _mock.id(6),
    title: _mock.eventNames(6),
    allDay: true,
    color: errorMain,
    description: _mock.description(6),
    start: dayjs(fSub({ days: 3 }))
      .startOf('day')
      .format(),
    end: dayjs(fSub({ days: 3 }))
      .endOf('day')
      .format(),
  },
  {
    id: _mock.id(7),
    title: _mock.eventNames(7),
    allDay: false,
    color: infoDarker,
    description: _mock.description(7),
    start: fAdd({ days: 3, hours: 0, minutes: 15 }),
    end: fAdd({ days: 3, hours: 0, minutes: 30 }),
  },
  {
    id: _mock.id(8),
    title: _mock.eventNames(8),
    allDay: false,
    color: infoMain,
    description: _mock.description(8),
    start: fAdd({ days: 3, hours: 0, minutes: 45 }),
    end: fAdd({ days: 3, hours: 0, minutes: 55 }),
  },
  {
    id: _mock.id(9),
    title: _mock.eventNames(9),
    allDay: false,
    color: errorDarker,
    description: _mock.description(9),
    start: fAdd({ days: 6, hours: 0, minutes: 10 }),
    end: fAdd({ days: 6, hours: 0, minutes: 20 }),
  },
];

// ----------------------------------------------------------------------

let data = _events;

export function getData() {
  return cloneDeep(data);
}

export function saveData(newData: Record<string, any>[]) {
  const reduceItems = Object.values(
    newData.reduce((accumulator: Record<string, any>, current: any) => {
      if (!accumulator[current.id]) {
        accumulator[current.id] = current;
      } else {
        accumulator[current.id] = { ...accumulator[current.id], ...current };
      }
      return accumulator;
    }, {})
  );

  data = reduceItems;
}
