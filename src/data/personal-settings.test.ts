import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { DEFAULT_APP, getAppSettings, isDeviceMetaKey, saveAppSettings, savePersonalSettings, type AppSettings } from './settings';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('ustawienia osobiste', () => {
  it('treści SMS i zalecenia każdy ma swoje; premia jest wspólna dla firmy', async () => {
    await saveAppSettings({ ...DEFAULT_APP, thirdVisitBonus: 7000, lateTemplate: 'firmowy' });
    // Pola osobiste nie trafiają do wspólnych ustawień firmy.
    expect(((await db.meta.get('app'))?.value as Record<string, unknown>).lateTemplate).toBeUndefined();
    await savePersonalSettings({ ...DEFAULT_APP, lateTemplate: 'Będę {minuty} min później', recommendations: ['Moje zalecenie'] });
    const s = await getAppSettings();
    expect(s.thirdVisitBonus).toBe(7000);
    expect(s.lateTemplate).toBe('Będę {minuty} min później');
    expect(s.recommendations).toEqual(['Moje zalecenie']);
    // Tylko na tym telefonie: poza synchronizacją i kopią zapasową.
    expect(isDeviceMetaKey('myApp')).toBe(true);
  });

  it('rozliczenie (z kim gotówka, VAT) każdy ustawia sobie sam, premię ustala admin', async () => {
    await saveAppSettings({ ...DEFAULT_APP, thirdVisitBonus: 6000, bossName: 'Piotrka', vatRate: 23 });
    await savePersonalSettings({ ...DEFAULT_APP, thirdVisitBonus: 100, bossName: 'Ani', vatRate: 8 } as AppSettings);
    const s = await getAppSettings();
    expect(s.bossName).toBe('Ani');
    expect(s.vatRate).toBe(8);
    expect(s.thirdVisitBonus).toBe(6000);
    // Zapis ustawień firmy nie nadpisuje rozliczenia innych osób.
    expect(((await db.meta.get('app'))?.value as Record<string, unknown>).bossName).toBeUndefined();
  });
});
