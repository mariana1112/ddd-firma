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
                                  zdjęcia, kod pink, zakończenie, SMS, „Zapisz i wyjdź”, zmiana terminu, .ics
Raporty         /raporty          dzień, tydzień, miesiąc; rozliczenie tekstowe, PDF; ?technik= dla szefa
Więcej          /wiecej
  Koszty        /koszty           inne koszty z własną nazwą, np. paliwo, zaliczka
  Kilometry     /kilometry        auto i kierowca, przejazdy, ewidencja VAT i prywatne (PDF)
  Oddziały      /oddzialy         oddziały, technicy, kody zaproszeń, zgody, przenoszenie (szef)
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
  technik, czas rozpoczęcia i zakończenia, dzień wykonania, płatność, kwota, wywiad (opis sytuacji, odpowiedzi tak/nie,
  liczba owadów, inne uwagi), czynności, miejsca, zalecenia, premia. Pola „co zastałem” i „problemy” zostały w modelu
  dla dawnych zabiegów, ale ekran ich już nie pokazuje; dane dla centrali zawierają je tylko, gdy są wypełnione.
- **Trip**: dzień, rodzaj (`sluzbowy` | `prywatny`), godziny, skąd, dokąd, cel, licznik przed i po.
- Kwoty to grosze, terminy to czas ścienny Warszawy `YYYY-MM-DDTHH:mm`, znaczniki rekordów w UTC.
- Tabele poprzedniej wersji (klienci, obiekty, preparaty, cennik, protokoły) zostały w schemacie `version(1–4)`, żeby
  aktualizacja nie kasowała danych. Nowy kod z nich nie korzysta.

Rekord bez właściciela (`ownerId`, `technicianId` równe `null`) powstał na urządzeniu przed zalogowaniem i jest liczony
jako należący do jego użytkownika (`ownedBy` w `data/settings.ts`).

## 4. Konta, oddziały i uprawnienia

Logowanie e-mailem i hasłem (min. 12 znaków). Przy rejestracji podaje się imię. Szef tworzy firmę z pierwszym oddziałem.

Technik dołącza w trzech krokach (migracja `20261107000100_bezpieczne_dolaczanie.sql`):

1. Kod zaproszenia: 10 znaków z alfabetu bez 0/O/1/I/L, losowany na urządzeniu szefa, jednorazowy, 14 dni.
   `invite_preview` zwraca nazwę firmy, oddziału i klucz zawinięty hasłem.
2. Hasło szyfrowania: urządzenie odwija klucz i liczy dowód `AES-GCM(klucz, IV = SHA-256("invite-iv/" + kod)[0..12],
   dane dodatkowe "invite/" + kod, 16 bajtów zer)`. Urządzenie szefa przy tworzeniu kodu zapisuje na serwerze
   `sha256(dowód)`, a `join_with_invite` porównuje skróty. Serwer nie zna hasła ani klucza. Zły dowód zwiększa licznik
   prób (zwraca null, bo wyjątek cofnąłby licznik). Po 5 próbach kod nie działa.
3. Zgoda szefa: członkostwo powstaje z `approved = false`. `private.is_member` i `private.has_role` wymagają
   `approved`, więc konto przed zgodą nie czyta rekordów, firmy ani innych członków i nie zapisuje. Szef zatwierdza
   (`approve_member`) albo odrzuca (`remove_member`, ta sama funkcja usuwa technika z firmy; szefa usunąć nie można).

Serwer (Supabase, Postgres) przechowuje rekordy w jednej tabeli `records` (`org_id`, `tbl`, `id`, `data`, `rev`,
`branch_id`). Uprawnienia egzekwują RLS i funkcje `security definer`:

| Obiekt | Technik | Szef |
| --- | --- | --- |
| `records` odczyt | rekordy swojego oddziału i ustawienia firmy | wszystkie |
| `records` zapis (`sync_push`) | nowe rekordy trafiają do jego oddziału; zmiana tylko rekordów jego oddziału | wszystkie |
| `meta` (ustawienia firmy) | odczyt | zapis |
| `changes` (historia) | brak | odczyt |
| `branches`, `memberships` | swój oddział i jego technicy | wszystkie |
| `invites` | brak dostępu; `invite_preview`, `join_with_invite` | `create_invite` |
| zgody i usuwanie (`approve_member`, `remove_member`) | brak | tak |
| `reserve_numbers` | tak | tak |
| zdjęcia w magazynie `attachments` | członkowie firmy (pliki zaszyfrowane, ścieżki znają tylko urządzenia widzące rekord) | tak |

