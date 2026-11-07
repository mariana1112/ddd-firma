# Architektura: Pogromcy Insektów

Stan na 7.11.2026. Aplikacja jest narzędziem technika: zlecenie, zabieg u klienta, dane dla centrali, kilometrówka,
koszty i rozliczenie z szefem. Protokoły i faktury robi centrala, więc aplikacja ich nie tworzy.

## 1. Zasady

- **Local-first.** Każde urządzenie ma pełną kopię swoich danych w IndexedDB i działa bez internetu. Serwer jest warstwą
  synchronizacji, a nie miejscem, bez którego aplikacja nie działa.
- **Jedna droga zapisu.** UI nie pisze do Dexie bezpośrednio. Zapis idzie przez `Repository` (`data/repo.ts`) albo funkcję
  z `data/orders.ts` lub `data/domain.ts`. `Repository` zapisuje w tej samej transakcji dziennik zmian (`changes`), który jest
  kolejką wysyłki na serwer i zawiera wyłącznie zmienione pola.
- **Wartości wyliczane nie są przechowywane.** Raporty, sumy kilometrów i premie liczy się zawsze z rekordów, więc dwa
  urządzenia nie mogą nadpisać sobie liczników.
- **Brak utraty danych.** Migracje Dexie tylko dodają, aplikacja prosi o trwały zapis, pola zabiegu zapisują się w trakcie
  pisania i przy ukryciu aplikacji, a usuwanie jest miękkie z koszem.

## 2. Ekrany

```
Pulpit          /                 kafelki (nowe zlecenie, koszt, przejazd), kilometry miesiąca, dzisiaj,
                                  zaległe, do umówienia, najbliższe 7 dni, wynik tygodnia
Kalendarz       /kalendarz        lista, dzień, tydzień, miesiąc; przeciąganie zmienia termin; klik tworzy zlecenie
Zlecenia        /zlecenia         szukanie po #numerze, nazwisku, telefonie, adresie; filtr statusu, płatności, faktur
  Nowe          /zlecenia/nowe    kreator: adres → problem → termin → cena → klient → podsumowanie
  Szczegóły     /zlecenia/:id     kontakt, zabiegi, dane zlecenia, historia klienta (ten sam telefon lub adres)
  Edycja        /zlecenia/:id/edycja
  Zabieg        /zabieg/:id       rozpoczęcie, płatność, faktura, wywiad, czynności, miejsca, ustalenia,
                                  zdjęcia, kod pink, zakończenie, SMS, dane dla centrali, zmiana terminu, .ics
Raporty         /raporty          dzień, tydzień, miesiąc; rozliczenie tekstowe, PDF; ?technik= dla szefa
Więcej          /wiecej
  Koszty        /koszty           autostrada, parking, paliwo, inne
  Kilometry     /kilometry        przejazdy służbowe i prywatne, wydruk PDF
  Oddziały      /oddzialy         oddziały, technicy, kody zaproszeń, przenoszenie (szef)
  Ustawienia    /ustawienia       imię szefa w rozliczeniu, premia, VAT, zalecenia, czynności, miejsca, SMS
  Konto         /konto            logowanie, firma, oddział, imię, stan synchronizacji
  Kopie         /kopie            eksport i przywracanie, CSV zleceń
  Kosz          /kosz
```

Routing oparty na hashu (`#/...`) działa na GitHub Pages i offline. Każdy ekran podrzędny ma przycisk powrotu, bo
zainstalowana aplikacja na iPhonie nie ma przycisku „wstecz”.

## 3. Model danych

```
orders ─< visits ─< attachments (zdjęcia, recordId = zabieg)
trips                (przejazdy, ownerId)
expenses             (koszty z dnia, ownerId)
meta                 company, app (ustawienia firmy, synchronizowane), profile, sync, dataKey,
                     numbers:*, geo:* (tylko na urządzeniu)
changes              dziennik zmian i kolejka wysyłki
snapshots            migawki przed przywróceniem kopii (tylko lokalnie)
```

- **Order**: numer, właściciel (technik), budynek, adres z lokalem, piętrem, klatką i dojazdem, szkodnik, opis, metraż,
  widełki netto, faktura (`brak` | `imienna` | `vat`), klient, e-mail, NIP, adres do faktury, telefony z dopiskami,
  kod pink, zamknięcie.
