// api/claude.js — Vercel serverless function
// Proxies Anthropic API calls, keeps key server-side, and self-diagnoses.

const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-5';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const apiKey = process.env.ANTHROPIC_API_KEY;

  // GET = self-test + list available models so we know exactly what works.
  if (req.method === 'GET') {
    if (!apiKey) {
      return res.status(200).json({
        status: 'Function is alive',
        apiKeyConfigured: false,
        message: 'ANTHROPIC_API_KEY is NOT set. Add it in Vercel Settings then redeploy.',
      });
    }
    try {
      const r = await fetch('https://api.anthropic.com/v1/models', {
        method: 'GET',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      });
      const raw = await r.text();
      let parsed;
      try { parsed = JSON.parse(raw); } catch { parsed = { raw }; }
      const ids = (parsed.data || []).map(m => m.id);
      return res.status(200).json({
        status: 'Function is alive',
        apiKeyConfigured: true,
        currentModelInUse: MODEL,
        availableModels: ids.length ? ids : 'none returned',
        rawIfError: ids.length ? undefined : parsed,
        message: ids.length
          ? 'Your account can use the listed models. App is set to ' + MODEL + '. If not in list, set CLAUDE_MODEL env var.'
          : 'Could not list models — see rawIfError. Likely no credits on the account yet.',
      });
    } catch (e) {
      return res.status(200).json({ status: 'Function is alive', apiKeyConfigured: true, modelListError: e.message });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured on server.' });

  try {
    const { system, user, useSearch = false, maxTokens = 4000 } = req.body || {};
    if (!user) return res.status(400).json({ error: 'Missing user message' });

    const body = {
      model: MODEL,
      max_tokens: maxTokens,
      system: system || 'You are a helpful assistant.',
      messages: [{ role: 'user', content: user }],
    };
    if (useSearch) body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }];

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
      const retryAfter = upstream.headers.get('retry-after');
      return res.status(upstream.status).json({
        error: 'Anthropic API returned ' + upstream.status,
        details: raw.slice(0, 600),
        retryAfter: retryAfter ? parseInt(retryAfter, 10) : null,
      });
    }

    let data;
    try { data = JSON.parse(raw); }
    catch (e) { return res.status(500).json({ error: 'Could not parse Anthropic response', details: raw.slice(0, 300) }); }

    if (data.error) return res.status(500).json({ error: data.error.message || 'Anthropic error' });

    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    return res.status(200).json({ text });

  } catch (e) {
    return res.status(500).json({ error: e.message || 'Unknown server error' });
  }
}

export const config = { maxDuration: 300 };
