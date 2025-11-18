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
  
    // 예측 조위 전용 API 사용 (tideObsPre)
    // 설명: 관측소의 예측조위를 1분 단위 1일간 데이터를 조회한다.
    // 장점: 예측 조위만 제공하므로 하루 종일 데이터를 제공할 가능성이 높음
    // API 문서: https://www.khoa.go.kr/oceangrid/khoa/takepart/openapi/openApiObsTidePreDataInfo.do
    const baseUrl =
      'http://www.khoa.go.kr/api/oceangrid/tideObsPre/search.do';
  
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