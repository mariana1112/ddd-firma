# Pogromcy Insektów

Aplikacja PWA dla techników firmy Pogromcy Insektów: zlecenia, zabiegi u klienta, kilometrówka, koszty z dnia
i rozliczenia tygodniowe. Wszystkie dane są zapisane na urządzeniu w IndexedDB, a aplikacja działa bez internetu.
Synchronizacja z kontem przenosi dane między urządzeniami i technikami oddziału, a na serwer trafiają wyłącznie
zaszyfrowane.

## Co potrafi

- **Kreator zlecenia** krok po kroku (jedna ścieżka):
  - adres z rodzajem budynku: dom, bliźniak albo blok (w bloku lokal, piętro i klatka) oraz opis dojazdu; miejscowość
    poprawia się sama („gdansk” → „Gdańsk”),
  - co robimy (oprysk ciśnieniowy, ULV, zamgławianie, żelowanie, zalanie odpływów; od tego zależą zalecenia, przy ULV i zamgławianiu
    zawsze widać uwagę o opuszczeniu lokalu i sprzątaniu), szkodnik, metraż i kod pink,
  - termin z czasem zabiegu i propozycjami blisko innych zleceń z szacowanym dojazdem; o kolejnym zabiegu decyduje się
    przy zakończeniu pierwszego,
  - widełki cenowe (przy fakturze VAT netto i brutto), faktura i protokół,
  - klient wpisywany przy zleceniu, bez bazy klientów: telefony z dopiskiem, e-mail i NIP.
  Obowiązkowe: adres (ulica, numer, miejscowość), co robimy, data, widełki i telefon; bez nich zlecenia nie da się
  zapisać. O puste nieobowiązkowe pola (numer lokalu, nazwisko) aplikacja tylko pyta.
- **Lista zleceń**: każdy zabieg osobno (tylko jego termin, stan i płatność), albo „Połącz w zlecenia” w „Więcej
  filtrów”. Filtry: Wszystkie, Do zrobienia, Zakończone, Pilne (na czerwono: niedokończony, bez płatności, zaległy
  termin), Archiwum (także odwołane zabiegi). Szukanie po „fv23” (faktura VAT), „fv” (imienna) i „prot” (protokół).
- **Płatność przy zabiegu jest wymagana**: przyciski formy płatności są szare, wybrany świeci na zielono. „Zakończ
  zabieg” bez formy płatności albo kwoty podświetla płatność na czerwono i przewija do niej; „Później” kończy zabieg
  i wrzuca go do **Pilnych** (Pulpit i filtr na liście zleceń), dopóki płatność nie zostanie uzupełniona.
- **Odwołanie**: zabieg („Odwołaj zabieg”) albo całe zlecenie („Odwołaj zlecenie”) trafia do **archiwum** (filtr na
  liście zleceń), skąd można je przywrócić; trwałe usunięcie idzie dalej przez kosz.
- **Nawigacja**: „Nawiguj” daje wybór mapy (na iPhonie aplikacja Google Maps i Apple Mapy), z pełnym adresem,
  kodem i krajem. Przy adresie można sprawdzić adres w Google Maps i wkleić link do miejsca; wtedy nawigacja prowadzi
  dokładnie tam. Formularz (także edycja) zapamiętuje dane, więc wyjście do map ich nie gubi.
- **Wizytówka** (kafelek na Pulpicie i Więcej): dane do przelewu (odbiorca, NIP, numer konta), numer do BLIK-a i numer
  technika na tym telefonie, każde z „Kopiuj”, oraz „Wyślij wizytówkę klientowi”. Przy płatności przelewem albo BLIK-iem
  na ekranie zabiegu od razu widać numer do skopiowania. Dane firmy ustawia admin w Ustawieniach, a swój numer każdy
  u siebie.
- **Gdy dzwoni klient**: pole „Kto dzwoni?” na Pulpicie szuka we wszystkich zleceniach, także zakończonych, po numerze
  telefonu w dowolnym zapisie (+48, spacje, myślniki, fragment), nazwisku, adresie albo kodzie. Telefon klienta jest widoczny
  na liście zleceń, na Pulpicie i w kalendarzu.
- Niedokończony kreator zostaje zapamiętany. Każde zlecenie ma kod z prefiksem regionu i czterocyfrowym numerem, np. `LDZ-0210`;
  zabiegi mają ten sam kod z numerem rzymskim: `LDZ-0210/I`, `LDZ-0210/II`. Prefiks ustawia się w Ustawieniach
  (osobno na każdym urządzeniu), a numery nie powtarzają się w całej firmie.
