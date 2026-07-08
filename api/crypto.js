export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    // Top 3 non-stablecoin assets by market cap. CoinGecko's public endpoint
    // needs no API key for this level of usage.
    const url = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true';
    const cgResponse = await fetch(url);
    const data = await cgResponse.json();
    res.status(cgResponse.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to reach CoinGecko from the server.' });
  }
}
