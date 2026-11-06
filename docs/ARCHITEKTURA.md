# Architektura DDD Firma

Stan na 6.11.2026. Dokument opisuje docelową architekturę całej aplikacji i plan dojścia do niej od obecnej wersji.
**Etap B jest zaimplementowany** (dziennik zmian, silnik synchronizacji, schemat serwera, logowanie e-mailem i hasłem). Etapy A, C i D nie są.
Odstępstwa od pierwotnego planu etapu B opisują punkty 5.3 i 7.2.

## 0. Najważniejsza decyzja: sprzeczność w wymaganiach

Pierwsze wymagania mówiły: bez logowania, bez kont, bez synchronizacji, bez backendu, wszystko lokalnie.
Nowe wymagania dodają konta, uprawnienia, synchronizację online i zastrzegają, że aplikacja **nie może działać
tylko na jednym urządzeniu**.

Obu nie da się spełnić naraz. Dwa urządzenia mogą mieć te same dane bez ręcznego przenoszenia plików tylko wtedy, gdy
pośredniczy między nimi serwer. Ta architektura godzi oba podejścia przez **local-first w etapach**:

- **Urządzenie zawsze ma pełną kopię swoich danych w IndexedDB** i działa bez internetu. To się nie zmienia w żadnym etapie.
- **Serwer to opcjonalna warstwa synchronizacji**, a nie miejsce, bez którego aplikacja nie działa.
- Do czasu uruchomienia etapu B drugie urządzenie dostaje dane przez kopię zapasową (eksport i import), czyli ręcznie.

**Wymaga Twojej decyzji:** czy etap B (synchronizacja i konta) ma być zrobiony teraz, czy po modułach lokalnych z etapu A.
Szczegóły w rozdziale 9.

### Czy aplikacja traci dane po ponownym uruchomieniu?

Nie. Sprawdzone w obecnej wersji:

- Dane są w IndexedDB, a nie w pamięci. Testy zamykają i ponownie otwierają bazę (`dane przetrwają ponowne otwarcie bazy`).
- Aplikacja prosi przeglądarkę o trwały zapis (`navigator.storage.persist()`).
- Zainstalowana na ekranie początkowym iPhone'a nie podlega siedmiodniowemu czyszczeniu danych przez Safari.
- Zmiany schematu idą przez numerowane migracje Dexie (`version(1)`, `version(2)`), które nie kasują danych.

Realne ryzyka utraty danych są inne: utrata lub zniszczenie telefonu, usunięcie aplikacji z ekranu początkowego oraz
zmiana adresu aplikacji. Do etapu B chronią przed nimi wyłącznie kopie zapasowe, a od etapu B także serwer.

---

## 1. Mapa ekranów i nawigacji

Nawigacja główna: dolny pasek na telefonie, boczny panel na komputerze. Pięć zakładek, reszta w „Więcej”.
Oznaczenia: ✅ jest, 🅰️ etap A, 🅱️ etap B, 🅲 etap C.

```
Pulpit ✅                         /
├─ Dzisiaj, zaległe, wizyty do umówienia, magazyn, wynik miesiąca ✅
├─ Trasa na dziś (skrót) 🅰️
├─ Przypomnienia SMS do wysłania 🅰️
└─ Stan synchronizacji 🅱️

Kalendarz ✅                      /kalendarz
├─ Lista / Dzień / Tydzień / Miesiąc ✅
├─ Filtr pracownika 🅲
└─ Plan trasy dnia 🅰️             /trasa/:data
   ├─ Kolejność wizyt (przeciąganie, „ułóż optymalnie”)
   ├─ Otwórz w Mapach (Apple / Google)
   └─ Utwórz przejazd w kilometrówce

Zlecenia ✅                       /zlecenia
├─ Nowe / edycja ✅               /zlecenia/nowe, /zlecenia/:id/edycja
└─ Szczegóły ✅                   /zlecenia/:id
   ├─ Wywiad przed zabiegiem 🅰️   /zlecenia/:id/wywiad
   ├─ Karta zabiegu (protokół) ✅ /zlecenia/:id/protokol
   │  └─ Preparaty, stacje, zalecenia, podpis ✅, szablony zaleceń 🅰️
   ├─ Płatności ✅, zdjęcia ✅, dokumenty PDF ✅
   ├─ Wyślij SMS z szablonu 🅰️
   ├─ Historia zmian 🅰️           /zlecenia/:id/historia
   └─ Przypisany pracownik 🅲

Klienci ✅                        /klienci
└─ Klient ✅ → obiekty ✅ → stacje ✅, lokalizacja GPS 🅰️

Więcej ✅                         /wiecej
├─ Finanse ✅                     /finanse         (koszty, wpłaty, należności)
├─ Kilometrówka 🅰️                /przebiegi
│  ├─ Pojazdy                     /pojazdy
│  └─ Przejazd nowy / edycja      /przebiegi/nowy
├─ Raporty 🅰️                     /raporty
├─ Preparaty i ewidencja ✅       /preparaty, /ewidencja
├─ Cennik ✅                      /cennik
├─ Szablony 🅰️                    /szablony (SMS, zalecenia, pytania wywiadu)
├─ Dane firmy ✅                  /ustawienia
├─ Ustawienia aplikacji 🅰️        /ustawienia/aplikacja
├─ Kopie zapasowe ✅              /kopie
├─ Kosz ✅                        /kosz
├─ Historia zmian 🅰️              /historia
├─ Konto i synchronizacja 🅱️      /konto
└─ Użytkownicy i uprawnienia 🅲   /uzytkownicy
```

