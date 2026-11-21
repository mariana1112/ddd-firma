import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { assignmentText, assignVisit, smsTextUrl, whatsappUrl } from './assign';
import { buildNotifications } from './notifications';
import { createOrder, type OrderDraft } from './orders';
import { orders, visits } from './repo';
import { endSubstitution, getSubstitutions, saveProfile, saveSubstitution, SYNCED_META_KEYS } from './settings';

const draft = {
  building: 'dom', street: 'Długa', houseNo: '5', flatNo: '', floor: '', staircase: '', postalCode: '80-001', city: 'Gdańsk', access: '',
  pest: 'pluskwy', pestOther: '', description: 'Pluskwy w sypialni', areaM2: null, priceMin: 30000, priceMax: 30000, invoice: 'brak',
  clientName: 'Jan', email: '', nip: '', invoiceAddress: '', phones: [{ number: '+48 600 100 200', label: 'pan Jan' }], pink: false, pinkNote: '',
  methods: ['oprysk'],
} as unknown as OrderDraft;

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('przydział technika i powiadomienie', () => {
  it('szef przydziela zabieg; technik dostaje powiadomienie; wiadomość ma termin, adres i link', async () => {
    await saveProfile({ name: 'Piotr Szef', userId: 'szef' });
    const { order, visits: [v] } = await createOrder(draft, { start: '2026-11-25T10:00', durationMin: 60 }, null);
    await assignVisit(v.id, { id: 'ania', name: 'Anna Nowak' });
    const fresh = (await visits.get(v.id))!;
    expect(fresh.assignedName).toBe('Anna Nowak');
    expect(fresh.assignedById).toBe('szef');

    const input = { orders: await orders.all(), deletedOrders: [], visits: await visits.all(), messages: [], channels: [], read: {}, today: '2026-11-20', owner: false };
    const forAnia = buildNotifications({ ...input, me: 'ania' }).filter((n) => n.kind === 'przydzial');
    expect(forAnia).toHaveLength(1);
    expect(forAnia[0].title).toContain(String(order.number).padStart(4, '0'));
    expect(buildNotifications({ ...input, me: 'szef' }).filter((n) => n.kind === 'przydzial')).toHaveLength(0);

    const text = assignmentText(order, fresh, 'Anna Nowak');
    expect(text).toContain('Cześć Anna!');
    expect(text).toContain('25.11.2026');
    expect(text).toContain('Długa 5');
    expect(text).toContain(`#/zabieg/${v.id}`);
    expect(whatsappUrl(text)).toMatch(/^https:\/\/wa\.me\/\?text=/);
    expect(smsTextUrl(text)).toMatch(/^sms:\?&body=/);
    // Technik z innego regionu (tylko to zlecenie): nie otworzy zlecenia w aplikacji, więc dostaje dane, nie odnośnik.
    const outside = assignmentText({ ...order, clientName: 'Jan Kowalski', access: 'Domofon 12' }, fresh, 'Anna Nowak', true);
    expect(outside).toContain('Nazwisko: Jan Kowalski');
    expect(outside).toContain('Jak dotrzeć: Domofon 12');
    expect(outside).not.toContain('#/zabieg/');

    await assignVisit(v.id, null);
    expect((await visits.get(v.id))!.assignedId).toBeNull();
  });

  it('zastępstwo pamięta region domowy (także przy kolejnym przeniesieniu) i znika po zakończeniu', async () => {
    expect(SYNCED_META_KEYS).toContain('substitutions');
    await saveSubstitution({ userId: 'ania', name: 'Ania', home: 'ldz', homeName: 'Łódzkie', to: 'gda', toName: 'Pomorskie', since: '2026-11-20T08:00:00Z' });
    await saveSubstitution({ userId: 'ania', name: 'Ania', home: 'gda', homeName: 'Pomorskie', to: 'waw', toName: 'Mazowieckie', since: '2026-11-22T08:00:00Z' });
    const [s] = await getSubstitutions();
    expect([s.home, s.to]).toEqual(['ldz', 'waw']);
    await endSubstitution('ania');
    expect(await getSubstitutions()).toEqual([]);
  });
});
