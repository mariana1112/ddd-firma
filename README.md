# Pogromcy Insektów

Aplikacja PWA dla techników firmy Pogromcy Insektów: zlecenia, zabiegi u klienta, kilometrówka, koszty z dnia
i rozliczenia tygodniowe. Wszystkie dane są zapisane na urządzeniu w IndexedDB, a aplikacja działa bez internetu.
Synchronizacja z kontem przenosi dane między urządzeniami i technikami oddziału, a na serwer trafiają wyłącznie
zaszyfrowane.

## Co potrafi

- **Kreator zlecenia** w sześciu krokach:
  - adres z rodzajem budynku: dom, bliźniak albo blok (w bloku lokal, piętro i klatka) oraz opis dojazdu,
  - szkodnik: karaluchy, chrząszczowate, pluskwy, gryzonie albo inne z opisem, metraż i kod pink,
  - termin z czasem zabiegu i propozycjami blisko innych zleceń z szacowanym dojazdem, drugi zabieg umówiony od razu albo przez technika,
  - widełki cenowe (przy fakturze VAT netto i brutto),
  - klient wpisywany przy zleceniu, bez bazy klientów: telefony z dopiskiem, e-mail i NIP.
  Niedokończony kreator zostaje zapamiętany. Numery `#210` są wspólne dla całej firmy.
- **Zabieg u klienta**:
  - przycisk rozpoczęcia, płatność z kolorami (gotówka, BLIK, przelew), zmiana faktury,
  - wywiad zapisywany na bieżąco, który nie znika po zamknięciu aplikacji,
  - wykonane czynności i miejsca, co zastałem, problemy, zdjęcia, historia zabiegów u tego klienta.
- **Zakończenie zabiegu**:
  - zalecenia z szablonów i SMS do klienta z podsumowaniem „Oprysk ciśnieniowy (listwy, kratka, łóżka)”,
  - drugi albo trzeci zabieg, a za trzeci umówiony przez technika premia 50 zł,
  - **dane dla centrali** jako tekst do wklejenia, bo protokół robi centrala.
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
- **Koszty z dnia**: autostrada, parking, paliwo, inne.
- **Raporty dzienne, tygodniowe i miesięczne**: obrót, gotówka, BLIK, przelew, zwroty za parkingi i autostrady, premia,
  inne koszty i wynik gotówki dla szefa, w formacie rozliczenia wysyłanego szefowi, do skopiowania, wysłania albo PDF.
- **Oddziały**: technik widzi dane swojego oddziału, a szef wszystkie oddziały, raporty techników i kody zaproszeń.
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

## Konta, oddziały i synchronizacja

Bez konfiguracji serwera aplikacja działa wyłącznie lokalnie. Po zalogowaniu dane są na każdym urządzeniu i w zaszyfrowanej
kopii na serwerze Supabase. Zmiany przechodzą przy otwarciu aplikacji, po każdej zmianie i co minutę. Praca bez internetu
działa bez zmian, a zmiany czekają w kolejce. Opis rozwiązania: [docs/ARCHITEKTURA.md](docs/ARCHITEKTURA.md).

**Szef** zakłada konto z imieniem, tworzy firmę z pierwszym oddziałem i ustawia hasło szyfrowania. W **Więcej → Oddziały**
dodaje kolejne oddziały, przenosi techników, usuwa ich z firmy i tworzy kod zaproszenia do wybranego oddziału.

**Technik** dołącza w trzech krokach:

1. **Kod zaproszenia** od szefa: 10 znaków, jednorazowy, ważny 14 dni, przypisany do oddziału.
2. **Hasło szyfrowania** firmy, które szef przekazuje osobiście, nigdy razem z kodem. Urządzenie technika odwija nim
   klucz firmy i wysyła dowód, że go ma. Serwer porównuje skrót tego dowodu ze skrótem zapisanym przez urządzenie
   szefa przy tworzeniu kodu, więc sprawdza hasło, nie znając ani hasła, ani klucza. Po 5 błędnych próbach kod
   przestaje działać.
3. **Zgoda szefa**: prośba z imieniem i adresem e-mail pojawia się w **Więcej → Oddziały**. Do zatwierdzenia konto
   nie jest członkiem firmy: nie czyta ani nie zapisuje żadnych danych. Po zgodzie urządzenie łączy się samo.

| | Technik | Szef |
| --- | --- | --- |
| Zlecenia, zabiegi, koszty, przejazdy | swojego oddziału | wszystkich oddziałów |
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
dotknięciu „Odśwież”, więc aktualizacja nie przerwie wypełniania formularza.

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