Zasady nawigacji:
- Routing oparty na hashu (`#/...`), dzięki czemu działa na każdym hostingu statycznym i offline.
- Każdy ekran podrzędny ma przycisk powrotu z celem awaryjnym, bo zainstalowana aplikacja na iPhonie nie ma przycisku „wstecz”.
- Formularze otwierane z kalendarza dostają datę i godzinę w parametrach (`?data=&czas=`).

---

## 2. Moduły i komponenty

Warstwy, od najniższej. Warstwa wyższa może używać niższej, nigdy odwrotnie.

```
lib/        czyste funkcje bez stanu: kwoty, daty, CSV, walidacja, obrazy, etykiety, geometria 🅰️
data/       model i dostęp do danych
  types.ts      typy rekordów
  db.ts         schemat Dexie i migracje
  repo.ts       Repository<T>: jedyna droga zapisu (create, update, softDelete, restore)
  changelog.ts  🅰️ dziennik zmian zapisywany przez Repository
  domain/       operacje wielotabelowe w transakcjach (zlecenia, magazyn, kosz, przebiegi 🅰️)
  calc/         obliczenia bez bazy: sumy, stany, należności, raporty 🅰️
  backup.ts     eksport, walidacja, scalanie, migawki
  sync/         🅱️ silnik synchronizacji: outbox, push, pull, konflikty
  auth/         🅱️ sesja, profil, uprawnienia
pdf/        definicje dokumentów (czyste) i leniwe renderowanie pdfmake
ui/         komponenty wspólne: Page, Group, Row, Field, Sheet, Chips, Toast, Confirm, FileDelivery
features/   ekrany modułów
  dashboard, jobs, clients, calendar, stock, finance, settings ✅
  routes 🅰️, mileage 🅰️, interview 🅰️, templates 🅰️, reports 🅰️, history 🅰️
  account 🅱️, users 🅲
```

Zasady utrzymujące spójność:
- **UI nie pisze do Dexie bezpośrednio.** Zapis zawsze idzie przez `Repository` albo funkcję z `domain/`.
  Dzięki temu dziennik zmian (etap A) i synchronizacja (etap B) dotyczą każdego zapisu bez wyjątków.
- **Obliczenia są czyste.** `calc/` dostaje tablice rekordów i zwraca wynik, więc jest testowany bez bazy.
- **Kopie wartości w dokumentach.** Pozycje, materiały i przeglądy stacji w zleceniu kopiują dane z chwili zdarzenia.
- **Wartości wyliczane nie są przechowywane.** Stan magazynu, saldo zlecenia i sumy raportów zawsze liczy się na nowo.
  Przy synchronizacji jest to kluczowe: nie ma liczników, które dwa urządzenia mogłyby nadpisać.

---

## 3. Schemat bazy danych

### 3.1 Wspólne pola każdego rekordu

| Pole | Typ | Od kiedy | Znaczenie |
| --- | --- | --- | --- |
| `id` | UUID | ✅ | Generowany na urządzeniu, więc działa offline bez kolizji |
| `createdAt`, `updatedAt` | ISO UTC | ✅ | Czas urządzenia; do sortowania i scalania kopii |
| `deletedAt` | ISO UTC / null | ✅ | Miękkie usunięcie |
| `orgId` | UUID | 🅱️ | Firma, do której należy rekord; podstawa uprawnień na serwerze |
| `createdBy`, `updatedBy` | UUID | 🅱️ | Użytkownik; w etapie A puste |
| `rev` | liczba | 🅱️ | Numer wersji nadany przez serwer, rosnący w całej firmie |

Kwoty to całkowite grosze PLN, ilości to tysięczne jednostki, daty to `YYYY-MM-DD`, a terminy to `YYYY-MM-DDTHH:mm`
w Europe/Warsaw.

### 3.2 Tabele i relacje

