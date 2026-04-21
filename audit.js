export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { listingUrl, platform, occupancy, reviewScore, reviewCount, pricingTool, minNights, goals, extra, neighborhood } = req.body;

  if (!listingUrl) return res.status(400).json({ error: 'Listing URL is required' });

  const prompt = `You are ListingIQ — an expert vacation rental consultant with 6+ years of OTA strategy experience.

A vacation rental owner has submitted their listing URL for a full audit. Use web search to research this listing and gather all publicly available information, then combine with the performance data they provided to produce a detailed, accurate audit.

LISTING URL: ${listingUrl}
PLATFORM: ${platform || 'Unknown — determine from URL'}

PERFORMANCE DATA (provided by owner — not publicly visible):
- Occupancy Rate: ${occupancy || 'Not provided'}%
- Review Score: ${reviewScore || 'Not provided'}/5
- Review Count: ${reviewCount || 'Not provided'}
- Pricing Tool: ${pricingTool || 'Not provided'}
- Minimum Nights: ${minNights || 'Not provided'}
- Neighborhood/Area: ${neighborhood || 'Determine from listing'}
- Biggest Challenge: "${goals || 'Not provided'}"
- Additional Context: "${extra || 'None'}"

INSTRUCTIONS:
1. Use web search to find this specific listing. Search for the URL directly, or search for the listing title/location if the URL doesn't surface it directly.
2. Extract everything publicly visible: listing title, description, photos (what rooms/subjects are shown), all amenities listed, pricing if visible, review score, review count, host details, location/neighborhood.
3. Also search for comparable listings in the same neighborhood to benchmark this listing against its real competition.
4. Reference the SPECIFIC NEIGHBORHOOD by name throughout your findings — not just the city.
5. Score honestly based on what you actually find — don't inflate.
6. Quick wins must be actionable THIS WEEK.
7. Revenue impact must be realistic for this market.

Return ONLY a valid JSON object. No markdown, no backticks, no text before or after:

{
  "listingName": "<the actual listing title you found>",
  "platform": "<platform you confirmed>",
  "neighborhood": "<specific neighborhood/area you identified>",
  "overallScore": <integer 0-100>,
  "grade": <"A"|"B"|"C"|"D">,
  "headline": <punchy 8-12 word headline specific to what you found>,
  "summary": <2-3 sentences honest assessment referencing the specific submarket and what you found>,
  "revenueImpact": <realistic monthly revenue increase as string e.g. "$200-$380/mo">,
  "whatWeFound": <1-2 sentences on what you were able to scan from the public listing>,
  "categories": [
    {
      "name": "Title & Keywords",
      "score": <0-100>,
      "status": <"strong"|"good"|"needs work"|"critical">,
      "finding": <specific finding based on their actual title and neighborhood search behavior>,
      "action": <1 concrete actionable step>
    },
    {
      "name": "Photos & Visual Appeal",
      "score": <0-100>,
      "status": <"strong"|"good"|"needs work"|"critical">,
      "finding": <specific finding based on what photos you could identify>,
      "action": <1 concrete actionable step>
    },
    {
      "name": "Description & Copy",
      "score": <0-100>,
      "status": <"strong"|"good"|"needs work"|"critical">,
      "finding": <specific finding based on actual description content>,
      "action": <1 concrete actionable step>
    },
    {
      "name": "Pricing Strategy",
      "score": <0-100>,
      "status": <"strong"|"good"|"needs work"|"critical">,
      "finding": <specific finding referencing neighborhood pricing dynamics and their rate vs comps>,
      "action": <1 concrete actionable step with numbers where possible>
    },
    {
      "name": "Amenities & Positioning",
      "score": <0-100>,
      "status": <"strong"|"good"|"needs work"|"critical">,
      "finding": <specific finding on amenity gaps vs top performers in their neighborhood>,
      "action": <1 concrete actionable step prioritized by ROI>
    },
    {
      "name": "Reviews & Trust Signals",
      "score": <0-100>,
      "status": <"strong"|"good"|"needs work"|"critical">,
      "finding": <honest assessment based on review score, count, recency, and any review content you found>,
      "action": <1 concrete actionable step>
    }
  ],
  "quickWins": [
    <specific quick win #1 actionable this week>,
    <specific quick win #2 actionable this week>,
    <specific quick win #3 actionable this week>
  ],
  "priorityAction": <the single highest-leverage action for this specific listing and submarket, 2 sentences>,
  "proTeaser": <1-2 sentences on what the Pro Report reveals that this free scan cannot fully show — be specific>
}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'interleaved-thinking-2025-05-14'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8000,
        thinking: { type: 'enabled', budget_tokens: 5000 },
        tools: [
          {
            type: 'web_search_20250305',
            name: 'web_search',
            max_uses: 8
          }
        ],
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Anthropic API error:', err);
      return res.status(500).json({ error: 'API error', detail: err });
    }

    const data = await response.json();

    // Extract the text response (may be in different content blocks)
    let text = '';
    for (const block of data.content || []) {
      if (block.type === 'text') {
        text += block.text;
      }
    }

    // Clean and parse JSON
    const clean = text.trim().replace(/```json|```/g, '').trim();

    // Find JSON object in response
    const jsonStart = clean.indexOf('{');
    const jsonEnd = clean.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) {
      console.error('No JSON found in response:', clean);
      return res.status(500).json({ error: 'Could not parse report from AI response' });
    }

    const jsonStr = clean.slice(jsonStart, jsonEnd + 1);
    const report = JSON.parse(jsonStr);

    return res.status(200).json({ report });

  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ error: err.message || 'Unknown error' });
  }
}
