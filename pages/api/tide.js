// pages/api/tide.js

export default async function handler(req, res) {
    const { obsCode, date } = req.query;
  
    if (!obsCode || !date) {
      return res.status(400).json({ error: 'Missing obsCode or date' });
    }
  
    const serviceKey = process.env.KHOA_SERVICE_KEY;
  
    if (!serviceKey) {
      return res.status(500).json({ error: 'Service key not configured' });
    }
  
    const baseUrl =
      'http://www.khoa.go.kr/api/oceangrid/tideCurPre/search.do';
  
    const url = `${baseUrl}?ServiceKey=${serviceKey}&ObsCode=${obsCode}&Date=${date}&ResultType=json`;
  
    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.error('KHOA API error status:', response.status);
        return res.status(502).json({ error: 'Failed to fetch tide data' });
      }
  
      const data = await response.json();
      return res.status(200).json(data);
    } catch (error) {
      console.error('KHOA API error:', error);
      return res.status(500).json({ error: 'Failed to fetch tide data' });
    }
  }