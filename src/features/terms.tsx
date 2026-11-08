import { useState } from 'react';
import { priceRange } from '../data/texts';
import type { InvoiceType, ScopeKind } from '../data/types';
import { SCOPE_KINDS, scopeText, type VisitTerms } from '../data/visit-terms';
import { moneyToInput, parseMoney } from '../lib/money';
import { Field } from '../ui/kit';

/** Ustalenia w trakcie edycji: kwoty jako tekst z pola. */
export interface TermsDraft {
  kind: ScopeKind;
  note: string;
  min: string;
  max: string;
}

export function termsDraft(terms: VisitTerms): TermsDraft {
  return {
    kind: terms.scope.kind,
    note: terms.scope.note,
    min: terms.priceMin !== null ? moneyToInput(terms.priceMin) : '',
    max: terms.priceMax !== null ? moneyToInput(terms.priceMax) : '',
  };
}

/** Ustalenia z pól albo null, gdy kwota jest niepoprawna. Jedna kwota (tylko „od” albo tylko „do”) to cena stała. */
export function termsFromDraft(d: TermsDraft): VisitTerms | null {
  const min = d.min.trim() ? parseMoney(d.min) : null;
  const max = d.max.trim() ? parseMoney(d.max) : null;
  if ((d.min.trim() && min === null) || (d.max.trim() && max === null)) return null;
  if (min !== null && max !== null && max < min) return null;
  return { scope: { kind: d.kind, note: d.kind === 'calosc' ? '' : d.note.trim() }, priceMin: min ?? max, priceMax: max ?? min };
}

/** Krótko: „Pokój: sypialnia · 300–400 zł”. */
export function termsText(terms: VisitTerms, invoice: InvoiceType, vatRate: number): string {
  const price = priceRange({ priceMin: terms.priceMin, priceMax: terms.priceMax, invoice }, vatRate);
  return [scopeText(terms.scope), price ? price.net : 'cena do ustalenia'].join(' · ');
}

/** Pola „Co pryskamy” i „Cena” na zabieg. Wartości startowe to propozycja z poprzedniego zabiegu. */
export function TermsFields(props: { value: TermsDraft; onChange: (value: TermsDraft) => void; invoice: InvoiceType; proposedFrom?: string }) {
  const d = props.value;
  const set = (patch: Partial<TermsDraft>) => props.onChange({ ...d, ...patch });
  const min = d.min.trim() ? parseMoney(d.min) : null;
  const max = d.max.trim() ? parseMoney(d.max) : null;
  const minError = d.min.trim() && min === null ? 'Podaj kwotę, np. 300' : undefined;
  const maxError = d.max.trim() && max === null ? 'Podaj kwotę, np. 350' : min !== null && max !== null && max < min ? 'Niższa niż „od”' : undefined;
  const netto = props.invoice === 'vat' ? ' netto' : '';
  return (
    <>
      <div className="field">
        <span className="field-label">Co pryskamy</span>
        <div className="choice">
          {SCOPE_KINDS.map(([kind, label]) => (
            <button key={kind} type="button" className={d.kind === kind ? 'choice-item active' : 'choice-item'} aria-pressed={d.kind === kind} onClick={() => set({ kind })}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {d.kind !== 'calosc' && (
        <Field label={d.kind === 'pokoj' ? 'Który pokój?' : 'Co dokładnie?'}>
          <input value={d.note} placeholder={d.kind === 'pokoj' ? 'Np. sypialnia' : 'Np. kuchnia i łazienka, piwnica'} onChange={(e) => set({ note: e.target.value })} />
        </Field>
      )}
      <div className="form-row">
        <Field label={`Cena od (zł${netto})`} error={minError}>
          <input inputMode="decimal" value={d.min} onChange={(e) => set({ min: e.target.value })} autoComplete="off" />
        </Field>
        <Field label={`do (zł${netto})`} error={maxError}>
          <input inputMode="decimal" value={d.max} onChange={(e) => set({ max: e.target.value })} autoComplete="off" />
        </Field>
      </div>
      {props.proposedFrom && <p className="field-hint">{props.proposedFrom}</p>}
    </>
  );
}

/** Stan pól ustaleń z propozycją startową. */
export function useTermsDraft(initial: VisitTerms) {
  return useState<TermsDraft>(() => termsDraft(initial));
}
