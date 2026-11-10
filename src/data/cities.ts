/**
 * Poprawianie nazw miejscowości: „gdansk”, „GDAŃSK” i „ gdańsk ” dają „Gdańsk”. Znane miejscowości dostają polskie
 * znaki, pozostałe tylko wielkie litery na początku słów (także po myślniku, np. „Bielsko-Biała”).
 */
const CITIES = [
  'Gdańsk', 'Gdynia', 'Sopot', 'Pruszcz Gdański', 'Rumia', 'Reda', 'Wejherowo', 'Puck', 'Władysławowo', 'Hel', 'Jastarnia',
  'Kartuzy', 'Żukowo', 'Kościerzyna', 'Kolbudy', 'Pszczółki', 'Tczew', 'Starogard Gdański', 'Skarszewy', 'Malbork',
  'Nowy Dwór Gdański', 'Sztum', 'Kwidzyn', 'Prabuty', 'Gniew', 'Pelplin', 'Czersk', 'Chojnice', 'Człuchów', 'Bytów',
  'Lębork', 'Łeba', 'Słupsk', 'Ustka', 'Miastko', 'Kępice', 'Elbląg', 'Iława', 'Ostróda', 'Olsztyn', 'Grudziądz',
  'Chełmno', 'Świecie', 'Toruń', 'Bydgoszcz', 'Inowrocław', 'Włocławek', 'Brodnica', 'Koszalin', 'Kołobrzeg',
  'Szczecinek', 'Szczecin', 'Świnoujście', 'Stargard', 'Police', 'Gorzów Wielkopolski', 'Zielona Góra', 'Poznań',
  'Gniezno', 'Piła', 'Leszno', 'Kalisz', 'Konin', 'Ostrów Wielkopolski', 'Łódź', 'Pabianice', 'Zgierz', 'Bełchatów',
  'Piotrków Trybunalski', 'Tomaszów Mazowiecki', 'Skierniewice', 'Kutno', 'Łowicz', 'Sieradz', 'Zduńska Wola',
  'Warszawa', 'Piaseczno', 'Pruszków', 'Legionowo', 'Otwock', 'Wołomin', 'Płock', 'Radom', 'Siedlce', 'Ostrołęka',
  'Ciechanów', 'Białystok', 'Łomża', 'Suwałki', 'Ełk', 'Giżycko', 'Mrągowo', 'Kętrzyn', 'Lublin', 'Chełm', 'Zamość',
  'Biała Podlaska', 'Puławy', 'Kielce', 'Ostrowiec Świętokrzyski', 'Starachowice', 'Kraków', 'Wieliczka', 'Tarnów',
  'Nowy Sącz', 'Oświęcim', 'Zakopane', 'Rzeszów', 'Przemyśl', 'Krosno', 'Mielec', 'Stalowa Wola', 'Katowice',
  'Gliwice', 'Zabrze', 'Bytom', 'Sosnowiec', 'Dąbrowa Górnicza', 'Chorzów', 'Tychy', 'Rybnik', 'Jastrzębie-Zdrój',
  'Bielsko-Biała', 'Częstochowa', 'Opole', 'Wrocław', 'Legnica', 'Wałbrzych', 'Jelenia Góra', 'Lubin', 'Głogów',
  'Świdnica', 'Kłodzko',
];

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const KNOWN = new Map(CITIES.map((c) => [fold(c), c]));

const titleCase = (text: string) =>
  text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(^|[\s-])(\p{L})/gu, (_, sep: string, letter: string) => sep + letter.toUpperCase());

/** Poprawiona nazwa miejscowości. Pusty tekst zostaje pusty. */
export function normalizeCity(input: string): string {
  const trimmed = input.replace(/\s+/g, ' ').trim();
  if (!trimmed) return '';
  return KNOWN.get(fold(trimmed)) ?? titleCase(trimmed);
}