- **Visit**: zlecenie, numer kolejny, termin, czas, status (`zaplanowany` | `w_trakcie` | `wykonany` | `odwolany`),
  technik, czas rozpoczęcia i zakończenia, dzień wykonania, płatność, kwota, wywiad, czynności, miejsca, co zastałem,
  problemy, zalecenia, premia.
- **Trip**: dzień, rodzaj (`sluzbowy` | `prywatny`), godziny, skąd, dokąd, cel, licznik przed i po.
- Kwoty to grosze, terminy to czas ścienny Warszawy `YYYY-MM-DDTHH:mm`, znaczniki rekordów w UTC.
- Tabele poprzedniej wersji (klienci, obiekty, preparaty, cennik, protokoły) zostały w schemacie `version(1–4)`, żeby
  aktualizacja nie kasowała danych. Nowy kod z nich nie korzysta.

Rekord bez właściciela (`ownerId`, `technicianId` równe `null`) powstał na urządzeniu przed zalogowaniem i jest liczony
jako należący do jego użytkownika (`ownedBy` w `data/settings.ts`).

## 4. Konta, oddziały i uprawnienia

Logowanie e-mailem i hasłem (min. 12 znaków). Przy rejestracji podaje się imię. Szef tworzy firmę z pierwszym oddziałem,
technik dołącza jednorazowym kodem zaproszenia przypisanym do oddziału.

Serwer (Supabase, Postgres) przechowuje rekordy w jednej tabeli `records` (`org_id`, `tbl`, `id`, `data`, `rev`,
`branch_id`). Uprawnienia egzekwują RLS i funkcje `security definer`:

| Obiekt | Technik | Szef |
| --- | --- | --- |
| `records` odczyt | rekordy swojego oddziału i ustawienia firmy | wszystkie |
| `records` zapis (`sync_push`) | nowe rekordy trafiają do jego oddziału; zmiana tylko rekordów jego oddziału | wszystkie |
| `meta` (ustawienia firmy) | odczyt | zapis |
| `changes` (historia) | brak | odczyt |
| `branches`, `memberships` | swój oddział i jego technicy | wszystkie |
| `invites` | brak dostępu; `join_with_invite` | `create_invite` |
| `reserve_numbers` | tak | tak |
| zdjęcia w magazynie `attachments` | członkowie firmy (pliki zaszyfrowane, ścieżki znają tylko urządzenia widzące rekord) | tak |

Zmiana spoza uprawnień jest przez `sync_push` pomijana, a nie odrzucana, żeby nie zablokować kolejki urządzenia.
Przeniesienie technika do innego oddziału nie przenosi jego wcześniejszych rekordów.

Izolację sprawdza test SQL z trzema tymczasowymi kontami (szef, technik A, technik B w innym oddziale), cofany na końcu:
technik B widzi 1 rekord, 1 członka, 1 oddział, 0 wpisów historii, nie ma dostępu do zaproszeń, nie może zaprosić ani
dołączyć drugi raz, jego próba zmiany rekordu A i ustawień firmy zostaje pominięta. Szef widzi oba rekordy i oba oddziały.

## 5. Synchronizacja

```
UI ──> Repository ──> IndexedDB (rekord) + changes (pushed = 0)
                                   │  przy starcie, po każdej zmianie, po powrocie aplikacji,
                                   │  po odzyskaniu sieci i co 60 s
                                   v
     PUSH: niewysłane zmiany, zaszyfrowane ──> sync_push: uprawnienia, scalanie pól (data || patch), rev
     PULL: rekordy z rev > kursor ──> odszyfrowanie ──> zapis lokalny z nałożeniem niewysłanych zmian
```

- iOS nie obsługuje w PWA synchronizacji w tle, więc działa ona, gdy aplikacja jest otwarta.
- Konflikty: zmiany różnych pól łączą się pole po polu, przy tym samym polu wygrywa później przyjęta przez serwer.
- **Numery zleceń** są wspólne dla firmy. Urządzenie rezerwuje na serwerze (`reserve_numbers`) pulę 20 numerów, gdy zostało
  mu mniej niż 5. Nowe zlecenie bierze numer z puli, więc działa bez internetu. Gdy pula skończy się offline, numeracja
  ciągnie się dalej od ostatniego numeru; serwer przy następnej rezerwacji przeskakuje nad nadanymi numerami.
- `app_config.min_schema` blokuje wysyłanie ze starszych wersji aplikacji, które dalej działają offline.

### Szyfrowanie end-to-end