```
organizations 🅱️ ─┬─< memberships 🅱️ >── users 🅱️
                  └─ (orgId we wszystkich tabelach poniżej)

clients ✅ ─< sites ✅ (stations[] ✅, lat/lng 🅰️)
   │           │
   └─< jobs ✅ >┘   (siteId opcjonalne; assignedTo 🅲 → users)
        ├─ lines[], materials[], stationChecks[] ✅   (kopie wartości)
        ├─ interview 🅰️  (odpowiedzi + kopia pytań)
        ├─< payments ✅
        ├─< attachments ✅  (zdjęcia; storagePath 🅱️)
        └─< smsLog 🅰️

preparations ✅ ─< stockMovements ✅ ── expenses ✅ (movementId, 1:1 przy zakupie)
   └── materials[] w jobs (zużycie, tylko zlecenia wykonane)

vehicles 🅰️ ─< trips 🅰️ >── jobs (jobIds[], opcjonalnie)
           └─< odometerReadings 🅰️

dayRoutes 🅰️  (data, kolejność jobIds[])
services ✅, smsTemplates 🅰️, recommendationTemplates 🅰️, interviewTemplates 🅰️
changeLog 🅰️  (dziennik i kolejka synchronizacji)
meta ✅ (dane firmy, liczniki, ustawienia) · snapshots ✅ (tylko lokalnie)
```

### 3.3 Nowe tabele

**vehicles** 🅰️: `name`, `registration`, `kind` (`firmowy` | `prywatny`), `engine` (`do-900` | `pow-900` | `motocykl` | `motorower`),
`vatMode` (`100` z ewidencją | `50`), `active`.

**trips** 🅰️: `vehicleId`, `date`, `seq` (kolejny numer wpisu w ewidencji pojazdu), `purpose` (`sluzbowy` | `prywatny`),
`description` (cel wyjazdu), `route` (skąd–dokąd, przez), `km` (tysięczne), `odometerStart`, `odometerEnd`,
`driverName`, `jobIds[]`, `ratePerKm` (grosze; kopia stawki z chwili wpisu, tylko auto prywatne w celach służbowych).

**odometerReadings** 🅰️: `vehicleId`, `date`, `value`, `kind` (`poczatek` | `koniec-okresu` | `kontrola`).
Wymagane do ewidencji przebiegu na początek i koniec okresu rozliczeniowego.

**dayRoutes** 🅰️: `date`, `jobIds[]` (kolejność), `startAddress`, `startLat`, `startLng`.

**interviewTemplates** 🅰️: `name`, `category`, `questions[]` (`id`, `text`, `type`: `tak-nie` | `tekst` | `wybor`, `options[]`, `required`).

**Job.interview** 🅰️ (pole w zleceniu): `templateId`, `answers[]` (kopia pytania + odpowiedź), `filledAt`, `filledBy` 🅱️.
Przykładowe pytania: zwierzęta w lokalu, dzieci, kobiety w ciąży, alergie, akwarium, wcześniejsze zabiegi,
miejsca występowania szkodnika.

**smsTemplates** 🅰️: `name`, `body` ze zmiennymi `{klient}`, `{data}`, `{godzina}`, `{adres}`, `{kwota}`, `{firma}`, `{telefon}`.

**smsLog** 🅰️: `jobId`, `clientId`, `phone`, `body` (wynik po podstawieniu), `sentAt`, `channel` (`aplikacja-wiadomosci` | `bramka` 🅳).

**recommendationTemplates** 🅰️: `name`, `pest`, `text`, `safetyPeriod`; wstawiane do karty zabiegu jednym dotknięciem.

**changeLog** 🅰️: `id`, `table`, `recordId`, `op` (`create` | `update` | `delete` | `restore`), `before`, `after`
(tylko zmienione pola), `at`, `deviceId`, `userId` 🅱️, `syncedRev` 🅱️ (null = jeszcze niewysłane).

### 3.4 Migracje

Każda zmiana to nowe `this.version(n)` z `upgrade()`, które **tylko dodaje** pola z wartościami domyślnymi.
Starych wersji się nie edytuje. Kopia zapasowa nosi `schemaVersion`, a `parseBackup` przyjmuje kopie starsze i odrzuca nowsze.
Przy synchronizacji (🅱️) serwer przechowuje minimalną wersję aplikacji. Starsza aplikacja wstrzymuje wysyłanie, dopóki się
nie zaktualizuje, ale nadal działa offline.

---

## 4. Użytkownicy, uwierzytelnianie i uprawnienia (🅱️ konta, 🅲 role)

### 4.1 Role

| Uprawnienie | Właściciel | Pracownik (technik) | Księgowość (podgląd) |
| --- | --- | --- | --- |
| Klienci, obiekty: odczyt | wszyscy | tylko z przypisanych zleceń | wszyscy |
| Klienci, obiekty: zmiana | tak | dane kontaktowe i stacje | nie |
| Zlecenia: tworzenie, planowanie | tak | tylko własne | nie |
| Karta zabiegu, wywiad, zdjęcia, podpis | tak | przypisane | nie |
| Ceny i cennik | tak | odczyt | odczyt |
| Wpłaty | tak | dodawanie gotówki do przypisanych | odczyt |
| Koszty, finanse, raporty finansowe | tak | nie | odczyt |
| Kilometrówka | wszystkie pojazdy | własne przejazdy | odczyt |
| Magazyn preparatów | tak | zużycie w kartach, odczyt stanów | odczyt |
| Usuwanie | tak (kosz) | własne wpisy z dziś | nie |
| Opróżnianie kosza, użytkownicy, ustawienia firmy | tak | nie | nie |

