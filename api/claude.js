// api/claude.js — Vercel serverless function
// Proxies requests to Anthropic's API, keeping the key server-side.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // GET = self-test. Visit /api/claude in a browser to verify the function is alive.
  if (req.method === 'GET') {
    const hasKey = !!process.env.ANTHROPIC_API_KEY;
    return res.status(200).json({
      status: 'Function is alive ✅',
      apiKeyConfigured: hasKey,
      message: hasKey
        ? 'API key is configured. You are ready to run the app.'
        : '⚠️ ANTHROPIC_API_KEY is NOT set. Add it in Vercel → Settings → Environment Variables, then redeploy.',
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured on server. Add it in Vercel Settings → Environment Variables and redeploy.' });
  }

  try {
    const { system, user, useSearch = false, maxTokens = 4000 } = req.body || {};

    if (!user) {
      return res.status(400).json({ error: 'Missing user message in request body' });
    }

    const body = {
      model: 'claude-3-5-sonnet-latest',
      max_tokens: maxTokens,
      system: system || 'You are a helpful assistant.',
      messages: [{ role: 'user', content: user }],
    };

    if (useSearch) {
      body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 8 }];
    }

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    const raw = await upstream.text();

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: `Anthropic API returned ${upstream.status}`,
        details: raw.slice(0, 600),
      });
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return res.status(500).json({ error: 'Could not parse Anthropic response', details: raw.slice(0, 300) });
    }

    if (data.error) {
      return res.status(500).json({ error: data.error.message || 'Anthropic error' });
    }

    const text = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n');

    return res.status(200).json({ text });

  } catch (e) {
    return res.status(500).json({ error: e.message || 'Unknown server error' });
  }
}

export const config = {
  maxDuration: 300,
};
