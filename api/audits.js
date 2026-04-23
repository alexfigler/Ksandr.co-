module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    listingUrl, platform, neighborhood, occupancy, reviewScore,
    reviewCount, pricingTool, minNights, goals, extra,
    userName, userEmail
  } = req.body;

  if (!listingUrl) return res.status(400).json({ error: 'Listing URL is required' });

  const prompt = `You are ListingIQ — an expert vacation rental consultant with 6+ years of OTA strategy experience.

A vacation rental owner has submitted their listing URL for a full audit. Use web search to find this listing and gather all publicly available information, then combine with the performance data they provided to produce a detailed, accurate audit.

LISTING URL: ${listingUrl}
PLATFORM: ${platform || 'Determine from URL'}
NEIGHBORHOOD HINT: ${neighborhood || 'Determine from listing'}

PERFORMANCE DATA (private — from host dashboard):
- Occupancy Rate: ${occupancy || 'Not provided'}
- Review Score: ${reviewScore || 'Not provided'}/5
- Review Count: ${reviewCount || 'Not provided'}
- Pricing Tool: ${pricingTool || 'Not provided'}
- Minimum Nights: ${minNights || 'Not provided'}
- Biggest Challenge: "${goals || 'Not provided'}"
- Additional Context: "${extra || 'None'}"

INSTRUCTIONS:
1. Use web search to find this specific listing.
2. Extract everything publicly visible: exact title, full description, all amenities, photo subjects, pricing, review score and count, host info, exact location/neighborhood.
3. Search for comparable listings in the same neighborhood to benchmark against real competition.
4. Reference the SPECIFIC NEIGHBORHOOD by name in findings — not just the city.
5. Score honestly. Quick wins must be actionable this week. Revenue impact must be realistic.

Return ONLY valid JSON, no markdown, no backticks:
{"listingName":<actual title found>,"platform":<confirmed platform>,"neighborhood":<specific neighborhood identified>,"overallScore":<0-100>,"grade":<"A"|"B"|"C"|"D">,"headline":<8-12 word headline>,"summary":<2-3 sentences referencing specific submarket>,"revenueImpact":<e.g. "$200-$380/mo">,"whatWeFound":<1-2 sentences on what was scanned>,"categories":[{"name":"Title & Keywords","score":<0-100>,"status":<"strong"|"good"|"needs work"|"critical">,"finding":<specific to their actual title>,"action":<1 concrete step>},{"name":"Photos & Visual Appeal","score":<0-100>,"status":<"strong"|"good"|"needs work"|"critical">,"finding":<specific>,"action":<specific>},{"name":"Description & Copy","score":<0-100>,"status":<"strong"|"good"|"needs work"|"critical">,"finding":<specific to actual description>,"action":<specific>},{"name":"Pricing Strategy","score":<0-100>,"status":<"strong"|"good"|"needs work"|"critical">,"finding":<reference neighborhood pricing dynamics>,"action":<with numbers>},{"name":"Amenities & Positioning","score":<0-100>,"status":<"strong"|"good"|"needs work"|"critical">,"finding":<amenity gaps vs top performers in their neighborhood>,"action":<by ROI>},{"name":"Reviews & Trust Signals","score":<0-100>,"status":<"strong"|"good"|"needs work"|"critical">,"finding":<honest assessment>,"action":<specific>}],"quickWins":[<week 1>,<week 2>,<week 3>],"priorityAction":<2 sentences, highest-leverage action>,"proTeaser":<what Pro Report reveals that free scan cannot, 1-2 sentences>}`;

  let report = null;

  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 8 }],
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!aiRes.ok) {
      const err = await aiRes.text();
      return res.status(500).json({ error: 'AI API error', detail: err });
    }

    const aiData = await aiRes.json();
    let text = '';
    for (const block of aiData.content || []) {
      if (block.type === 'text') text += block.text;
    }

    const clean = text.trim().replace(/```json|```/g, '').trim();
    const jsonStart = clean.indexOf('{');
    const jsonEnd = clean.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) {
      return res.status(500).json({ error: 'Could not parse report from AI response' });
    }
    report = JSON.parse(clean.slice(jsonStart, jsonEnd + 1));
  } catch (err) {
    return res.status(500).json({ error: 'Failed to generate report: ' + err.message });
  }

  // Save to Airtable
  try {
    const airtableBaseId = process.env.AIRTABLE_BASE_ID;
    const airtableApiKey = process.env.AIRTABLE_API_KEY;
    if (airtableBaseId && airtableApiKey) {
      await fetch(`https://api.airtable.com/v0/${airtableBaseId}/Leads`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${airtableApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          fields: {
            'Name': userName || 'Unknown',
            'Email': userEmail || '',
            'Listing URL': listingUrl,
            'Platform': report.platform || platform || 'Unknown',
            'Listing Name': report.listingName || '',
            'Neighborhood': report.neighborhood || neighborhood || '',
            'Overall Score': report.overallScore || 0,
            'Grade': report.grade || '',
            'Revenue Impact': report.revenueImpact || '',
            'Occupancy Provided': occupancy || 'Not provided',
            'Pricing Tool': pricingTool || 'Not provided',
            'Goals': goals || '',
            'Extra Context': extra || '',
            'What We Found': report.whatWeFound || '',
            'Summary': report.summary || '',
            'Priority Action': report.priorityAction || '',
            'Quick Win 1': (report.quickWins || [])[0] || '',
            'Quick Win 2': (report.quickWins || [])[1] || '',
            'Quick Win 3': (report.quickWins || [])[2] || '',
            'Status': 'New Lead',
            'Full Report JSON': JSON.stringify(report)
          }
        })
      });
    }
  } catch (err) {
    console.error('Airtable save error (non-fatal):', err.message);
  }

  // Send email via Resend
  try {
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey && userEmail) {
      const nbhd = report.neighborhood || 'your market';
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'Ksandr ListingIQ <hello@ksandr.co>',
          to: [userEmail],
          subject: `Your ListingIQ Report — Score: ${report.overallScore}/100 (Grade ${report.grade})`,
          html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;background:#ffffff">
            <div style="background:#3d4660;padding:32px 36px">
              <p style="font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:#e3b59b;margin-bottom:16px">ListingIQ Audit Report · ${nbhd}</p>
              <h1 style="font-size:28px;font-weight:400;color:#e7dfd9;margin-bottom:8px">${report.headline}</h1>
              <p style="font-size:48px;font-weight:300;color:#e7dfd9;margin:0;line-height:1">${report.overallScore} <span style="font-size:20px">Grade ${report.grade}</span></p>
              <div style="margin-top:16px;padding:12px 16px;background:rgba(227,181,155,0.12);border-left:2px solid #e3b59b">
                <p style="font-size:9px;letter-spacing:0.12em;text-transform:uppercase;color:#e3b59b;margin-bottom:4px">Estimated Revenue Opportunity</p>
                <p style="font-size:24px;color:#e7dfd9;margin:0">${report.revenueImpact}</p>
              </div>
            </div>
            <div style="padding:32px 36px">
              <p style="font-size:14px;color:#6f7789;line-height:1.8">Aloha ${userName || 'there'} — here's your ListingIQ scan. We'll be reaching out personally within 1 business day to walk through your results.</p>
              <p style="font-size:13px;color:#6f7789;line-height:1.75;margin-top:14px">${report.summary}</p>
              <h2 style="font-size:16px;font-weight:500;color:#3d4660;margin:24px 0 14px">Quick Wins — Do These First</h2>
              ${(report.quickWins || []).map((w, i) => `<div style="display:flex;gap:12px;padding:10px 0;border-bottom:0.5px solid #ccd5df"><span style="font-size:18px;color:#e3b59b;flex-shrink:0">${i+1}</span><span style="font-size:13px;color:#6f7789;line-height:1.6">${w}</span></div>`).join('')}
              <div style="background:#3d4660;padding:16px 20px;margin:24px 0">
                <p style="font-size:9px;letter-spacing:0.14em;text-transform:uppercase;color:#e3b59b;margin-bottom:6px">Priority Action — This Week</p>
                <p style="font-size:14px;font-style:italic;color:#e7dfd9;line-height:1.65">"${report.priorityAction}"</p>
              </div>
              <p style="font-size:13px;color:#6f7789;line-height:1.75">Want to go deeper? The <strong style="color:#3d4660">Pro Report ($99)</strong> — ${report.proTeaser}</p>
              <div style="text-align:center;margin-top:24px;padding-top:20px;border-top:0.5px solid #ccd5df">
                <a href="https://ksandr.co/contact" style="display:inline-block;background:#3d4660;color:#e7dfd9;font-size:11px;font-weight:500;letter-spacing:0.1em;text-transform:uppercase;padding:13px 28px;text-decoration:none">Get Pro Report — $99</a>
              </div>
            </div>
            <div style="background:#1e2130;padding:20px 36px;text-align:center">
              <p style="font-size:11px;color:rgba(111,119,137,0.5)">Mahalo for trusting ListingIQ by Ksandr · <a href="https://ksandr.co" style="color:rgba(111,119,137,0.6)">ksandr.co</a> · hello@ksandr.co</p>
            </div>
          </div>`
        })
      });
    }
  } catch (err) {
    console.error('Email send error (non-fatal):', err.message);
  }

  return res.status(200).json({ report });
}