### 4.2 Uwierzytelnianie

- Logowanie e-mailem i hasłem (min. 12 znaków). Link lub kod z e-maila odpadły: link otwiera Safari zamiast zainstalowanej aplikacji, a kod w e-mailu wymaga własnego SMTP. Później opcjonalnie passkey (Face ID).
- Sesja jest zapamiętana na urządzeniu, więc aplikacja otwiera się i działa offline także bez połączenia.
  Odświeżenie sesji następuje przy najbliższym połączeniu.
- Opcjonalna lokalna blokada PIN-em przy otwarciu aplikacji (🅰️), niezależna od konta, chroni dane na odblokowanym telefonie.
- Właściciel zaprasza pracownika e-mailem. Usunięcie pracownika unieważnia jego sesję na serwerze, a przy następnym
  połączeniu jego urządzenie usuwa lokalne dane firmy.

### 4.3 Gdzie są egzekwowane uprawnienia

- **Na serwerze**: zasady dostępu na poziomie wierszy (Row Level Security w Postgresie) według `orgId`, roli i `assignedTo`.
  To jest jedyna prawdziwa ochrona.
- **Na urządzeniu**: synchronizacja pobiera tylko rekordy, które użytkownik może widzieć, a UI ukrywa niedozwolone akcje.
  Dane w IndexedDB są czytelne dla każdego z dostępem do odblokowanego telefonu, więc urządzenie pracownika
  **nie może dostać danych spoza jego zakresu**.
- **Etap A** jest jednoosobowy: bez ról i bez kont.

---

## 5. Synchronizacja online i praca offline (🅱️)

### 5.1 Zasada

Local-first: każdy zapis trafia najpierw do IndexedDB i do `changeLog`, a UI działa wyłącznie na danych lokalnych.
Synchronizacja odbywa się w tle i nigdy nie blokuje pracy.

```
UI ──> Repository ──> IndexedDB (rekord) + changeLog (wpis, syncedRev = null)
                                     │
               Silnik synchronizacji │ przy otwarciu aplikacji, po powrocie na pierwszy plan,
                                     │ po zapisie (z opóźnieniem 2–5 s) i ręcznie
                                     v
        PUSH: niewysłane wpisy ──> serwer zapisuje rekord + dziennik, nadaje rev, egzekwuje uprawnienia
        PULL: rekordy z rev > ostatnio pobrany ──> zapis lokalny bez nowych wpisów w changeLog
```

iOS nie obsługuje w PWA synchronizacji w tle (Background Sync), więc synchronizacja działa wtedy, gdy aplikacja jest otwarta.
Pulpit pokazuje liczbę niewysłanych zmian i czas ostatniej synchronizacji.

### 5.2 Konflikty

| Sytuacja | Rozstrzygnięcie |
| --- | --- |
| Dwie zmiany różnych pól tego samego rekordu | Scalane pole po polu, bo `changeLog` zawiera tylko zmienione pola |
| Dwie zmiany tego samego pola | Wygrywa później przyjęta przez serwer; przegrana wartość zostaje w historii i można ją przywrócić |
| Usunięcie kontra edycja | Rekord zostaje usunięty, a edycja trafia do historii; przywrócenie z kosza ją zachowuje |
| Wpłaty, zużycie, przejazdy | Osobne rekordy, nigdy liczniki, więc brak konfliktów |
| Stan magazynu, salda, raporty | Wyliczane lokalnie z rekordów, więc zawsze spójne po synchronizacji |
| Podpis i karta zabiegu | Edytuje je jedna osoba na miejscu; konflikt jest mało prawdopodobny, a historia zachowuje obie wersje |

### 5.3 Numeracja dokumentów na wielu urządzeniach

Lokalny licznik `Z/2026/0001` na dwóch urządzeniach dałby duplikaty. Prefiks użytkownika z pierwszej wersji planu
nie wystarcza, bo w etapie B jeden użytkownik ma kilka urządzeń. Zaimplementowane rozwiązanie to **pula numerów**:

- Przy każdej synchronizacji urządzenie rezerwuje na serwerze (`reserve_numbers`) 20 kolejnych numerów, gdy zostało mu mniej niż 5.
- Nowe zlecenie bierze numer z puli, więc działa bez internetu i ma zwykły format `Z/2026/0042`.
- Pierwsza rezerwacja zaczyna się powyżej numerów nadanych przed włączeniem synchronizacji.
- Gdy pula skończy się bez internetu, numer dostaje znacznik urządzenia, np. `Z/2026/7F3A-0001`. Jest dłuższy, ale nadal unikalny.
- W grudniu urządzenie rezerwuje też pulę na następny rok.
- Niewykorzystane numery z puli zostają lukami w numeracji. Numery zleceń to nie numery faktur, więc luki są dopuszczalne.