- **Zabieg u klienta**:
  - przycisk rozpoczęcia, płatność z kolorami (gotówka, BLIK, przelew), zmiana faktury,
  - wywiad zapisywany na bieżąco, który nie znika po zamknięciu aplikacji: opis sytuacji, ugryzienia, widziane owady
    (z liczbą), środki użyte na własną rękę (tak/nie) i inne uwagi,
  - wykonane czynności i miejsca, zdjęcia, historia zabiegów u tego klienta,
  - kod pink z opisem „co i jak”, który pojawia się po zaznaczeniu.
- **Zakończenie zabiegu**:
  - zalecenia z szablonów i SMS do klienta z podsumowaniem „Oprysk ciśnieniowy (listwy, kratka, łóżka)”,
  - drugi albo trzeci zabieg, a za trzeci umówiony przez technika premia 50 zł,
  - przy każdym zabiegu: co pryskamy (całe mieszkanie, pokój, inne) i ustalona cena, z podpowiedzią z poprzedniego
    zabiegu; przed zabiegiem można to zmienić („Zmień” na ekranie zabiegu), a kolejny zabieg umawia się też ze zlecenia,
  - przycisk „Zapisz i wyjdź” po zabiegu; wszystkie pola zapisują się na bieżąco, przycisk wraca do zlecenia.
- **Kontakt z klientem**:
  - nawigacja w Google Maps, telefon,
  - SMS z przypomnieniem i prośbą o potwierdzenie, z potwierdzeniem przed wysłaniem,
  - wpis do kalendarza iPhone'a z alarmem.
- **Kalendarz** z przesuwaniem zabiegów oraz lista zleceń:
  - wyszukiwanie po `#numerze`, nazwisku, telefonie i adresie,
  - filtr płatności i „Tylko faktury”.
- **Kilometrówka**:
  - przejazdy służbowe i prywatne z godzinami, trasą (skąd, przez, dokąd) i stanem licznika,
  - numer rejestracyjny auta i kierowca ustawiane raz, do zmiany, i zapisywane przy każdym przejeździe,
  - wydruk **Ewidencji przebiegu pojazdu dla celów VAT** według urzędowego wzoru: osobno dla każdego auta, każdy
    wpis jako „SŁUŻBOWO”, przejazdy z jednego dnia połączone w jeden wpis z całą trasą, 17 wpisów na pierwszej
    stronie i 23 na kolejnych, z podsumowaniem strony, przeniesieniem i stanami licznika,
  - przejazdy prywatne na osobnych kartkach, tylko do wglądu pracodawcy, z zestawieniem kilometrów kierowców,
  - szef wybiera kierowcę albo wszystkich kierowców naraz.
- **Koszty z dnia**: jedna kategoria „inne koszty” z nazwą wpisywaną przy każdym koszcie (podpowiedzi: paliwo,
  parking, autostrada, zaliczka, utrzymanie auta).
- **Raporty dzienne, tygodniowe i miesięczne** w formacie rozliczenia wysyłanego szefowi, do skopiowania, wysłania
  albo PDF. Koszty i premie zawsze pomniejszają gotówkę dla szefa.
  - dzień: kwoty według formy płatności i każdy zabieg z adresem, koszty odjęte przy gotówce,
  - tydzień: kwoty według dni tygodnia, koszty z premią i wynik gotówki,
  - miesiąc: kwoty według tygodni miesiąca, koszty z premiami i wynik gotówki.
- **Regiony** (oddziały na serwerze), każdy z własnym prefiksem kodów zleceń: technik jest na stałe zalogowany do swojego
  regionu i nie widzi innych. Admin (szef) w zwykłych ekranach widzi tylko swój region, a wszystko w **panelu admina**.
- **Panel admina** (Więcej → Panel admina, login i hasło konta admina, odblokowany na 15 minut): cała firma albo wybrany
  region; zlecenia, kalendarz, raporty w formacie technika (dzień, tydzień, miesiąc, PDF), kilometrówka i koszty
  regionu; podsumowanie firmy z łącznymi kosztami i kilometrami oraz ranking regionów do wysłania; dodawanie regionów,
  prefiksy, technicy i zaproszenia, ustawienia firmy.
- **Bezpieczeństwo danych**: kopie zapasowe, scalanie, migawki przed przywróceniem, kosz, cofanie usunięć.

Aplikacja **nie wystawia faktur ani protokołów**. Robi to centrala na podstawie danych z zabiegu.

## Uruchomienie

Wymagany Node.js 22 lub nowszy.

