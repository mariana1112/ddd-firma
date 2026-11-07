// Wywiad z klientem przy zabiegu. Czyste funkcje, bez bazy danych.
import type { Interview, YesNo } from './types';

export const EMPTY_INTERVIEW: Interview = {
  situation: '',
  bites: '',
  seen: '',
  seenCount: '',
  selfTreatment: '',
  other: '',
};

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

/** „tak” albo „nie”, także z dawnej odpowiedzi tekstowej: „nie” i „brak” to nie, każdy inny opis to tak. */
function yesNo(value: unknown): YesNo {
  const t = text(value).toLowerCase();
  if (!t) return '';
  return /^(nie|brak)\b/.test(t) ? 'nie' : 'tak';
}

/** Dawna odpowiedź tekstowa bez samego „tak” albo „nie”, np. „Tak, na nogach” → „na nogach”. */
const detail = (value: unknown) => text(value).replace(/^(tak|nie)\b[\s,.:;-]*/i, '');

/**
 * Wywiad w obecnej postaci. Dawne pola tekstowe (od kiedy, co się dzieje, gdzie) trafiają do opisu
 * sytuacji, a dawne odpowiedzi tekstowe na pytania tak/nie dają odpowiedź tak/nie. Szczegóły,
 * których nie da się tak zapisać, dopisują się do opisu, więc nic nie ginie.
 */
export function normalizeInterview(raw: unknown): Interview {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const parts: string[] = [];
  if (text(r.situation)) parts.push(text(r.situation));
  if (text(r.what)) parts.push(text(r.what));
  if (text(r.where)) parts.push(`Gdzie: ${text(r.where)}`);
  if (text(r.since)) parts.push(`Od kiedy: ${text(r.since)}`);
  const legacy = !('seenCount' in r);
  if (legacy && detail(r.bites)) parts.push(`Ugryzienia: ${detail(r.bites)}`);
  if (legacy && detail(r.selfTreatment)) parts.push(`Środki na własną rękę: ${detail(r.selfTreatment)}`);
  return {
    situation: parts.join('\n'),
    bites: yesNo(r.bites),
    seen: yesNo(r.seen),
    seenCount: legacy ? detail(r.seen) : text(r.seenCount),
    selfTreatment: yesNo(r.selfTreatment),
    other: typeof r.other === 'string' ? r.other : '',
  };
}