### 5.4 Pierwsze uruchomienie synchronizacji

Dane z obecnej, jednoosobowej wersji są wysyłane w całości przy pierwszym zalogowaniu właściciela.
Wcześniej automatycznie powstaje migawka i proponowany jest eksport kopii zapasowej.

### 5.5 Wybór serwera

| Opcja | Plusy | Minusy |
| --- | --- | --- |
| **Supabase** (zalecana) | Postgres z RLS, logowanie, przechowywanie plików i funkcje w jednym; darmowy start; brak serwera do utrzymywania | Darmowy plan ma limity, a nieużywany projekt jest wstrzymywany; kopie zapasowe bazy dopiero w planie płatnym |
| PocketBase na własnym VPS | Pełna kontrola, jeden plik wykonywalny, stały niski koszt | Aktualizacje, kopie i bezpieczeństwo serwera po Twojej stronie |
| Dexie Cloud | Najmniej kodu, bo pasuje do obecnej bazy | Usługa płatna w zależności od liczby użytkowników, mniejsza kontrola |
| Firebase | Wbudowane offline | Model danych NoSQL słabo pasuje do raportów; zastrzeżenie z pierwszych wymagań |

Silnik synchronizacji jest pisany w aplikacji, z adapterem serwera za interfejsem.
Zmiana dostawcy nie wymaga więc zmian w UI ani w modelu danych.

### 5.6 Szyfrowanie end-to-end (zaimplementowane)

- Losowy klucz danych firmy (AES-256-GCM). Na serwerze (`orgs.data_key`) leży tylko zawinięty kluczem wyprowadzonym
  z hasła szyfrowania (PBKDF2-SHA-256, 600 000 iteracji, losowa sól). Zmiana hasła wymaga tylko ponownego zawinięcia klucza
  (do zrobienia jako funkcja w aplikacji).
- Każde pole rekordu jest szyfrowane osobno (`e1:` + IV + szyfrogram). Dzięki temu serwer nadal łączy zmiany różnych pól
  operatorem `||`, nie widząc ich treści. Dane dodatkowe AES-GCM (`tabela/rekord/pole`) uniemożliwiają serwerowi przestawienie
  wartości między polami lub rekordami.
- Pliki zdjęć są szyfrowane w całości, z danymi dodatkowymi `file/<id>`, i przechowywane jako `application/octet-stream`.
- Urządzenie trzyma klucz jako nieeksportowalny `CryptoKey` w IndexedDB. Klucz nie trafia do kopii zapasowych.
- Serwer (`sync_push`) odrzuca każdą wartość, która nie jest szyfrogramem, a `min_schema = 4` blokuje starsze wersje aplikacji.
- Rekordu, którego nie da się odszyfrować, urządzenie nie zapisuje i zgłasza błąd zamiast przyjąć dane.
- Jawne zostają metadane: nazwy pól, identyfikatory, liczba i czas zmian, nazwa firmy, e-mail konta.
- Etap C: pracownik dostanie ten sam klucz danych zawinięty swoim hasłem albo przekazany przy zaproszeniu.
  Ograniczanie zakresu danych pracownika przy szyfrowaniu wymaga osobnych kluczy na zakres, co trzeba zaprojektować przed etapem C.

---

## 6. Historia zmian i usunięcia

- **Etap A**: `Repository` zapisuje każdą zmianę do `changeLog` w tej samej transakcji co rekord.
  Ekran „Historia” pokazuje kto, co i kiedy zmienił, z wartościami przed i po, oraz pozwala przywrócić poprzednią wartość pola.
  Ten sam dziennik staje się kolejką wysyłki w etapie B, więc nie powstaje drugi mechanizm.
- **Usuwanie** jest zawsze miękkie (`deletedAt`). Rekordy usunięte razem dostają ten sam znacznik i razem wracają z kosza.
  Usunięcia są blokowane, gdy zerwałyby powiązania: klient ze zleceniami, zlecenie z wpłatami, preparat użyty w zleceniu.
- **Trwałe usunięcie**: tylko właściciel przez „Opróżnij kosz”. W etapie B (zaimplementowane) usuwa rekord na wszystkich
  urządzeniach i na serwerze, plik zdjęcia z magazynu oraz treść wpisów historii tego rekordu. Na serwerze zostaje tylko
  pusty znacznik usunięcia i to, kto i kiedy zmieniał rekord, bez danych. Do zrobienia: automatyczne opróżnianie kosza po 90 dniach.
- **Rozmiar dziennika**: lokalnie trzymane są wpisy z ostatnich 12 miesięcy, a starsze pozostają tylko na serwerze (🅱️).
  W etapie A starsze wpisy są kompaktowane, a kopie zapasowe zawierają cały dziennik.

---

## 7. PDF, zdjęcia, SMS i raporty

### 7.1 Dokumenty PDF

