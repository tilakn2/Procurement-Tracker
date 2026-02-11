import { GoogleGenerativeAI } from '@google/generative-ai';

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function buildPrompt(pages) {
  const payload = pages.map((p) => ({ url: p.url, text: p.text }));

  return {
    instructions: `You analyze state/federal healthcare websites to identify early procurement signals BEFORE RFPs are published.

Look specifically for signals:
- Budget allocations ("allocates $X million for [program]")
- Waiver submissions (1915(c), 1115, SPA, etc.)
- Policy announcements / new initiatives
- Grant awards (federal/state grants)
- Program expansions (HCBS/LTSS eligibility, benefits, provider networks)
- RFP pre-announcements ("plans to procure", "seeking vendors", "market research")

Extract:
- Dollar amounts
- Timelines (quarters/years/effective dates)
- Program names (Medicaid, HCBS, LTSS, behavioral health, rural health, SUD, etc.)
- The page URL where the signal was found

Return ONLY valid JSON matching this schema exactly:
{
  "summary": "...",
  "keyPoints": ["..."],
  "procurementSignals": [
    {
      "type": "budget|waiver|policy|grant|rfp",
      "title": "...",
      "description": "...",
      "amount": "$50M" or null,
      "timeline": "Q2 2026" or null,
      "priority": "high|medium|low",
      "sourceUrl": "..."
    }
  ]
}

Rules:
- If unsure, omit rather than hallucinate.
- Prefer fewer, higher-confidence signals.
- If you cannot find any procurement signals, return an empty procurementSignals array but still provide summary and keyPoints.`,
    pages: payload,
  };
}

/**
 * Analyzes crawled pages for procurement signals using Google Gemini.
 * @param {Array<{url: string, text: string}>} pages
 */
export async function analyzePages(pages) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Missing GEMINI_API_KEY in environment.');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const promptObject = buildPrompt(pages);

  const result = await model.generateContent({
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `You are a precise analyst. You only output valid JSON and never include extra text.\n\n${JSON.stringify(promptObject)}`,
          },
        ],
      },
    ],
  });

  const text = result.response.text();
  const parsed = safeJsonParse(text);

  if (!parsed) {
    // Attempt to extract JSON block.
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first !== -1 && last !== -1 && last > first) {
      const sliced = text.slice(first, last + 1);
      const parsed2 = safeJsonParse(sliced);
      if (parsed2) return parsed2;
    }
    throw new Error('AI response was not valid JSON.');
  }

  return parsed;
}
