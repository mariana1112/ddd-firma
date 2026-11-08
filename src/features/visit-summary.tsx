import { roman } from '../data/codes';
import { normalizeInterview } from '../data/interview';
import { INVOICES, PAY_NAMES, priceRange, workSummary } from '../data/texts';
import { scopeText, visitPrice } from '../data/visit-terms';
import type { Order, Visit } from '../data/types';
import { formatDate, formatTerm } from '../lib/dates';
import { moneyToInput } from '../lib/money';
import { Group, Info } from '../ui/kit';

const clock = new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit' });

/** „08.11.2026, 10:05–11:20, Maurycy” */
function whenDone(visit: Visit): string {
  const hours = [visit.startedAt, visit.finishedAt].filter((t): t is string => Boolean(t)).map((t) => clock.format(new Date(t)));
  return [formatDate(visit.doneOn ?? visit.start), hours.join('–'), visit.technicianName].filter(Boolean).join(', ');
}

/** Stan kolejnego zabiegu: wykonany, umówiony albo do umówienia. */
function nextLabel(next: Visit): string {
  if (next.status === 'wykonany') return `Wykonany ${formatDate(next.doneOn ?? next.start)}`;
  if (next.status === 'w_trakcie') return 'W trakcie';
  return next.start ? `Umówiony: ${formatTerm(next.start)}` : 'Do umówienia';
}

/**
 * Podsumowanie wykonanego zabiegu, tylko do odczytu. Puste pola są pomijane, więc widać krótko, co zostało zrobione.
 * `short` to wersja do podglądu poprzedniego zabiegu: bez zaleceń w punktach i bez zdjęć.
 */
export function VisitSummary(props: { order: Order; visit: Visit; vatRate: number; later?: Visit; short?: boolean; photos?: React.ReactNode }) {
  const { order, visit, later } = props;
  const i = normalizeInterview(visit.interview);
  const yes = (v: string) => (v === 'tak' ? 'Tak' : v === 'nie' ? 'Nie' : '');
  const agreed = priceRange({ ...visitPrice(visit, order), invoice: order.invoice }, props.vatRate);
  const pay = visit.amount !== null ? `${moneyToInput(visit.amount)} zł${visit.payMethod ? `, ${PAY_NAMES[visit.payMethod]}` : ''}` : 'Nie zapisano';

  return (
    <>
      <Group title={props.short ? undefined : 'Podsumowanie'}>
        <Info label="Wykonano">{whenDone(visit)}</Info>
        <Info label="Co pryskano">{scopeText(visit.scope)}</Info>
        {agreed && <Info label="Ustalona cena">{agreed.net}</Info>}
        <Info label="Płatność">{pay}</Info>
        {order.invoice !== 'brak' && <Info label="Faktura">{INVOICES[order.invoice]}</Info>}
        {visit.bonus > 0 && <Info label="Premia">{`${moneyToInput(visit.bonus)} zł`}</Info>}
        <Info label="Zabieg">{workSummary(visit) || 'Nie zaznaczono'}</Info>
        {i.situation && <Info label="Sytuacja">{i.situation}</Info>}
        {i.bites && <Info label="Ugryzienia">{yes(i.bites)}</Info>}
        {i.seen && <Info label="Owady">{i.seen === 'tak' && i.seenCount ? `Tak, ${i.seenCount}` : yes(i.seen)}</Info>}
        {i.selfTreatment && <Info label="Własne środki">{yes(i.selfTreatment)}</Info>}
        {i.other.trim() && <Info label="Uwagi">{i.other.trim()}</Info>}
        {visit.findings && <Info label="Zastano">{visit.findings}</Info>}
        {visit.problems && <Info label="Problemy">{visit.problems}</Info>}
        {visit.recommendations.length > 0 && (
          <Info label="Zalecenia">{props.short ? `${visit.recommendations.length} dla klienta` : visit.recommendations.map((r) => `• ${r}`).join('\n')}</Info>
        )}
        {later && <Info label={`Zabieg ${roman(later.seq)}`}>{nextLabel(later)}</Info>}
        {order.pink && <Info label="Kod pink">{order.pinkNote || 'Tak'}</Info>}
      </Group>
      {!props.short && props.photos && (
        <Group title="Zdjęcia" plain>
          {props.photos}
        </Group>
      )}
    </>
  );
}