pdfmake w przeglądarce, ładowany przy pierwszym użyciu i przechowywany przez service worker, dzięki czemu działa offline.
Dokumenty powstają z czystych funkcji w `pdf/documents.ts`, a testy renderują je w Node.

| Dokument | Stan |
| --- | --- |
| Protokół (karta zabiegu) z preparatami, stacjami, zaleceniami, podpisem i zdjęciami | ✅ |
| Oferta / wycena | ✅ |
| Ewidencja zużycia preparatów | ✅ |
| Wywiad przed zabiegiem z odpowiedziami | 🅰️ |
| Ewidencja przebiegu pojazdu (okres, pojazd, wpisy, stan licznika) | 🅰️ |
| Rozliczenie kilometrówki (auto prywatne, stawka za km) | 🅰️ |
| Raport miesięczny: wpływy, koszty, należności, liczba zleceń | 🅰️ |
| Raport stacji dla obiektu (historia przeglądów, trend) | 🅰️ |

Wysyłka: arkusz udostępniania iOS (Wiadomości, Mail, Pliki, WhatsApp) bez serwera.

### 7.2 Zdjęcia

- Przed zapisem zmniejszane do 1600 px i JPEG 80%, czyli około 200–400 KB. ✅
- Etap A: zapisywane jako Blob w IndexedDB; kopia zapasowa może je zawierać lub pomijać. ✅
- Etap B (zaimplementowane): plik jest wysyłany do prywatnego magazynu `attachments` przy synchronizacji. Inne urządzenie
  dostaje sam rekord, a plik pobiera przy pierwszym wyświetleniu i zachowuje lokalnie.
- Do zrobienia: miniatury i ustawienie „trzymaj oryginały z ostatnich N dni”, które ograniczą pamięć zajętą na telefonie.
- Zalecenia dla klienta: szablony tekstu (🅰️) wstawiane do karty zabiegu i wysyłane razem z protokołem.

### 7.3 SMS

Aplikacja internetowa nie może sama wysłać SMS-a. Są dwie drogi:

| Droga | Etap | Koszt | Jak działa |
| --- | --- | --- | --- |
| Link `sms:` z gotową treścią | 🅰️ | 0 zł | Aplikacja podstawia dane do szablonu i otwiera Wiadomości z gotowym tekstem; wysyłasz jednym dotknięciem z własnego numeru |
| Bramka SMS (np. polski operator bramek) | 🅳 | opłata za każdy SMS | Automatyczne przypomnienia dzień przed wizytą; wymaga serwera (funkcja), bo klucza API nie wolno trzymać w aplikacji |

Szablony na start: potwierdzenie terminu, przypomnienie dzień przed, „jestem w drodze”, zalecenia po zabiegu,
przypomnienie o kolejnej wizycie, przypomnienie o płatności. Każde wysłanie trafia do `smsLog`.

### 7.4 Planowanie tras (🅰️)

- Obiekt dostaje współrzędne: zapisane na miejscu z GPS telefonu jednym dotknięciem lub wpisane ręcznie.
  Masowe wyszukiwanie współrzędnych po adresie wymaga zewnętrznej usługi, więc nie jest częścią etapu A.
- „Ułóż optymalnie” liczy kolejność lokalnie: najbliższy sąsiad i poprawki 2-opt na odległościach w linii prostej.
  Działa offline i bez kosztów. Rzeczywisty czas przejazdu daje dopiero nawigacja.
- „Otwórz trasę” przekazuje kolejne punkty do Map Google (wiele przystanków w jednym linku, z limitem ich liczby)
  albo otwiera Mapy Apple punkt po punkcie.
- Z planu dnia można utworzyć wpis w kilometrówce z listą zleceń. Kilometry wpisuje się ze stanu licznika,
  a odległość z planu jest tylko podpowiedzią.

### 7.5 Ewidencja kilometrów (🅰️)

- **Pojazd firmowy, VAT 100%**: ewidencja przebiegu z polami wymaganymi w ustawie o VAT (kolejny numer, data, cel,
  trasa, liczba km, kierowca, stan licznika na początek i koniec okresu). Każdy przejazd firmowym autem jest wpisywany,
  także prywatny, bo przy odliczeniu 100% użytek prywatny jest niedozwolony i ewidencja go uwidacznia.
- **Pojazd prywatny w celach służbowych**: kilometrówka ze stawką za km zależną od rodzaju pojazdu.
  Stawki są ustawieniem z datą obowiązywania, a nie stałą w kodzie, bo zmieniają się rozporządzeniem.
- **Pojazd firmowy, VAT 50%**: ewidencja nie jest wymagana, ale moduł pozwala ją prowadzić dla własnej kontroli.
- Wzór ewidencji i stawki należy potwierdzić z księgową przed pierwszym rozliczeniem.

### 7.6 Raporty (🅰️)

