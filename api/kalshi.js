export default async function handler(req, res) {
  // Allow our own frontend (or anyone) to call this endpoint from the browser.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const params = new URLSearchParams(req.query).toString();
    const url = `https://external-api.kalshi.com/trade-api/v2/events?${params}`;

    // Give Kalshi a hard deadline shorter than the function's own max duration,
    // so a slow upstream response fails as a clean JSON error instead of
    // letting the platform kill the whole function (which shows a generic
    // crash page with no useful detail).
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let kalshiResponse;
    try {
      kalshiResponse = await fetch(url, { signal: controller.signal });
    } catch (fetchErr) {
      if (fetchErr.name === 'AbortError') {
        res.status(504).json({ error: 'Kalshi took too long to respond (timed out after 15s).' });
        return;
      }
      throw fetchErr;
    } finally {
      clearTimeout(timeout);
    }

    const rawText = await kalshiResponse.text();

    let data;
    try {
      data = JSON.parse(rawText);
    } catch (parseErr) {
      // Kalshi didn't return JSON (could be an HTML error page, rate-limit
      // notice, etc). Surface the raw body so this is diagnosable instead of
      // just failing silently with a generic 500.
      console.error('Kalshi returned non-JSON response:', kalshiResponse.status, rawText.slice(0, 500));
      res.status(502).json({
        error: 'Kalshi returned a non-JSON response',
        upstream_status: kalshiResponse.status,
        upstream_body_snippet: rawText.slice(0, 300),
      });
      return;
    }

    if (!kalshiResponse.ok) {
      console.error('Kalshi returned an error status:', kalshiResponse.status, data);
    }
    res.status(kalshiResponse.status).json(data);
  } catch (err) {
    console.error('kalshi.js function error:', err);
    res.status(500).json({ error: err.message || 'Failed to reach Kalshi from the server.' });
  }
}