Zmiana spoza uprawnień jest przez `sync_push` pomijana, a nie odrzucana, żeby nie zablokować kolejki urządzenia.
Przeniesienie technika do innego oddziału nie przenosi jego wcześniejszych rekordów.

Izolację sprawdza test SQL z trzema tymczasowymi kontami (szef, technik A, technik B w innym oddziale), cofany na końcu:
technik B widzi 1 rekord, 1 członka, 1 oddział, 0 wpisów historii, nie ma dostępu do zaproszeń, nie może zaprosić ani
dołączyć drugi raz, jego próba zmiany rekordu A i ustawień firmy zostaje pominięta. Szef widzi oba rekordy i oba oddziały.

Dołączanie sprawdza drugi taki test: obcy z samym kodem widzi nazwę firmy, ale bez hasła zostaje odrzucony; po 5 złych
próbach kod nie działa nawet z dobrym hasłem; technik z kodem i hasłem przed zgodą widzi 0 rekordów, 0 firm i tylko
swoje członkostwo, nie zapisuje i nie zatwierdza sam siebie; po zgodzie widzi rekordy, a po usunięciu z firmy znowu 0.
Technik nie usunie szefa, szef nie usunie siebie. Zgodność skrótu dowodu z przeglądarki i z Postgresa sprawdzono na
prawdziwym kodzie, usuniętym po teście.

### Regiony i panel admina

- Region to oddział na serwerze (`branches`). Pobierany rekord dostaje lokalnie `branchId` z kolumny `records.branch_id`;
  pole nie trafia do dziennika zmian, więc nie wraca na serwer. Urządzenia sprzed tej wersji pobierają jednorazowo
  wszystko od nowa (`regionsTagged` w stanie synchronizacji).
- `data/scope.ts`: `Repository.all()` zwraca rekordy z regionu, który pokazują ekrany: własny region konta
  (domyślnie), wybrany region albo całą firmę (panel admina). Rekord bez znacznika (jeszcze niewysłany) należy do
  regionu urządzenia. `allRegions()` pomija filtr. Technik dostaje z serwera tylko swój region, więc filtr niczego mu
  nie ukrywa; granicę między regionami wyznacza RLS.
- Nazwy i prefiksy regionów są we wspólnych ustawieniach firmy (`meta.regions`, zmienia tylko admin). Nowe zlecenie
  bierze prefiks regionu konta; prefiks z ustawień urządzenia zostaje dla pracy bez konta firmowego.
- Panel admina (`features/admin.tsx`) wymaga konta z rolą `owner` i ponownego podania loginu i hasła (sprawdzane przez
  Supabase Auth, tylko dla e-maila konta zalogowanego na urządzeniu); odblokowanie trwa 15 minut od ostatniego użycia
  i nie przetrwa zamknięcia aplikacji. Ekrany techników w panelu (`/admin/zlecenia` itd.) to te same komponenty
  z zakresem regionu z adresu. `data/company.ts` liczy raport każdego regionu, ranking (obrót, potem wynik gotówki)
  i tekst podsumowania firmy.

### Konto admina: zmiana danych i odzyskiwanie

- Login i hasło admina obsługuje Supabase Auth; aplikacja ich nie przechowuje. Zmiana hasła wymaga obecnego hasła
  (ponowne `signInWithPassword`), zmiana e-maila idzie przez link potwierdzający.
- „Nie pamiętam hasła”: `resetPasswordForEmail` z powrotem na adres aplikacji. `lib/auth-link.ts` przechwytuje link
  (`#access_token=…&type=recovery`) przed routerem, przenosi tokeny do `sessionStorage` i otwiera
  `/admin/odzyskiwanie`. Link innego konta niż zalogowane na urządzeniu jest odrzucany przed użyciem tokenu.
- Pytania pomocnicze (migracja `20261109000000_odzyskiwanie_admina.sql`): skróty bcrypt w `private.recovery_answers`,
  dostęp tylko przez `recovery_status`, `set_recovery_answers`, `verify_recovery_answers`. `private.has_role` nie
  uznaje roli owner, gdy `auth.users.recovery_sent_at` jest późniejsze niż ostatnie potwierdzenie pytaniami, więc
  przejęta skrzynka e-mail nie daje dostępu do całej firmy. Pytań nie da się zmienić w czasie takiej blokady.
  Po potwierdzeniu urządzenie pobiera dane od nowa (w czasie blokady widziało tylko swój region).
