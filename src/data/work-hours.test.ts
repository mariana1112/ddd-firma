import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { getAppSettings, savePersonalSettings, DEFAULT_APP } from './settings';
import { startToSave, workHours } from './texts';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('godziny zabiegu', () => {
  it('ten sam dzień: same godziny; przez północ: daty obu dni', () => {
    expect(workHours({ startedAt: '2026-11-11T09:05:00.000Z', finishedAt: '2026-11-11T10:20:00.000Z' })).toEqual({ text: '10:05–11:20', multiDay: false });
    expect(workHours({ startedAt: '2026-11-10T21:41:00.000Z', finishedAt: '2026-11-11T10:52:00.000Z' })).toEqual({
      text: '10.11.2026 22:41 – 11.11.2026 11:52',
      multiDay: true,
    });
    expect(workHours({ startedAt: null, finishedAt: null }).text).toBe('');
  });

  it('zapomniane „Rozpocznij” sprzed ponad 8 godzin nie fałszuje początku zabiegu', () => {
    const end = '2026-11-11T10:52:00.000Z';
    expect(startToSave('2026-11-11T09:30:00.000Z', end)).toBe('2026-11-11T09:30:00.000Z');
    expect(startToSave('2026-11-10T21:41:00.000Z', end)).toBe(end);
    expect(startToSave(null, end)).toBe(end);
  });
});

describe('zalecenia', () => {
  it('stare zalecenia sprzeczne z firmowymi tekstami znikają także z zapisanych list', async () => {
    await savePersonalSettings({ ...DEFAULT_APP, recommendations: ['Nie myć podłóg ani listew przez 14 dni.', 'Moje zalecenie'] });
    expect((await getAppSettings()).recommendations).toEqual(['Moje zalecenie']);
    expect(DEFAULT_APP.recommendations.some((r) => r.includes('14 dni'))).toBe(false);
  });
});
