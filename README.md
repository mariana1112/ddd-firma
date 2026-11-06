# DDD Firma

Aplikacja PWA do prowadzenia firmy DDD (dezynsekcja, dezynfekcja, deratyzacja), działająca najpierw lokalnie.
Wszystkie dane są zapisane na urządzeniu w IndexedDB, a aplikacja działa bez internetu. Opcjonalna synchronizacja
z kontem przenosi dane między urządzeniami i trzyma ich kopię na serwerze.

## Co potrafi

- **Klienci i obiekty**: dane kontaktowe, adresy, uwagi o dostępie, historia zleceń, wyszukiwanie bez polskich znaków.
- **Zlecenia**: wycena lub termin, pozycje z cennika, VAT, numeracja `Z/2026/0001`, zdjęcia, duplikowanie.
- **Protokół**: użyte preparaty i partie, karencja, zalecenia, gwarancja, kolejna wizyta, podpis palcem.
- **Kalendarz**: lista, dzień, tydzień i miesiąc, przenoszenie zleceń z cofnięciem.
- **Preparaty**: stan liczony z zakupów, korekt i zleceń wykonanych, partie, terminy ważności, ostrzeżenia.
- **Ewidencja zużycia**: zestawienie za okres, eksport do PDF i CSV.
- **Finanse**: wpłaty, koszty, wynik miesiąca, należności, eksport do CSV.
- **Dokumenty PDF**: protokół, oferta, ewidencja. Działają offline, z polskimi znakami.
- **Bezpieczeństwo danych**: kopie zapasowe, scalanie, migawki przed przywróceniem, kosz, cofanie usunięć.

Aplikacja **nie wystawia faktur**. Numer faktury z programu księgowego lub KSeF można przypisać do zlecenia.
Finanse to podgląd dla właściciela, nie księga podatkowa.

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

## Synchronizacja między urządzeniami

Opcjonalna. Bez konfiguracji aplikacja działa wyłącznie lokalnie, tak jak wcześniej. Po włączeniu dane firmy są na każdym
urządzeniu i w kopii na serwerze Supabase, a zmiany przechodzą między urządzeniami przy otwarciu aplikacji, po każdej zmianie
i co minutę. Praca bez internetu działa bez zmian, a zmiany czekają w kolejce. Opis rozwiązania: [docs/ARCHITEKTURA.md](docs/ARCHITEKTURA.md), rozdział 5.

Konfiguracja (jednorazowo, dla projektu tej firmy już wykonana):

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

7. W aplikacji: **Więcej → Konto i synchronizacja → Nie mam konta, załóż je**. Potwierdź adres linkiem z e-maila,
   zaloguj się hasłem, utwórz firmę i ustaw **hasło szyfrowania**. Na kolejnych urządzeniach zaloguj się tym samym
   kontem i odblokuj firmę hasłem szyfrowania.
8. Po założeniu konta wyłącz w **Authentication → Sign In / Providers** opcję *Allow new users to sign up*.

### Szyfrowanie end-to-end

Dane opuszczają urządzenie wyłącznie zaszyfrowane (AES-256-GCM): każde pole rekordu osobno i każde zdjęcie w całości.
Klucz danych firmy leży na serwerze tylko zawinięty hasłem szyfrowania (PBKDF2-SHA-256, 600 000 iteracji), którego serwer
nie zna. Nikt z dostępem do serwera, także Supabase i osoba, która przejmie konto Supabase, nie odczyta danych bez tego hasła.
Serwer odrzuca każdą niezaszyfrowaną wartość.

- Hasło szyfrowania to coś innego niż hasło logowania. Wpisuje się je raz na każdym nowym urządzeniu, które przechowuje
  potem klucz jako nieeksportowalny.
- **Zgubione hasło szyfrowania oznacza, że danych z serwera nie da się odczytać.** Urządzenia, które już mają klucz,
  działają dalej, a nowe urządzenie można wtedy odtworzyć tylko z kopii zapasowej.
- Jawne zostają: nazwy pól (np. `phone`, ale bez wartości), identyfikatory rekordów, liczba rekordów i czas zmian,
  nazwa firmy w Supabase oraz adres e-mail konta.
- Trwałe usunięcie z kosza usuwa rekord, plik zdjęcia i treść historii zmian tego rekordu także na serwerze.

Logowanie odbywa się hasłem, a nie linkiem lub kodem z e-maila. Link otworzyłby Safari zamiast zainstalowanej aplikacji,
a kod w e-mailu wymaga własnego serwera poczty (SMTP). Link z e-maila służy tylko do jednorazowego potwierdzenia adresu.

Klucz publiczny jest jawny z założenia. Dane chronią zasady RLS: każdy widzi wyłącznie rekordy firmy, do której należy,
a zapis jest możliwy tylko przez funkcje sprawdzające rolę.

## Instalacja na iPhonie

Adres aplikacji: **https://mariana1112.github.io/ddd-firma/**

