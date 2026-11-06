# DDD Firma

Lokalna, jednoosobowa aplikacja PWA do prowadzenia firmy DDD (dezynsekcja, dezynfekcja, deratyzacja).
Działa bez internetu, bez logowania i bez serwera. Wszystkie dane są zapisane na urządzeniu w IndexedDB.

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

## Instalacja na iPhonie

Adres aplikacji: **https://mariana1112.github.io/ddd-firma/**

iOS instaluje PWA i uruchamia tryb offline tylko ze strony HTTPS, dlatego aplikacja jest opublikowana na GitHub Pages.
Każdy push na `main` uruchamia `.github/workflows/deploy.yml`: testy, build i publikację. Gdy testy nie przejdą,
publikacja się nie wykona. Publikowany jest wyłącznie kod aplikacji. Dane nigdzie nie trafiają, bo nie ma serwera,
który mógłby je odebrać.

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
