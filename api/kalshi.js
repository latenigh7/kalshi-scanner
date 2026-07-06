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
    const kalshiResponse = await fetch(url);
    const data = await kalshiResponse.json();
    res.status(kalshiResponse.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to reach Kalshi from the server.' });
  }
}
