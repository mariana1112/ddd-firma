// Funkcja serwera „mapy” (Supabase Edge Function): rozwija skrócony link Google Maps (maps.app.goo.gl) do pełnego
// adresu strony mapy, z którego aplikacja odczytuje adres i współrzędne. Przeglądarka nie może tego zrobić sama.
//
// - Tylko zalogowane konta (sprawdzane przez Supabase Auth).
// - Tylko linki maps.app.goo.gl i goo.gl/maps, najwyżej 5 przekierowań, tylko do domen Google: funkcja nie jest
//   ogólnym pośrednikiem do innych stron.
// - Bez dostępu do bazy i bez kluczy serwisowych.

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const SHORT = /^https:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps)\//i;
const GOOGLE_HOST = /(^|\.)(google\.[a-z.]+|goo\.gl|app\.goo\.gl)$/i;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'BAD_ACTION' }, 405);

  const auth = req.headers.get('Authorization') ?? '';
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: who } = await client.auth.getUser();
  if (!who.user) return json({ error: 'NOT_AUTHENTICATED' }, 401);

  let link = '';
  try {
    link = String((await req.json()).url ?? '').trim();
  } catch {
    return json({ error: 'BAD_LINK' }, 400);
  }
  if (!SHORT.test(link) || link.length > 300) return json({ error: 'BAD_LINK' }, 400);

  let current = link;
  for (let hop = 0; hop < 5; hop++) {
    const response = await fetch(current, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (Pogromcy Insektow)' } });
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location) break;
    const next = new URL(location, current);
    if (!GOOGLE_HOST.test(next.hostname)) return json({ error: 'BAD_LINK' }, 400);
    // Strona zgody na ciasteczka: właściwy adres mapy jest w parametrze „continue”.
    if (/^consent\./i.test(next.hostname) && next.searchParams.get('continue')) {
      current = next.searchParams.get('continue')!;
      break;
    }
    current = next.toString();
    if (!SHORT.test(current)) break;
  }
  if (current === link) return json({ error: 'NOT_RESOLVED' }, 422);
  return json({ url: current });
});