- Losowy klucz danych firmy (AES-256-GCM) leży na serwerze tylko zawinięty kluczem z hasła szyfrowania
  (PBKDF2-SHA-256, 600 000 iteracji, losowa sól).
- Każde pole rekordu jest szyfrowane osobno (`e1:` + IV + szyfrogram) z danymi dodatkowymi `tabela/rekord/pole`, więc serwer
  łączy pola bez znajomości treści i nie może przestawić wartości między polami. Pliki zdjęć: dane dodatkowe `file/<id>`.
- Urządzenie trzyma klucz jako nieeksportowalny `CryptoKey`. Klucz nie trafia do kopii zapasowych.
- `sync_push` odrzuca każdą wartość, która nie jest szyfrogramem.
- Wszyscy członkowie firmy mają ten sam klucz. Granicę oddziałów wyznacza serwer (RLS), a nie szyfrowanie: szef widzi
  wszystko, a technik dostaje tylko rekordy swojego oddziału. Osobne klucze na oddział wymagałyby ponownego zaszyfrowania
  danych przy przenoszeniu techników i nie są potrzebne przy zaufanej centrali.
- Jawne zostają: nazwy pól, identyfikatory, liczba i czas zmian, nazwy firmy i oddziałów, imiona i e-maile.
- Trwałe usunięcie z kosza czyści rekord, plik zdjęcia i treść jego historii także na serwerze.

## 6. Integracje iPhone'a

Aplikacja internetowa nie wysyła SMS-ów ani nie dzwoni sama. Korzysta z linków systemowych:

| Akcja | Mechanizm |
| --- | --- |
| SMS z przypomnieniem, po zabiegu | `sms:NUMER&body=…` po potwierdzeniu treści; tekst trafia też do schowka |
| Telefon | `tel:` po potwierdzeniu numeru |
| Nawigacja | Google Maps `dir/?api=1&destination=…` z adresem i kodem pocztowym |
| Przypomnienie o zabiegu | plik `.ics` z alarmem, otwierany przez Kalendarz |
| Dane dla centrali, rozliczenie | arkusz udostępniania iOS albo schowek |

Propozycje terminów w kreatorze geokodują samą miejscowość i kod pocztowy (Nominatim, wynik zapamiętany na urządzeniu),
liczą odległość w linii prostej do zleceń z najbliższych 14 dni w promieniu 25 km i szacują dojazd jako
odległość × 1,3 przy 45 km/h. Bez internetu kreator działa bez propozycji.

## 7. Raporty

`data/reports.ts` liczy z rekordów: obrót, płatności według formy, zwroty (autostrada, parking), inne koszty, premię,
kilometry i wynik gotówki dla szefa = gotówka − zwroty − premia − inne koszty. Tekst rozliczenia ma format wysyłany
szefowi i jest sprawdzany testem. PDF raportu i kilometrówki powstaje w `pdf/documents.ts` (pdfmake ładowany przy
pierwszym użyciu, działa offline).

Do zrobienia: wydruk kilometrówki dokładnie według wzoru firmy, gdy będzie dostępne zdjęcie wzoru.

## 8. Testy i publikacja

| Poziom | Narzędzie | Co obejmuje |
| --- | --- | --- |
| Czyste funkcje i dane | Vitest + fake-indexeddb | kwoty, daty, zlecenia, zabiegi, premia, raporty, teksty SMS i dla centrali, propozycje terminów, kosz, kopie, migracje |
| Synchronizacja | Vitest, dwa symulowane urządzenia i serwer w pamięci | scalanie pól, szyfrowanie, numeracja, zdjęcia, trwałe usuwanie |
| PDF | Vitest + pdfmake w Node | raport i kilometrówka z polskimi znakami |
| Uprawnienia serwera | test SQL w Supabase cofany wyjątkiem | izolacja oddziałów (rozdz. 4) |

GitHub Actions uruchamia testy i build przy każdym pushu na `main`, a publikuje na GitHub Pages tylko po zielonych testach.

## 9. Koszty utrzymania

| Pozycja | Koszt |
| --- | --- |
| Hosting aplikacji (GitHub Pages) | 0 zł |
| Supabase, plan darmowy | 0 zł; nieużywany przez tydzień projekt jest wstrzymywany, kopie bazy dopiero w planie płatnym (ok. 25 USD miesięcznie) |
| SMS i telefon | według taryfy telefonu technika |
| Geokodowanie (Nominatim) | 0 zł, z limitem zapytań; wyniki są zapamiętywane |