Liczone lokalnie z danych na urządzeniu, wyświetlane na ekranie i eksportowane do PDF i CSV:
- miesięczny i roczny: wpływy, koszty według kategorii, wynik, należności, liczba zleceń według rodzaju usługi,
- klienci: przychód, liczba wizyt, ostatnia wizyta, zaległości,
- preparaty: zużycie w okresie, stan, terminy ważności (ewidencja ✅),
- kilometrówka i ewidencja przebiegu za okres,
- stacje: przeglądy obiektu w czasie, stacje z aktywnością szkodników,
- 🅲 pracownicy: liczba zleceń, przejazdy, przyjęte wpłaty.

Raportów nie przechowuje się, bo zawsze powstają z aktualnych danych.

---

## 8. Testy, kopie zapasowe i odzyskiwanie danych

### 8.1 Testy

| Poziom | Narzędzie | Co obejmuje | Stan |
| --- | --- | --- | --- |
| Czyste funkcje | Vitest | kwoty, daty, VAT, magazyn, należności, raporty, trasy | ✅ / 🅰️ |
| Dane i transakcje | Vitest + fake-indexeddb | repozytorium, kosz, blokady usuwania, kopie, migracje | ✅ |
| Migracje | Vitest + pliki kopii z każdej wersji schematu (`test/fixtures/backup-vN.json`) | odtworzenie starej bazy i podniesienie wersji | 🅰️ |
| PDF | Vitest + pdfmake w Node | każdy dokument, polskie znaki, puste przypadki | ✅ |
| Synchronizacja | Vitest, dwa symulowane urządzenia i serwer w pamięci | konflikty, kolejność, ponowienia, utrata połączenia w połowie | 🅱️ |
| Uprawnienia na serwerze | lokalny Supabase + testy SQL | każda rola kontra każda tabela i operacja | 🅱️ |
| Ścieżki użytkownika | Playwright (silnik WebKit, ekran iPhone'a) | nowe zlecenie → karta → PDF → wpłata; kopia i przywrócenie; praca offline | 🅰️ |
| Prawdziwy iPhone | lista kontrolna przy każdym wydaniu | instalacja, aparat, udostępnianie, podpis, offline, aktualizacja | 🅰️ |

CI w GitHub Actions uruchamia wszystko poza testami na prawdziwym urządzeniu. Publikacja odbywa się wyłącznie po zielonych testach. ✅

### 8.2 Kopie zapasowe

| Warstwa | Etap | Chroni przed |
| --- | --- | --- |
| IndexedDB z trwałym zapisem | ✅ | zamknięciem i ponownym uruchomieniem aplikacji |
| Kosz i cofanie | ✅ | pomyłkowym usunięciem |
| Migawki przed przywróceniem kopii | ✅ | złym importem |
| Eksport JSON z sumą kontrolną, przypomnienie co 7 dni | ✅ | utratą telefonu (gdy kopia jest poza nim) |
| Automatyczna migawka tygodniowa na urządzeniu | 🅰️ | błędem w nowej wersji aplikacji |
| Serwer jako druga kopia wszystkich danych | 🅱️ | utratą telefonu bez ręcznej kopii |
| Nocny eksport bazy serwera do prywatnego magazynu | 🅱️ | awarią lub błędem po stronie serwera |

### 8.3 Scenariusze odzyskiwania

| Zdarzenie | Przed etapem B | Od etapu B |
| --- | --- | --- |
| Zgubiony lub zniszczony telefon | Instalacja na nowym i import ostatniej kopii; zmiany po kopii przepadają | Logowanie na nowym telefonie i pełne pobranie danych |
| Usunięcie aplikacji z ekranu | Jak wyżej | Jak wyżej |
| Pomyłkowe usunięcie | Kosz lub „Cofnij” | Kosz, „Cofnij”, historia zmian |
| Zła wartość zapisana dawno temu | Import starej kopii z scalaniem | Przywrócenie wartości z historii |
| Wadliwa aktualizacja aplikacji | Migawka i poprzednia wersja z GitHuba | Jak obok, a serwer odrzuca niezgodne dane |
| Awaria serwera | nie dotyczy | Praca offline bez przerwy, odtworzenie z nocnej kopii, ponowna wysyłka niewysłanych zmian |
| Zmiana adresu aplikacji | Eksport pod starym adresem, import pod nowym | Logowanie pod nowym adresem |

---

## 9. Plan wdrożenia i koszty

### 9.1 Etapy

**Etap A: brakujące moduły lokalne, 0 zł miesięcznie.** Nadal jedna osoba i jedno urządzenie, ale model danych jest gotowy
na synchronizację.
1. Dziennik zmian w `Repository`, ekran historii, pola `createdBy` i `updatedBy` (puste).
2. Kilometrówka: pojazdy, przejazdy, stany licznika, PDF i CSV.
3. Szablony: SMS (link `sms:`), zalecenia, pytania wywiadu; wywiad w zleceniu.
4. Plan trasy dnia, współrzędne obiektów, otwieranie w Mapach.
5. Raporty z eksportem.
6. Ustawienia aplikacji: blokada PIN, stawki kilometrówki, domyślne szablony.
7. Testy migracji na plikach kopii, Playwright, lista kontrolna iPhone'a.

**Etap B: konto właściciela i synchronizacja między Twoimi urządzeniami.**
1. Projekt na serwerze, schemat z RLS, logowanie.
2. Silnik synchronizacji na `changeLog`, adapter serwera, wskaźnik stanu.
3. Zdjęcia w magazynie plików, miniatury lokalnie.
4. Prefiksy numeracji, pierwsze wysłanie danych, nocny eksport.

**Etap C: pracownicy i uprawnienia.** Zaproszenia, role, przypisywanie zleceń, filtry w kalendarzu i raportach,
zakres danych na urządzeniu pracownika, wylogowanie zdalne.

**Etap D, opcjonalnie: automatyzacje.** Bramka SMS z przypomnieniami, powiadomienia push (PWA na iOS obsługuje je po instalacji
na ekranie początkowym), własna domena.

Etap B nie wymaga zmian w ekranach z etapu A, bo zapis i tak przechodzi przez `Repository`. Kolejność A → B jest tańsza,
ponieważ synchronizowany schemat jest wtedy już kompletny. Jeśli jednak praca na kilku urządzeniach jest pilniejsza niż
nowe moduły, B można zrobić najpierw. Kosztuje to jedną dodatkową migrację, gdy później dojdą tabele z etapu A.

### 9.2 Koszty utrzymania

Kwoty orientacyjne. Cenniki usług zmieniają się, więc przed decyzją trzeba je sprawdzić.

| Pozycja | Etap A | Etap B / C |
| --- | --- | --- |
| Hosting aplikacji (GitHub Pages) | 0 zł | 0 zł |
| Serwer i baza (Supabase, plan darmowy) | — | 0 zł przy jednej firmie i kilku osobach |
| Serwer z kopiami bazy i bez wstrzymywania (plan płatny) | — | ok. 25 USD miesięcznie, gdy limity lub kopie staną się potrzebne |
| Magazyn zdjęć | na telefonie | darmowy limit wystarcza na kilka tysięcy zdjęć |
| SMS przez link `sms:` | wg Twojej taryfy | wg Twojej taryfy |
| Bramka SMS | — | opłata za każdy SMS, tylko etap D |
| Własna domena | — | ok. 50–100 zł rocznie, opcjonalnie |
| Konto Apple Developer | niepotrzebne | niepotrzebne (PWA, nie aplikacja ze sklepu) |

---

## 10. Sprawdzenie spójności

| # | Ryzyko | Rozstrzygnięcie |
| --- | --- | --- |
| 1 | Wymagania „bez kont i serwera” kontra „nie tylko jedno urządzenie” | Etapy A → B; decyzja o kolejności należy do Ciebie (rozdz. 0 i 9) |
| 2 | Utrata danych po ponownym uruchomieniu | Nie występuje: IndexedDB, trwały zapis, test ponownego otwarcia bazy |
| 3 | Utrata danych razem z telefonem | Do etapu B: kopie z przypomnieniem. Od etapu B: serwer i nocne kopie |
| 4 | Duplikaty numerów zleceń na wielu urządzeniach | Pula numerów rezerwowana na serwerze (5.3) |
| 5 | Sprzeczne stany magazynu lub salda po synchronizacji | Wartości wyliczane, a nie przechowywane (2) |
| 6 | Pracownik widzi dane spoza swojego zakresu | RLS na serwerze i pobieranie tylko dozwolonych rekordów (4.3) |
| 7 | Zapis z pominięciem historii lub synchronizacji | Jedna droga zapisu przez `Repository`; test sprawdza, że każdy zapis tworzy wpis w `changeLog` |
| 8 | Stara wersja aplikacji psuje dane po zmianie schematu | Migracje tylko dodające pola, minimalna wersja aplikacji na serwerze (3.4) |
| 9 | Automatyczne SMS-y bez serwera | Niemożliwe; etap A daje SMS jednym dotknięciem, automaty dopiero w etapie D (7.3) |
| 10 | Planowanie tras bez płatnych usług map | Kolejność liczona lokalnie, nawigacja w Mapach (7.4) |
| 11 | Pamięć telefonu zapełniona zdjęciami | Kompresja, a od etapu B oryginały na serwerze i miniatury lokalnie (7.2) |
| 12 | Synchronizacja w tle na iPhonie | Brak wsparcia w iOS; synchronizacja przy otwarciu i z widocznym stanem (5.1) |
| 13 | Faktury | Nadal poza aplikacją (KSeF); zlecenie przechowuje numer faktury |
| 14 | Kilometrówka niezgodna z przepisami | Pola ewidencji według ustawy o VAT, stawki jako ustawienie z datą, weryfikacja z księgową (7.5) |
| 15 | Strefa czasowa na urządzeniach w różnych strefach | Terminy w czasie Europe/Warsaw, niezależne od urządzenia; znaczniki rekordów w UTC |