- Aplikacja działa też przed wykonaniem migracji: brak funkcji na serwerze znaczy „pytania nieustawione”.
- Test SQL z tymczasowymi kontami (cofany): za krótka odpowiedź odrzucona; odpowiedź z inną wielkością liter i spacjami
  przyjęta; po prośbie o reset konto traci rolę admina (zostaje członkiem), nie może podmienić pytań, a po poprawnej
  odpowiedzi rolę odzyskuje; po 5 złych odpowiedziach nawet dobra jest blokowana; inne konto nie czyta tabeli odpowiedzi.

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
- **Kod zlecenia** (`data/codes.ts`) to prefiks regionu z ustawień urządzenia (meta `region`), zapisany w zleceniu
  przy przyjęciu (`order.prefix`), i numer dopełniony do czterech cyfr: `LDZ-0210`. Kod zabiegu dopisuje numer rzymski:
  `LDZ-0210/II`. Numer jest unikalny w firmie, więc kod też, niezależnie od prefiksu. Zlecenia sprzed prefiksu mają sam
  numer (`0210`), a przy zapisie prefiksu ustawienia proponują nadanie go własnym starszym zleceniom.
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

`data/reports.ts` liczy z rekordów: obrót, płatności według formy, koszty zsumowane według nazwy (dawne koszty „Inne”
mają nazwę w opisie), premię, kilometry i wynik gotówki dla szefa = gotówka − koszty − premie. Dzień rozpisuje zabiegi
z adresem według formy płatności, tydzień kwoty według dni, miesiąc kwoty według tygodni (od poniedziałku, przycięte
do miesiąca, z zakresem dni, w których była praca). Tekst rozliczenia ma format wysyłany
szefowi i jest sprawdzany testem. PDF raportu i kilometrówki powstaje w `pdf/documents.ts` (pdfmake ładowany przy
pierwszym użyciu, działa offline).

### Kilometrówka

Przejazd zapisuje numer rejestracyjny i kierowcę z ustawień urządzenia (`vehicle` w meta, nie synchronizowane), więc
zmiana auta nie zmienia starych wpisów. Licznik startowy to stan po ostatnim przejeździe tym autem w oddziale.
`data/mileage.ts` buduje wpisy ewidencji: przejazdy z jednego dnia, auta i kierowcy, idące po sobie bez przerwy w liczniku,
łączą się w jeden wpis z trasą „Łódź - Kutno - Łódź”. `mileageDocument` odwzorowuje urzędowy wzór „Ewidencja przebiegu
pojazdu dla celów VAT”: nagłówek z danymi podatnika (adres i NIP z ustawień firmy), numerem rejestracyjnym, dniem
rozpoczęcia i zakończenia (pierwszy i ostatni dzień miesiąca), stanami licznika i sumą km; miesiąc rzymski, 17 wpisów
na pierwszej stronie i 23 na kolejnych, podsumowanie strony, z przeniesienia, razem, przypisy. Każdy wpis służbowy ma cel
„SŁUŻBOWO”. Prywatne przejazdy drukują się w tym samym układzie na osobnych kartkach z dopiskiem „do wglądu
pracodawcy” i stroną z zestawieniem kilometrów kierowców. Test odtwarza październik z wypełnionego ręcznie wzoru:
25 wpisów, strony 3217 i 2331 km, razem 5548 km.

## 8. Testy i publikacja

| Poziom | Narzędzie | Co obejmuje |
| --- | --- | --- |
| Czyste funkcje i dane | Vitest + fake-indexeddb | kwoty, daty, zlecenia, zabiegi, premia, raporty, teksty SMS i dla centrali, propozycje terminów, kosz, kopie, migracje |
| Synchronizacja | Vitest, dwa symulowane urządzenia i serwer w pamięci | scalanie pól, szyfrowanie, numeracja, zdjęcia, trwałe usuwanie |
| PDF | Vitest + pdfmake w Node | raport, ewidencja VAT według wzoru (sumy stron), prywatne z zestawieniem |
| Uprawnienia serwera | test SQL w Supabase cofany wyjątkiem | izolacja oddziałów (rozdz. 4) |

GitHub Actions uruchamia testy i build przy każdym pushu na `main`, a publikuje na GitHub Pages tylko po zielonych testach.

## 9. Koszty utrzymania

| Pozycja | Koszt |
| --- | --- |
| Hosting aplikacji (GitHub Pages) | 0 zł |
| Supabase, plan darmowy | 0 zł; nieużywany przez tydzień projekt jest wstrzymywany, kopie bazy dopiero w planie płatnym (ok. 25 USD miesięcznie) |
| SMS i telefon | według taryfy telefonu technika |
| Geokodowanie (Nominatim) | 0 zł, z limitem zapytań; wyniki są zapamiętywane |
