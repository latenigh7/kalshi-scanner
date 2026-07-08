export default async function handler(req, res) {
  // Allow our own frontend (or anyone) to call this endpoint from the browser.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const PAGE_LIMIT = 200; // Kalshi's max per page
  const MAX_PAGES = 4; // pulls up to ~800 events total, so short-term markets aren't
                        // missed just because they weren't in the very first page

  async function fetchOnePage(cursor) {
    const params = new URLSearchParams(req.query);
    params.set('limit', String(PAGE_LIMIT));
    if (cursor) params.set('cursor', cursor);
    else params.delete('cursor');
    const url = `https://external-api.kalshi.com/trade-api/v2/events?${params.toString()}`;

    // Give each page a hard deadline shorter than the function's own max
    // duration, so a slow upstream response fails cleanly instead of letting
    // the platform kill the whole function with a generic crash page.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const kalshiResponse = await fetch(url, { signal: controller.signal });
      const rawText = await kalshiResponse.text();
      let data;
      try {
        data = JSON.parse(rawText);
      } catch (parseErr) {
        console.error('Kalshi returned non-JSON response:', kalshiResponse.status, rawText.slice(0, 300));
        return { ok: false, status: kalshiResponse.status, error: 'non-JSON response', snippet: rawText.slice(0, 300) };
      }
      if (!kalshiResponse.ok) {
        console.error('Kalshi returned an error status:', kalshiResponse.status, data);
        return { ok: false, status: kalshiResponse.status, data };
      }
      return { ok: true, data };
    } catch (fetchErr) {
      if (fetchErr.name === 'AbortError') {
        return { ok: false, error: 'timed out after 8s' };
      }
      return { ok: false, error: fetchErr.message };
    } finally {
      clearTimeout(timeout);
    }
  }

  try {
    let allEvents = [];
    let cursor = undefined;
    let pagesFetched = 0;

    for (let i = 0; i < MAX_PAGES; i++) {
      const result = await fetchOnePage(cursor);
      pagesFetched++;
      if (!result.ok) {
        // If we already collected some events from earlier pages, return
        // those rather than failing the whole request over one bad page.
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

    res.status(200).json({ events: allEvents, pages_fetched: pagesFetched });
  } catch (err) {
    console.error('kalshi.js function error:', err);
    res.status(500).json({ error: err.message || 'Failed to reach Kalshi from the server.' });
  }
}
