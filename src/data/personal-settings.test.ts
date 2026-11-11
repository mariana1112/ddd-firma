import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { DEFAULT_APP, getAppSettings, isDeviceMetaKey, saveAppSettings, savePersonalSettings } from './settings';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('ustawienia osobiste', () => {
  it('treści SMS i zalecenia każdy ma swoje; premia i VAT są wspólne dla firmy', async () => {
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
});