iOS instaluje PWA i uruchamia tryb offline tylko ze strony HTTPS, dlatego aplikacja jest opublikowana na GitHub Pages.
Każdy push na `main` uruchamia `.github/workflows/deploy.yml`: testy, build i publikację. Gdy testy nie przejdą,
publikacja się nie wykona. GitHub Pages dostaje wyłącznie kod aplikacji. Dane trafiają poza telefon tylko
wtedy, gdy włączysz synchronizację, i to do Twojego projektu Supabase, a nie na GitHub.

Po publikacji nowej wersji aplikacja na telefonie pokaże pasek „Jest nowa wersja aplikacji”. Zmiana wchodzi dopiero po
dotknięciu „Odśwież”, więc aktualizacja nie przerwie wypełniania formularza.

1. Otwórz adres aplikacji w Safari.
2. Wybierz **Udostępnij → Do ekranu początkowego**.
3. Uruchamiaj aplikację z ikony na ekranie początkowym. Tak zainstalowana nie podlega siedmiodniowemu czyszczeniu danych
   witryn, które w Safari dotyczy stron otwieranych w przeglądarce.

Dane należą do konkretnego adresu i konkretnej instalacji. Przed zmianą adresu lub usunięciem aplikacji z ekranu
początkowego **zrób kopię zapasową**, bo usunięcie aplikacji kasuje jej dane. Po instalacji w nowym miejscu przywróć kopię.

Kopię zapisuj poza telefonem lub w iCloud Drive: **Więcej → Kopie zapasowe → Utwórz kopię zapasową**.

## Architektura

Docelowa architektura z planem etapów (kilometrówka, trasy, SMS, raporty, konta, synchronizacja, historia zmian) jest w
[docs/ARCHITEKTURA.md](docs/ARCHITEKTURA.md). Poniżej opis obecnego kodu.

```
src/
  lib/        czyste funkcje: kwoty, daty, CSV, walidacja, obrazy, etykiety
  data/       types (model), db (Dexie), repo (zapis), domain (operacje wielotabelowe),
              calc (obliczenia), backup (kopie), settings (dane firmy, liczniki)
  pdf/        documents (definicje dokumentów), render (leniwe ładowanie pdfmake)
  ui/         kit (komponenty), feedback (komunikaty, potwierdzenia, pliki), forms (walidatory)
  features/   ekrany: dashboard, clients, jobs, calendar, stock, finance, settings
```

Stos: React, TypeScript, Vite, vite-plugin-pwa, Dexie (IndexedDB), React Hook Form, Zod, FullCalendar, pdfmake, Vitest.

### Zasady danych

- **Kwoty** są całkowitymi groszami PLN, a **ilości** całkowitymi tysięcznymi jednostki. Nie ma błędów zaokrągleń.
- **Daty** to `YYYY-MM-DD`, a **terminy** to `YYYY-MM-DDTHH:mm` w czasie Europe/Warsaw. Nie zależą od strefy urządzenia.
  Znaczniki `createdAt`, `updatedAt` i `deletedAt` są w UTC i pokazywane w czasie warszawskim.
- **Usuwanie jest miękkie**. Rekord dostaje `deletedAt`, a na stałe znika dopiero po opróżnieniu kosza.
- **Pozycje i materiały zlecenia to kopie wartości**, więc zmiana cennika nie zmienia wystawionych dokumentów.
- **Stan magazynu jest wyliczany**, a nie przechowywany: zakupy + korekty − materiały zleceń wykonanych.

### Zmiana schematu bazy

Nigdy nie edytuj ani nie usuwaj istniejącego `this.version(n)` w `src/data/db.ts`. Dodaj nowy `this.version(n + 1)`
z `.upgrade()`, zwiększ `SCHEMA_VERSION` i obsłuż starszy format kopii w `parseBackup`. Dzięki temu aktualizacja
aplikacji migruje dane z urządzenia zamiast je kasować.

### Możliwa rozbudowa

Synchronizacji, kont i współdzielenia celowo nie ma. Model jest na nie przygotowany bez dodatkowych kosztów:

| Funkcja | Co już jest | Co trzeba by dodać |
| --- | --- | --- |
| Synchronizacja, kilka urządzeń | UUID, `updatedAt`, `deletedAt` we wszystkich rekordach, scalanie „nowszy wygrywa” w `backup.ts` | Kolejka zmian w `Repository`, serwer, rozwiązywanie konfliktów |
| Konta, współdzielenie | Wszystkie zapisy przechodzą przez `Repository` i `domain.ts` | Pole właściciela, uwierzytelnianie, uprawnienia |
| Historia zmian | Jedno miejsce zapisu w `Repository` | Tabela dziennika zapisywana w `modify` i `create` |
| Zdalne kopie zapasowe | Pełny, zweryfikowany eksport w `buildBackup` | Wysyłka pliku do wybranej usługi |
| Numeracja na wielu urządzeniach | Licznik `counter:job:ROK`, który się nie cofa | Prefiks urządzenia w numerze |
