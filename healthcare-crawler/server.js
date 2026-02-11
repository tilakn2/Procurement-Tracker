import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { crawlWebsite } from './crawler.js';
import { analyzePages } from './analyzer.js';

dotenv.config();

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  credentials: false
}));

app.use(express.json({ limit: '2mb' }));

function isValidHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

app.post('/api/analyze', async (req, res) => {
  const { url } = req.body || {};

  if (!url || typeof url !== 'string' || !isValidHttpUrl(url)) {
    return res.status(400).json({
      error: 'Invalid url. Provide a valid http(s) URL in JSON body: { "url": "https://example.gov" }',
    });
  }

  const startedAt = Date.now();

  try {
    console.log(`[analyze] Starting crawl: ${url}`);
    const { pages, crawledCount } = await crawlWebsite(url);
    console.log(`[analyze] Crawl finished. Pages crawled: ${crawledCount}`);

    // Return partial results even if crawl found nothing useful.
    if (!pages.length) {
      return res.json({
        summary: 'No content could be extracted from the provided URL.',
        keyPoints: [],
        procurementSignals: [],
      });
    }

    console.log(`[analyze] Starting AI analysis (pages: ${pages.length})`);
    const analysis = await analyzePages(pages);

    const elapsedMs = Date.now() - startedAt;
    console.log(`[analyze] Analysis complete in ${elapsedMs}ms. Signals: ${analysis?.procurementSignals?.length ?? 0}`);

    return res.json(analysis);
  } catch (err) {
    const message = err?.message || String(err);
    console.error('[analyze] Error:', message);

    // Common misconfig
    if (message.includes('GEMINI_API_KEY')) {
      return res.status(500).json({ error: message });
    }

    return res.status(500).json({ error: 'Failed to analyze website.', detail: message });
  }
});

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

if (process.env.NODE_ENV !== 'production') {
  const port = Number(process.env.PORT || 3001);
  app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });
}

export default app;
