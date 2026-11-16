import { describe, expect, it } from 'vitest';
import { pendingReportChecks } from './report-checks';
import type { Visit } from './types';

const v = (over: Partial<Visit>) => ({ deletedAt: null, technicianId: 'me', status: 'wykonany', start: null, doneOn: null, amount: 30000, ...over }) as Visit;

describe('raporty do odhaczenia', () => {
  const visits = [
    v({ doneOn: '2026-11-13' }),
    v({ doneOn: '2026-11-13', amount: 20000 }),
    v({ doneOn: '2026-11-16' }),
    v({ status: 'zaplanowany', start: '2026-11-16T15:00' }),
    v({ doneOn: '2026-11-12', technicianId: 'inny' }),
    v({ doneOn: '2026-11-05' }),
  ];
  const mine = (x: Visit) => x.technicianId === 'me';

  it('minione dni i zakończone tygodnie z zabiegami; dziś dopiero po ostatnim zabiegu', () => {
    const list = pendingReportChecks({ visits, mine, today: '2026-11-16', checked: [] });
    expect(list.map((r) => r.id)).toEqual(['tydzien:2026-11-09', 'dzien:2026-11-13', 'tydzien:2026-11-02']);
    expect(list[1].text).toContain('2 zabiegi');
    // Po zakończeniu ostatniego dzisiejszego zabiegu dochodzi raport z dziś.
    const after = pendingReportChecks({ visits: visits.filter((x) => x.status !== 'zaplanowany'), mine, today: '2026-11-16', checked: [] });
    expect(after[0].id).toBe('dzien:2026-11-16');
  });

  it('odhaczone znikają', () => {
    const list = pendingReportChecks({ visits, mine, today: '2026-11-16', checked: ['dzien:2026-11-13', 'tydzien:2026-11-09'] });
    expect(list.map((r) => r.id)).toEqual(['tydzien:2026-11-02']);
  });
});
