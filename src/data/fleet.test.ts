import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { forgetVehicle, getVehicle, getVehicles, isDeviceMetaKey, saveVehicle, switchVehicle } from './settings';

describe('kilka aut na jednym telefonie', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('dodane auto zostaje wybrane do zmiany; przesiadka i usuwanie z listy', async () => {
    await saveVehicle({ plate: 'GD 1234A', driver: 'Maurycy', base: 'Gdańsk' });
    expect(await getVehicles()).toEqual([{ plate: 'GD 1234A', driver: 'Maurycy' }]);
    await saveVehicle({ plate: 'GA 99X', driver: 'Maurycy', base: 'Gdańsk' });
    expect((await getVehicles()).map((v) => v.plate)).toEqual(['GA 99X', 'GD 1234A']);
    expect((await getVehicle()).plate).toBe('GA 99X');
    // Przesiadka (zapis numeru bez spacji też trafia w to samo auto); baza zostaje.
    await switchVehicle('gd1234a');
    expect(await getVehicle()).toEqual({ plate: 'GD 1234A', driver: 'Maurycy', base: 'Gdańsk' });
    // Wybranego auta nie da się usunąć, innego tak.
    await expect(forgetVehicle('GD 1234A')).rejects.toThrow('wybrane');
    await forgetVehicle('GA 99X');
    expect((await getVehicles()).map((v) => v.plate)).toEqual(['GD 1234A']);
    await expect(switchVehicle('GA 99X')).rejects.toThrow('Nie ma takiego auta');
    // Lista aut należy do telefonu: nie trafia na serwer ani do kopii firmy.
    expect(isDeviceMetaKey('vehicles')).toBe(true);
  });
});
