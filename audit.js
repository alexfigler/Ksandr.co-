export default async function handler(req, res) {
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
1. Use web search to find this specific listing. Try the URL directly, then search for identifiable details.
2. Extract everything publicly visible: exact title, full description, all amenities, photo subjects, pricing, review score and count, host info, exact location/neighborhood.
3. Search for comparable listings in the same neighborhood to benchmark against real competition.
4. Reference the SPECIFIC NEIGHBORHOOD by name in findings — not just the city.
5. Score honestly. Quick wins must be actionable this week. Revenue impact must be realistic.

Return ONLY valid JSON, no markdown, no backticks:
{"listingName":<actual title found>,"platform":<confirmed platform>,"neighborhood":<specific neighborhood identified>,"overallScore":<0-100>,"grade":<"A"|"B"|"C"|"D">,"headline":<8-12 word headline>,"summary":<2-3 sentences referencing specific submarket>,"revenueImpact":<e.g. "$200-$380/mo">,"whatWeFound":<1-2 sentences on what was scanned>,"categories":[{"name":"Title & Keywords","score":<0-100>,"status":<"strong"|"good"|"needs work"|"critical">,"finding":<specific to their actual title>,"action":<1 concrete step>},{"name":"Photos & Visual Appeal","score":<0-100>,"status":<"strong"|"good"|"needs work"|"critical">,"finding":<specific>,"action":<specific>},{"name":"Description & Copy","score":<0-100>,"status":<"strong"|"good"|"needs work"|"critical">,"finding":<specific to actual description>,"action":<specific>},{"name":"Pricing Strategy","score":<0-100>,"status":<"strong"|"good"|"needs work"|"critical">,"finding":<reference neighborhood pricing dynamics>,"action":<with numbers>},{"name":"Amenities & Positioning","score":<0-100>,"status":<"strong"|"good"|"needs work"|"critical">,"finding":<amenity gaps vs top performers in their neighborhood>,"action":<by ROI>},{"name":"Reviews & Trust Signals","score":<0-100>,"status":<"strong"|"good"|"needs work"|"critical">,"finding":<honest assessment>,"action":<specific>}],"quickWins":[<week 1>,<week 2>,<week 3>],"priorityAction":<2 sentences, highest-leverage action>,"proTeaser":<what Pro Report reveals that free scan cannot, 1-2 sentences>}`;

  let report = null;

  // ── 1. CALL CLAUDE API ──────────────────────────────────────
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

  // ── 2. SAVE TO AIRTABLE ─────────────────────────────────────
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
            'Submitted': new Date().toISOString(),
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

  // ── 3. SEND EMAIL VIA RESEND ────────────────────────────────
  try {
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey && userEmail) {
      const neighborhood = report.neighborhood || 'your market';
      const emailHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<style>
body{margin:0;padding:0;background:#e7dfd9;font-family:'DM Sans',Helvetica,Arial,sans-serif}
.wrap{max-width:560px;margin:0 auto;background:#ffffff}
.header{background:#3d4660;padding:32px 36px 28px}
.logo-row{display:flex;align-items:center;gap:10px;margin-bottom:24px}
.k-box{border:1.5px solid rgba(231,223,217,0.7);width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center}
.brand{font-size:14px;font-weight:600;letter-spacing:0.12em;color:#e7dfd9}
.score-row{display:flex;align-items:flex-end;justify-content:space-between}
.score-label{font-size:9px;letter-spacing:0.18em;text-transform:uppercase;color:#e3b59b;margin-bottom:6px}
.score-num{font-size:64px;font-weight:300;color:#e7dfd9;line-height:1}
.grade{font-size:20px;color:${report.grade === 'A' ? '#16a34a' : '#e3b59b'};margin-top:2px}
.headline{font-size:20px;font-weight:400;color:#e7dfd9;line-height:1.2;max-width:280px}
.rev-pill{margin-top:16px;padding:12px 16px;background:rgba(227,181,155,0.12);border-left:2px solid #e3b59b}
.rev-label{font-size:9px;letter-spacing:0.12em;text-transform:uppercase;color:#e3b59b;margin-bottom:3px}
.rev-val{font-size:22px;color:#e7dfd9}
.body{padding:32px 36px}
.eyebrow{font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:#e3b59b;margin-bottom:6px}
.section-title{font-size:18px;font-weight:400;color:#3d4660;margin-bottom:14px}
.qw-item{display:flex;gap:12px;padding:10px 0;border-bottom:0.5px solid #ccd5df}
.qw-num{font-size:18px;color:#e3b59b;flex-shrink:0;line-height:1.4;min-width:16px}
.qw-text{font-size:13px;color:#6f7789;line-height:1.6}
.priority{background:#3d4660;padding:16px 20px;margin:24px 0}
.priority-label{font-size:9px;letter-spacing:0.14em;text-transform:uppercase;color:#e3b59b;margin-bottom:6px}
.priority-text{font-size:15px;font-style:italic;color:#e7dfd9;line-height:1.6}
.cta-section{background:#f7f4f1;padding:24px 36px;text-align:center;border-top:0.5px solid #ccd5df}
.cta-text{font-size:13px;color:#6f7789;line-height:1.7;margin-bottom:16px}
.cta-btn{display:inline-block;background:#e3b59b;color:#1e2130;font-size:11px;font-weight:500;letter-spacing:0.1em;text-transform:uppercase;padding:13px 28px;text-decoration:none}
.pro-btn{display:inline-block;background:#3d4660;color:#e7dfd9;font-size:11px;font-weight:500;letter-spacing:0.1em;text-transform:uppercase;padding:13px 28px;text-decoration:none;margin-top:10px}
.footer{padding:20px 36px;text-align:center;background:#1e2130}
.footer p{font-size:11px;color:rgba(111,119,137,0.5);margin-bottom:4px}
.footer a{color:rgba(111,119,137,0.6);text-decoration:none}
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <div class="logo-row">
      <div class="k-box"><span style="font-family:Georgia,serif;font-size:18px;font-weight:600;color:#e7dfd9">K</span></div>
      <span class="brand">KSANDR</span>
      <span style="font-size:10px;color:rgba(204,213,223,0.4);margin-left:4px;letter-spacing:0.06em">ListingIQ</span>
    </div>
    <div class="score-row">
      <div>
        <div class="score-label">Your Audit Score &middot; ${neighborhood}</div>
        <div class="headline">${report.headline}</div>
      </div>
      <div style="text-align:right">
        <div class="score-num">${report.overallScore}</div>
        <div class="grade">Grade ${report.grade}</div>
      </div>
    </div>
    <div class="rev-pill">
      <div class="rev-label">Estimated Revenue Opportunity</div>
      <div class="rev-val">${report.revenueImpact}</div>
    </div>
  </div>

  <div class="body">
    <p style="font-size:14px;color:#6f7789;line-height:1.8;margin-bottom:20px">
      Aloha ${userName || 'there'} — here's your ListingIQ scan for <strong style="color:#3d4660">${report.listingName || listingUrl}</strong>. Here's what we found and your three fastest wins.
    </p>

    <p style="font-size:13px;color:#6f7789;line-height:1.75;margin-bottom:24px">${report.summary}</p>

    <div class="eyebrow">Quick Wins &mdash; Do These First</div>
    <div class="section-title">Your 3 fastest revenue improvements</div>
    ${(report.quickWins || []).map((w, i) => `
    <div class="qw-item">
      <span class="qw-num">${i + 1}</span>
      <span class="qw-text">${w}</span>
    </div>`).join('')}

    <div class="priority">
      <div class="priority-label">Priority Action &mdash; This Week</div>
      <p class="priority-text">"${report.priorityAction}"</p>
    </div>

    <p style="font-size:13px;color:#6f7789;line-height:1.75">
      Your full scored report (all 6 categories) is live at the link below. The <strong style="color:#3d4660">Pro Report ($99)</strong> goes deeper &mdash; ${report.proTeaser}
    </p>
  </div>

  <div class="cta-section">
    <p class="cta-text">We'll be reaching out to you personally within 1 business day to walk through your results and map out your next steps. Keep an eye on your inbox.</p>
    <div><a href="https://ksandr.co/contact" class="pro-btn" style="display:inline-block;background:#3d4660;color:#e7dfd9;font-size:11px;font-weight:500;letter-spacing:0.1em;text-transform:uppercase;padding:13px 28px;text-decoration:none;margin-bottom:10px">Get Pro Report &mdash; $99</a></div>
  </div>

  <div class="footer">
    <p>Mahalo for trusting ListingIQ by Ksandr.</p>
    <p><a href="https://ksandr.co">ksandr.co</a> &middot; <a href="mailto:hello@ksandr.co">hello@ksandr.co</a> &middot; Honolulu, Hawaii</p>
  </div>
</div>
</body>
</html>`;

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
          html: emailHtml
        })
      });
    }
  } catch (err) {
    console.error('Email send error (non-fatal):', err.message);
  }

  return res.status(200).json({ report });
}
