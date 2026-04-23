export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const auth = req.headers['authorization'] || '';
  if (auth.replace('Bearer ', '') !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const baseId = process.env.AIRTABLE_BASE_ID;
  const apiKey = process.env.AIRTABLE_API_KEY;
  if (!baseId || !apiKey) return res.status(500).json({ error: 'Airtable not configured' });

  // PATCH — update status
  if (req.method === 'PATCH') {
    const { recordId, status } = req.body;
    if (!recordId || !status) return res.status(400).json({ error: 'Missing recordId or status' });
    try {
      await fetch(`https://api.airtable.com/v0/${baseId}/Leads/${recordId}`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { 'Status': status } })
      });
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // GET — fetch all leads
  if (req.method === 'GET') {
    try {
      const url = `https://api.airtable.com/v0/${baseId}/Leads?sort%5B0%5D%5Bfield%5D=Submitted&sort%5B0%5D%5Bdirection%5D=desc&maxRecords=200`;
      const atRes = await fetch(url, { headers: { 'Authorization': `Bearer ${apiKey}` } });
      if (!atRes.ok) {
        const errBody = await atRes.text();
        return res.status(500).json({ error: 'Airtable fetch error', status: atRes.status, detail: errBody, baseId: baseId, keyStart: apiKey ? apiKey.substring(0,8) : 'missing' });
      }
      const data = await atRes.json();
      const leads = (data.records || []).map(r => ({
        id: r.id,
        name: r.fields['Name'] || '',
        email: r.fields['Email'] || '',
        submitted: r.fields['Submitted'] || '',
        listingUrl: r.fields['Listing URL'] || '',
        platform: r.fields['Platform'] || '',
        listingName: r.fields['Listing Name'] || '',
        neighborhood: r.fields['Neighborhood'] || '',
        score: r.fields['Overall Score'] || 0,
        grade: r.fields['Grade'] || '',
        revenueImpact: r.fields['Revenue Impact'] || '',
        occupancy: r.fields['Occupancy Provided'] || '',
        pricingTool: r.fields['Pricing Tool'] || '',
        goals: r.fields['Goals'] || '',
        status: r.fields['Status'] || 'New Lead',
        summary: r.fields['Summary'] || '',
        priorityAction: r.fields['Priority Action'] || '',
        quickWin1: r.fields['Quick Win 1'] || '',
        quickWin2: r.fields['Quick Win 2'] || '',
        quickWin3: r.fields['Quick Win 3'] || '',
      }));
      return res.status(200).json({ leads, total: leads.length });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
