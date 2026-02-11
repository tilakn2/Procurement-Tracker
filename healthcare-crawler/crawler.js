import { PlaywrightCrawler } from 'crawlee';

const MAX_PAGES = 50;
const MAX_TEXT_CHARS_PER_PAGE = 12000;

function normalizeUrl(url) {
  try {
    return new URL(url).toString();
  } catch {
    return null;
  }
}

/**
 * Deep-crawls a website using a same-domain strategy.
 * @param {string} startUrl
 * @returns {Promise<{ pages: Array<{ url: string, text: string }>, aggregatedText: string, crawledCount: number }>} 
 */
export async function crawlWebsite(startUrl) {
  const normalizedStartUrl = normalizeUrl(startUrl);
  if (!normalizedStartUrl) {
    throw new Error('Invalid start URL.');
  }

  const startDomain = new URL(normalizedStartUrl).hostname;

  const pages = [];

  const crawler = new PlaywrightCrawler({
    maxRequestsPerCrawl: MAX_PAGES,
    maxConcurrency: 3,
    requestHandlerTimeoutSecs: 60,
    navigationTimeoutSecs: 45,
    async requestHandler({ request, page, enqueueLinks, log }) {
      const currentUrl = request.loadedUrl || request.url;

      try {
        await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
      } catch {
        // Continue even if load state times out.
      }

      let text = '';
      try {
        text = await page.evaluate(() => {
          const el = document.body;
          const raw = el ? (el.innerText || '') : '';
          return raw.replace(/\n{3,}/g, '\n\n').trim();
        });
      } catch (err) {
        log.warning(`Failed to extract text for ${currentUrl}: ${err?.message || err}`);
      }

      if (text.length > MAX_TEXT_CHARS_PER_PAGE) {
        text = text.slice(0, MAX_TEXT_CHARS_PER_PAGE);
      }

      const pageHostname = (() => {
        try {
          return new URL(currentUrl).hostname;
        } catch {
          return null;
        }
      })();

      if (pageHostname === startDomain) {
        pages.push({ url: currentUrl, text });
        log.info(`Crawled (${pages.length}/${MAX_PAGES}): ${currentUrl} (chars: ${text.length})`);
      } else {
        log.info(`Skipped out-of-domain page: ${currentUrl}`);
      }

      // Continue discovering links on same domain.
      try {
        await enqueueLinks({
          strategy: 'same-hostname',
          // Avoid a few common non-content link types and normalize www vs non-www
          transformRequestFunction: (req) => {
            const u = normalizeUrl(req.url);
            if (!u) return null;

            // Normalize www vs non-www
            const normalized = u.replace('://www.', '://');

            const lower = normalized.toLowerCase();
            if (
              lower.endsWith('.pdf') ||
              lower.endsWith('.jpg') ||
              lower.endsWith('.jpeg') ||
              lower.endsWith('.png') ||
              lower.endsWith('.gif') ||
              lower.endsWith('.svg')
            ) {
              return null;
            }

            // Ensure we only keep same-domain links.
            try {
              const host = new URL(normalized).hostname;
              if (host !== startDomain) return null;
            } catch {
              return null;
            }

            return { ...req, url: normalized };
          },
        });
      } catch (err) {
        log.warning(`enqueueLinks failed on ${currentUrl}: ${err?.message || err}`);
      }
    },
    failedRequestHandler({ request, log }) {
      log.warning(`Request failed repeatedly: ${request.url}`);
    },
  });

  await crawler.run([normalizedStartUrl]);

  const aggregatedText = pages
    .map((p) => `SOURCE URL: ${p.url}\n\n${p.text}`)
    .join('\n\n---\n\n');

  return {
    pages,
    aggregatedText,
    crawledCount: pages.length,
  };
}