```bash
npm install
```

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run build
```

`npm run preview` uruchamia zbudowaną wersję razem z service workerem.

## Konta, regiony i synchronizacja

Bez konfiguracji serwera aplikacja działa wyłącznie lokalnie. Po zalogowaniu dane są na każdym urządzeniu i w zaszyfrowanej
kopii na serwerze Supabase. Zmiany przechodzą przy otwarciu aplikacji, po każdej zmianie i co minutę. Praca bez internetu
działa bez zmian, a zmiany czekają w kolejce. Opis rozwiązania: [docs/ARCHITEKTURA.md](docs/ARCHITEKTURA.md).

**Admin (szef)** zakłada konto z imieniem, tworzy firmę z pierwszym regionem i ustawia hasło szyfrowania. W **panelu
admina** dodaje regiony i nadaje im prefiksy (np. GDA dla pomorskiego), a w „Technicy i zaproszenia” przenosi techników,
usuwa ich z firmy i tworzy kod zaproszenia do wybranego regionu. Prefiks regionu trafia sam do każdego nowego zlecenia
technika z tego regionu.

**Login i hasło admina** nie są zapisane w aplikacji ani w repozytorium: sprawdza je Supabase Auth (hasło tylko jako
skrót). W panelu admina, w „Login, hasło i pytania pomocnicze”, admin zmienia e-mail (z linkiem potwierdzającym), hasło
(z podaniem obecnego, co najmniej 12 znaków) i odpowiedzi na trzy pytania pomocnicze (ulubiona gra, nazwisko panieńskie
matki, imię pierwszego psa; wielkość liter bez znaczenia, na serwerze tylko skróty bcrypt).

**Odzyskiwanie hasła admina**: „Nie pamiętam hasła” na ekranie logowania do panelu wysyła link na e-mail admina. Link
otwiera w aplikacji ekran: najpierw pytania pomocnicze, potem nowe hasło. Pytania pilnuje serwer: po każdej prośbie
o reset konto traci uprawnienia admina (widzi tylko swój region), dopóki ktoś nie odpowie poprawnie; po 5 błędnych
odpowiedziach pytania blokują się na godzinę. Wymaga migracji `20261109000000_odzyskiwanie_admina.sql`.

**Logowanie przed użyciem**: bez konta firmy aplikacja pokazuje tylko ekran logowania.

**Zarejestrowane konta** (panel admina): lista wszystkich kont z rolą, regionami i stanem. Admin przyjmuje prośby,
zawiesza konto (zostaje w firmie, ale nie widzi ani nie zapisuje danych), przywraca je i usuwa konto z firmy
i z logowania. Siebie nie zawiesi ani nie usunie. Wymaga migracji `20261112000000_zawieszanie_kont.sql`.

**Hasła zapamiętane na telefonie** (panel admina): admin może zapamiętać hasło do panelu (wpisuje się samo przy logowaniu, pole „Zapamiętaj hasło”) i hasło szyfrowania (wpisuje się samo przy generowaniu kodów) oraz podejrzeć je i skopiować w panelu. Zapisy są tylko na tym urządzeniu, zaszyfrowane kluczem firmy, poza kopią zapasową i serwerem; po zmianie hasła szyfrowania przechodzą na nowy klucz. Chroni je blokada telefonu.

**Konto z kodem od admina**: admin w panelu (sekcja „Kody dla nowych osób”) wybiera region (albo „Admin”), wpisuje
hasło firmy i dostaje kod weryfikacyjny, np. `ABCD-EFGH-JKMN-PQRS` (jednorazowy, 14 dni). Osoba w aplikacji wybiera
„Załóż konto”: imię, własny e-mail, hasło i kod. Bez ważnego kodu serwer konta nie założy (zwykła rejestracja jest
wyłączona). Konto od razu jest w regionie z kodu, bez czekania na zgodę i bez hasła firmy. Ten sam rodzaj kodu
działa dla osoby, która już ma konto: na nowym telefonie (logowanie i kod) albo do kolejnego regionu. Pierwsze 8 znaków
kodu zna serwer, kolejne 8 odwija klucz firmy tylko na telefonie, więc szyfrowanie end-to-end zostaje. Wymaga migracji
`20261114000000_kody_rejestracji.sql` i funkcji serwera `supabase/functions/konta` (akcja `register`).

**Regiony w panelu admina**: panel zaczyna się listą regionów (ranking obrotu). Kliknięcie w region otwiera jego ekran ze wszystkim w jednym miejscu: wyniki, zlecenia, kalendarz, raporty, konta w regionie, kod dla nowej osoby, prefiks, praca w regionie na tym telefonie i usunięcie regionu. „Wszystkie regiony” albo strzałka wstecz wraca do listy. Jeden e-mail może należeć do kilku regionów: członek firmy dołącza do kolejnego regionu samym kodem
w „Konto → Regiony tego konta” i tam przełącza aktywny region. Admin może wejść do
każdego regionu, wygenerować nowy kod albo usunąć region (jego zlecenia widzi wtedy tylko admin). Wymaga migracji
`20261110000000_regiony.sql`.

**Stałe logowanie**: urządzenie technika po dołączeniu zostaje zalogowane do swojego regionu i przy każdym uruchomieniu
wchodzi od razu do niego. Technik nie ma przycisku wylogowania; region zmienia albo konto odłącza admin.

**Technik** zakłada konto sam, z kodem od admina:

1. Admin w panelu admina wybiera region i klikając „Wygeneruj kod” dostaje kod (16 znaków, jednorazowy, 14 dni).
2. Technik w aplikacji: „Załóż konto”, imię, swój e-mail, hasło i kod. Konto od razu działa w regionie z kodu.
   Serwer sprawdza kod, zanim założy konto; po 5 błędnych próbach kod przestaje działać.

| | Technik | Admin (szef) |
| --- | --- | --- |
| Zlecenia, zabiegi, koszty, przejazdy | swojego regionu | swojego w ekranach, wszystkich w panelu admina |
| Zmiana rekordów | swojego oddziału | wszystkich |
| Ustawienia firmy (zalecenia, SMS, premia) | odczyt | zmiana |
| Oddziały, przenoszenie techników, zaproszenia | nie | tak |
| Zatwierdzanie próśb, usuwanie techników z firmy | nie | tak |
| Dane firmy do kilometrówki (adres, NIP) | odczyt | zmiana |
| Historia zmian na serwerze | nie | tak |

Uprawnienia egzekwuje serwer (RLS i funkcje `security definer`), więc urządzenie technika nie dostaje danych innych oddziałów.

Konfiguracja serwera (dla tej firmy już wykonana):

1. Utwórz projekt na supabase.com, najlepiej w regionie Frankfurt (eu-central-1).
2. W **SQL Editor** wykonaj po kolei wszystkie pliki z `supabase/migrations`, w kolejności nazw.
3. W **Authentication → Sign In / Providers → Email** ustaw minimalną długość hasła na 12 znaków.
4. W **Authentication → URL Configuration** ustaw *Site URL* na adres aplikacji. Tam prowadzi link potwierdzający e-mail.
5. Z **Project Settings → API Keys** skopiuj adres projektu i klucz *publishable*. Klucz *secret* nie może trafić do aplikacji.
6. Lokalnie zapisz je w `.env.local` (wzór w `.env.example`), a dla publikacji jako zmienne repozytorium:

```bash
gh variable set VITE_SUPABASE_URL --body "https://TWOJ-PROJEKT.supabase.co"
```

```bash
gh variable set VITE_SUPABASE_ANON_KEY --body "KLUCZ_PUBLISHABLE"
```

7. Opcja *Allow new users to sign up* musi być włączona, gdy technicy zakładają konta. Konto bez kodu zaproszenia
   nie widzi żadnej firmy. Może założyć tylko własną, pustą firmę.

### Szyfrowanie end-to-end

Dane opuszczają urządzenie wyłącznie zaszyfrowane (AES-256-GCM): każde pole rekordu osobno i każde zdjęcie w całości.
Klucz danych firmy leży na serwerze tylko zawinięty hasłem szyfrowania (PBKDF2-SHA-256, 600 000 iteracji), którego serwer
nie zna. Nikt z dostępem do serwera, także Supabase i osoba, która przejmie konto Supabase, nie odczyta danych bez tego hasła.
Serwer odrzuca każdą niezaszyfrowaną wartość.

- Hasło szyfrowania to coś innego niż hasło logowania. Wpisuje się je raz na każdym nowym urządzeniu, które przechowuje
  potem klucz jako nieeksportowalny.
- **Zgubione hasło szyfrowania oznacza, że danych z serwera nie da się odczytać.** Urządzenia, które już mają klucz,
  działają dalej, a nowe urządzenie można wtedy odtworzyć tylko z kopii zapasowej.
- Wszyscy technicy firmy znają to samo hasło szyfrowania. Granicę między oddziałami wyznacza serwer: nie wysyła rekordów
  innego oddziału.
- Jawne zostają: nazwy pól (bez wartości), identyfikatory rekordów, liczba rekordów i czas zmian, nazwy firmy i oddziałów,
  imiona techników oraz adresy e-mail kont.
- Trwałe usunięcie z kosza usuwa rekord, plik zdjęcia i treść historii zmian tego rekordu także na serwerze.

Logowanie odbywa się hasłem, a nie linkiem lub kodem z e-maila. Link otworzyłby Safari zamiast zainstalowanej aplikacji,
a kod w e-mailu wymaga własnego serwera poczty (SMTP). Link z e-maila służy tylko do jednorazowego potwierdzenia adresu.

## Instalacja na iPhonie

Adres aplikacji: **https://mariana1112.github.io/ddd-firma/**

iOS instaluje PWA i uruchamia tryb offline tylko ze strony HTTPS, dlatego aplikacja jest opublikowana na GitHub Pages.
Każdy push na `main` uruchamia `.github/workflows/deploy.yml`: testy, build i publikację. Gdy testy nie przejdą,
publikacja się nie wykona. GitHub Pages dostaje wyłącznie kod aplikacji, a dane trafiają do projektu Supabase.

Po publikacji nowej wersji aplikacja na telefonie pokaże pasek „Jest nowa wersja aplikacji”. Zmiana wchodzi dopiero po
dotknięciu „Odśwież”, więc aktualizacja nie przerwie wypełniania formularza. Zainstalowana aplikacja (ikona na
telefonie lub komputerze) sprawdza nowe wersje przy uruchomieniu, co 15 minut i po powrocie do aplikacji; nie trzeba jej
instalować od nowa, a dane zostają na urządzeniu. W „Więcej → Aktualizacje” jest numer wersji (commit) i przycisk
„Sprawdź aktualizacje”.

1. Otwórz adres aplikacji w Safari.
2. Wybierz **Udostępnij → Do ekranu początkowego**.
3. Uruchamiaj aplikację z ikony na ekranie początkowym. Tak zainstalowana nie podlega siedmiodniowemu czyszczeniu danych
   witryn, które w Safari dotyczy stron otwieranych w przeglądarce.

Przed usunięciem aplikacji z ekranu początkowego upewnij się, że wszystko zostało wysłane (**Więcej → Konto**), albo zrób
kopię zapasową: **Więcej → Kopie zapasowe**.

## Struktura kodu

```
src/
  lib/        czyste funkcje: kwoty, daty, CSV, walidacja, obrazy
  data/       types (model), db (Dexie i migracje), repo (jedyna droga zapisu), changes (dziennik zmian),
              orders (zlecenia i zabiegi), reports (rozliczenia), texts (SMS, dane dla centrali, linki),
              geo (odległości i propozycje terminów), settings, backup, domain (kosz), sync/ (silnik i Supabase)
  pdf/        documents (raport, kilometrówka), render (leniwe ładowanie pdfmake)
  ui/         kit (komponenty), feedback (komunikaty, potwierdzenia, pliki), forms
  features/   ekrany: dashboard, calendar, orders, order-form, visit, photos, costs, trips, reports,
              settings, account (konto, oddziały)
