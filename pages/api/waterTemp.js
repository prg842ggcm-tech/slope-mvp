// pages/api/waterTemp.js

export default async function handler(req, res) {
  const { obsCode, date } = req.query;

  if (!obsCode || !date) {
    return res.status(400).json({ error: 'Missing obsCode or date' });
  }

  const serviceKey = process.env.KHOA_SERVICE_KEY;

  if (!serviceKey) {
    return res.status(500).json({ error: 'Service key not configured' });
  }

  // 조위관측소 실측 수온 API 사용
  // 설명: 관측소에서 관측하는 수온값을 1분 단위 1일간 데이터를 조회한다.
  // API 문서: https://www.khoa.go.kr/oceangrid/khoa/takepart/openapi/openApiObsTempTideRealDataInfo.do
  const baseUrl =
    'http://www.khoa.go.kr/api/oceangrid/tideObsTemp/search.do';

  const url = `${baseUrl}?ServiceKey=${serviceKey}&ObsCode=${obsCode}&Date=${date}&ResultType=json`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error('KHOA API error status:', response.status);
      return res.status(502).json({ error: 'Failed to fetch water temperature data' });
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    console.error('KHOA API error:', error);
    return res.status(500).json({ error: 'Failed to fetch water temperature data' });
  }
}

