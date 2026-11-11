import { useLiveQuery } from 'dexie-react-hooks';
import { firstName } from '../data/texts';
import { Link } from 'react-router-dom';
import { cardText, formatAccount, formatNip, transferText } from '../data/card';
import { getCompany, getMyPhone, getProfile } from '../data/settings';
import { Icon } from '../ui/icons';
import { Group, Loading, Page } from '../ui/kit';
import { useContactActions } from './common';

/** Wiersz z wartością i przyciskiem „Kopiuj”. */
export function CopyRow(props: { label: string; value: string; copyValue?: string }) {
  const { copy } = useContactActions();
  return (
    <div className="copy-row">
      <span className="copy-row-text">
        <span className="info-label">{props.label}</span>
        <strong className="copy-row-value">{props.value}</strong>
      </span>
      <button type="button" className="btn btn-sm" onClick={() => void copy(props.copyValue ?? props.value)}>
        <Icon name="copy" /> Kopiuj
      </button>
    </div>
  );
}

/**
 * Wizytówka: dane do przelewu, numer do BLIK-a i numer technika, do skopiowania albo wysłania klientowi.
 * Dane firmy ustawia admin w Ustawieniach, a numer technika każdy na swoim telefonie.
 */
export function CardPage() {
  const { copy, share } = useContactActions();
  const data = useLiveQuery(async () => ({ company: await getCompany(), profile: await getProfile(), phone: await getMyPhone() }));
  if (!data) return <Loading />;
  const { company, profile, phone } = data;
  const recipient = company.taxpayerName?.trim() || company.name;
  const hasTransfer = Boolean(company.bankAccount.trim());
  const blik = company.blikPhone?.trim() ?? '';
  // Wizytówka dla klienta: samo imię technika.
  const card = { company, name: firstName(profile.name), phone };

  return (
    <Page title="Wizytówka" back="/wiecej">
      <div className="card-hero">
        <h2>{company.name}</h2>
        {profile.name && <p>{firstName(profile.name)}</p>}
        {phone ? (
          <a className="card-phone" href={`tel:${phone.replace(/[^\d+]/g, '')}`}>
            <Icon name="phone" size={18} /> {phone}
          </a>
        ) : (
          <Link className="link" to="/ustawienia">
            Ustaw swój numer telefonu
          </Link>
        )}
      </div>

      <Group title="Przelew">
        {hasTransfer ? (
          <>
            <CopyRow label="Odbiorca" value={recipient} />
            {company.nip.trim() && <CopyRow label="NIP" value={formatNip(company.nip)} copyValue={company.nip.replace(/\D/g, '')} />}
            <CopyRow label="Numer konta" value={formatAccount(company.bankAccount)} copyValue={company.bankAccount.replace(/\s/g, '')} />
          </>
        ) : (
          <p className="field-hint copy-hint">Brak numeru konta. Admin wpisuje go w Ustawieniach, w danych firmy.</p>
        )}
      </Group>
      {hasTransfer && (
        <button type="button" className="btn btn-block" onClick={() => void copy(transferText(company))}>
          <Icon name="copy" /> Kopiuj wszystkie dane do przelewu
        </button>
      )}

      <Group title="BLIK na telefon">
        {blik ? (
          <CopyRow label="Numer do BLIK-a" value={blik} copyValue={blik.replace(/\s/g, '')} />
        ) : (
          <p className="field-hint copy-hint">Brak numeru do BLIK-a. Admin wpisuje go w Ustawieniach.</p>
        )}
      </Group>

      <Group title="Mój numer (na tym telefonie)">
        {phone ? (
          <CopyRow label="Numer technika" value={phone} copyValue={phone.replace(/\s/g, '')} />
        ) : (
          <p className="field-hint copy-hint">
            Ustaw swój numer w <Link to="/ustawienia">Ustawieniach</Link>, w sekcji „Region i kody zleceń”.
          </p>
        )}
      </Group>

      <button type="button" className="btn btn-primary btn-block" onClick={() => void share(cardText(card), `Wizytówka ${company.name}`)}>
        <Icon name="share" /> Wyślij wizytówkę klientowi
      </button>
    </Page>
  );
}