supabase/migrations/   schemat serwera, RLS i funkcje, wykonywane po kolei
```

Stos: React, TypeScript, Vite, vite-plugin-pwa, Dexie (IndexedDB), React Hook Form, Zod, FullCalendar, pdfmake, Vitest.

### Zasady danych

- **Kwoty** są całkowitymi groszami PLN. Nie ma błędów zaokrągleń.
- **Daty** to `YYYY-MM-DD`, a **terminy** to `YYYY-MM-DDTHH:mm` w czasie Europe/Warsaw. Nie zależą od strefy urządzenia.
  Znaczniki `createdAt`, `updatedAt` i `deletedAt` są w UTC i pokazywane w czasie warszawskim.
- **Usuwanie jest miękkie**. Rekord dostaje `deletedAt`, a na stałe znika dopiero po opróżnieniu kosza.
- **Raporty są wyliczane**, a nie przechowywane, więc po synchronizacji zawsze zgadzają się z danymi.
- Tabele z poprzedniej wersji (klienci, preparaty, cennik) zostały w bazie, żeby aktualizacja niczego nie skasowała.
  Aplikacja z nich nie korzysta.

### Zmiana schematu bazy

Nigdy nie edytuj ani nie usuwaj istniejącego `this.version(n)` w `src/data/db.ts`. Dodaj nowy `this.version(n + 1)`
z `.upgrade()`, zwiększ `SCHEMA_VERSION` i obsłuż starszy format kopii w `parseBackup`. Dzięki temu aktualizacja
aplikacji migruje dane z urządzenia zamiast je kasować. Zmiany serwera to nowe pliki w `supabase/migrations`.
