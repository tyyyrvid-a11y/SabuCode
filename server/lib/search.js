const cheerio = require('cheerio');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Strips DuckDuckGo's redirect wrapper (//duckduckgo.com/l/?uddg=<encoded>&...) into a real URL.
function unwrapDuckDuckGoUrl(href) {
  if (!href) return href;
  try {
    const url = href.startsWith('//') ? `https:${href}` : href;
    const parsed = new URL(url, 'https://duckduckgo.com');
    if (parsed.hostname.includes('duckduckgo.com') && parsed.pathname.startsWith('/l/')) {
      const uddg = parsed.searchParams.get('uddg');
      if (uddg) return decodeURIComponent(uddg);
    }
    return url;
  } catch {
    return href;
  }
}

async function searchDuckDuckGo(query, { limit = 8 } = {}) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9'
    }
  });

  if (!res.ok) {
    const err = new Error(`DuckDuckGo search failed (${res.status})`);
    err.status = 502;
    throw err;
  }

  const html = await res.text();
  const $ = cheerio.load(html);
  const results = [];

  $('.result').each((_, el) => {
    if (results.length >= limit) return;
    const titleEl = $(el).find('.result__title a.result__a').first();
    const snippetEl = $(el).find('.result__snippet').first();
    const title = titleEl.text().trim();
    const rawHref = titleEl.attr('href');
    const url = unwrapDuckDuckGoUrl(rawHref);
    const snippet = snippetEl.text().trim();

    if (title && url) {
      results.push({ title, url, snippet });
    }
  });

  return results;
}

const BLOCKED_HOSTNAME_RE =
  /^(localhost|127\.|0\.0\.0\.0|10\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|\[::1\])/i;

function assertPublicHttpUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    const err = new Error('Invalid URL');
    err.status = 400;
    throw err;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    const err = new Error('Only http/https URLs are allowed');
    err.status = 400;
    throw err;
  }
  if (BLOCKED_HOSTNAME_RE.test(parsed.hostname)) {
    const err = new Error('Fetching internal/private addresses is not allowed');
    err.status = 400;
    throw err;
  }
  return parsed;
}

async function fetchUrlContent(rawUrl, { maxChars = 4000 } = {}) {
  const parsed = assertPublicHttpUrl(rawUrl);

  const res = await fetch(parsed.toString(), {
    method: 'GET',
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
    redirect: 'follow'
  });

  if (!res.ok) {
    const err = new Error(`Fetch failed (${res.status})`);
    err.status = 502;
    throw err;
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
    return { url: parsed.toString(), title: null, text: `[Unsupported content type: ${contentType}]` };
  }

  const html = await res.text();
  const $ = cheerio.load(html);
  $('script, style, noscript, svg').remove();
  const title = $('title').first().text().trim() || null;
  const text = $('body').text().replace(/\s+/g, ' ').trim().slice(0, maxChars);

  return { url: parsed.toString(), title, text };
}

module.exports = { searchDuckDuckGo, fetchUrlContent };
