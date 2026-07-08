export default async function handler(req, res) {
  // Allow our own frontend (or anyone) to call this endpoint from the browser.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const PAGE_LIMIT = 200; // Kalshi's max per page
  const MAX_PAGES = 4; // pulls up to ~800 events total from the general scan

  // Kalshi's daily temperature markets are a small slice of total open events,
  // and generic keyword/category scanning can miss them entirely if they
  // don't happen to land in the pages fetched (long-horizon "will X happen by
  // 2050" style markets are far more numerous and can crowd them out). Query
  // these known series directly so short-term weather is never left to luck.
  const WEATHER_SERIES_TICKERS = [
    'KXHIGHNY', 'KXHIGHLAX', 'KXHIGHCHI', 'KXHIGHMIA', 'KXHIGHAUS', 'KXHIGHDEN',
    'KXLOWNY', 'KXLOWLAX', 'KXLOWCHI',
  ];

  async function fetchWithTimeout(url, ms) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ms);
    try {
      const response = await fetch(url, { signal: controller.signal });
      const rawText = await response.text();
      let data;
      try {
        data = JSON.parse(rawText);
      } catch (parseErr) {
        return { ok: false, status: response.status, error: 'non-JSON response', snippet: rawText.slice(0, 300) };
      }
      if (!response.ok) return { ok: false, status: response.status, data };
      return { ok: true, data };
    } catch (fetchErr) {
      if (fetchErr.name === 'AbortError') return { ok: false, error: `timed out after ${ms}ms` };
      return { ok: false, error: fetchErr.message };
    } finally {
      clearTimeout(timeout);
    }
  }

  async function fetchOnePage(cursor) {
    const params = new URLSearchParams(req.query);
    params.set('limit', String(PAGE_LIMIT));
    if (cursor) params.set('cursor', cursor);
    else params.delete('cursor');
    const url = `https://external-api.kalshi.com/trade-api/v2/events?${params.toString()}`;
    return fetchWithTimeout(url, 8000);
  }

  async function fetchWeatherSeries() {
    // Run all series lookups in parallel -- if a ticker doesn't exist or
    // Kalshi has nothing open for it, that single lookup just comes back
    // empty rather than failing the whole request.
    const lookups = WEATHER_SERIES_TICKERS.map(async (ticker) => {
      const url = `https://external-api.kalshi.com/trade-api/v2/events?series_ticker=${ticker}&status=open&with_nested_markets=true&limit=50`;
      const result = await fetchWithTimeout(url, 6000);
      return result.ok ? (result.data.events || []) : [];
    });
    const results = await Promise.all(lookups);
    return results.flat();
  }

  try {
    let allEvents = [];
    let cursor = undefined;
    let pagesFetched = 0;

    for (let i = 0; i < MAX_PAGES; i++) {
      const result = await fetchOnePage(cursor);
      pagesFetched++;
      if (!result.ok) {
        if (allEvents.length > 0) break;
        res.status(result.status || 502).json({
          error: result.error || 'Failed to reach Kalshi',
          upstream_status: result.status,
          upstream_body_snippet: result.snippet,
        });
        return;
      }
      const events = result.data.events || [];
      allEvents = allEvents.concat(events);
      cursor = result.data.cursor;
      if (!cursor || events.length === 0) break;
    }

    const weatherEvents = await fetchWeatherSeries();

    // Merge, de-duplicating by event_ticker in case a weather event also
    // happened to appear in the general scan.
    const seen = new Set(allEvents.map(e => e.event_ticker));
    for (const ev of weatherEvents) {
      if (!seen.has(ev.event_ticker)) {
        allEvents.push(ev);
        seen.add(ev.event_ticker);
      }
    }

    res.status(200).json({ events: allEvents, pages_fetched: pagesFetched, weather_series_found: weatherEvents.length });
  } catch (err) {
    console.error('kalshi.js function error:', err);
    res.status(500).json({ error: err.message || 'Failed to reach Kalshi from the server.' });
  }
}
