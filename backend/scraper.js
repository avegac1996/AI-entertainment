const cheerio = require('cheerio');

const UPS_URL = 'https://www.ups.edu.ec/';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hora
const MAX_CONTEXT_CHARS = 2500;
const FETCH_TIMEOUT_MS = 10000;

let cache = { text: '', updatedAt: 0 };

function normalize(text) {
  return text.replace(/\s+/g, ' ').trim();
}

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JARVIS-UPS/1.0)' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
  return res.text();
}

function extractContent(html, baseUrl) {
  const $ = cheerio.load(html);
  $('script, style, noscript, iframe, form, nav, footer, header').remove();

  const parts = [];

  const title = normalize($('title').first().text());
  if (title) parts.push(title);

  const metaDesc = $('meta[name="description"]').attr('content');
  if (metaDesc) parts.push(normalize(metaDesc));

  $('h1, h2, h3').each((_, el) => {
    const t = normalize($(el).text());
    if (t.length > 3) parts.push(t);
  });

  $('p, li').each((_, el) => {
    const t = normalize($(el).text());
    if (t.length > 40) parts.push(t);
  });

  // Enlaces internos de noticias/eventos para enriquecer el contexto
  const newsLinks = [];
  const baseOrigin = new URL(baseUrl).origin;
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    try {
      const abs = new URL(href, baseUrl);
      if (abs.origin === baseOrigin && /noticia|evento|actualidad|novedad/i.test(abs.pathname)) {
        newsLinks.push(abs.href);
      }
    } catch {
      // URL inválida, ignorar
    }
  });

  return { text: parts.join('. '), newsLinks: [...new Set(newsLinks)].slice(0, 2) };
}

async function scrapeUPS() {
  try {
    const html = await fetchPage(UPS_URL);
    const main = extractContent(html, UPS_URL);
    let combined = main.text;

    for (const link of main.newsLinks) {
      try {
        const subHtml = await fetchPage(link);
        combined += '. ' + extractContent(subHtml, link).text;
      } catch {
        // subpágina falló, continuar con lo que hay
      }
    }

    cache = { text: combined.slice(0, MAX_CONTEXT_CHARS), updatedAt: Date.now() };
    console.log(`[scraper] ups.edu.ec actualizado: ${cache.text.length} caracteres`);
  } catch (err) {
    console.warn('[scraper] No se pudo obtener ups.edu.ec:', err.message);
  }
}

async function getUPSContext() {
  if (Date.now() - cache.updatedAt > CACHE_TTL_MS) {
    await scrapeUPS();
  }
  return cache.text;
}

module.exports = { getUPSContext, scrapeUPS };
