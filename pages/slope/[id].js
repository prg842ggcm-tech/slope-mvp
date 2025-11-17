// pages/slope/[id].js
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import slopes from '../../data/slopes.json';

function formatTimeLabel(dateStr) {
  const d = new Date(dateStr.replace(' ', 'T'));
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

function getTodayString() {
  const now = new Date();
  const y = now.getFullYear();
  const m = (now.getMonth() + 1).toString().padStart(2, '0');
  const d = now.getDate().toString().padStart(2, '0');
  return `${y}${m}${d}`;
}

async function getSunTimes(lat, lng) {
  try {
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${(today.getMonth() + 1).toString().padStart(2, '0')}-${today.getDate().toString().padStart(2, '0')}`;
    const url = `https://api.sunrise-sunset.org/json?lat=${lat}&lng=${lng}&date=${dateStr}&formatted=0`;
    const res = await fetch(url);
    const data = await res.json();
    
    if (data.status === 'OK' && data.results) {
      // API는 UTC 시간을 반환하므로 한국 시간(KST, UTC+9)으로 변환
      const sunrise = new Date(data.results.sunrise);
      const sunset = new Date(data.results.sunset);
      
      // 한국 시간으로 변환 (UTC+9)
      const kstOffset = 9 * 60 * 60 * 1000; // 9시간을 밀리초로
      const sunriseKST = new Date(sunrise.getTime() + kstOffset);
      const sunsetKST = new Date(sunset.getTime() + kstOffset);
      
      // YYYY-MM-DD HH:mm 형식으로 변환 (로컬 시간 사용)
      const formatKST = (date) => {
        const y = date.getFullYear();
        const m = (date.getMonth() + 1).toString().padStart(2, '0');
        const d = date.getDate().toString().padStart(2, '0');
        const h = date.getHours().toString().padStart(2, '0');
        const min = date.getMinutes().toString().padStart(2, '0');
        return `${y}-${m}-${d} ${h}:${min}`;
      };
      
      return {
        sunrise: formatKST(sunriseKST),
        sunset: formatKST(sunsetKST)
      };
    }
    return null;
  } catch (e) {
    console.error('Failed to fetch sun times:', e);
    return null;
  }
}

function getTimePosition(timeStr, dataStartTime, dataEndTime) {
  if (!timeStr || !dataStartTime || !dataEndTime) return null;
  
  const time = new Date(timeStr.replace(' ', 'T'));
  const start = new Date(dataStartTime.replace(' ', 'T'));
  const end = new Date(dataEndTime.replace(' ', 'T'));
  
  if (time < start || time > end) return null;
  
  const totalMs = end - start;
  const timeMs = time - start;
  const position = (timeMs / totalMs) * 100;
  
  return Math.max(0, Math.min(100, position));
}

function classifyLevels(data, minLevel) {
  if (!data || data.length === 0) return [];

  // 24시간 가정 (실제는 더 많을 수도 있지만 MVP로 단순화)
  return data.map((item) => {
    const value = Number(item.pre_value || item.real_value || 0);
    if (value >= minLevel + 20) return 'good';
    if (value >= minLevel) return 'caution';
    return 'bad';
  });
}

function getBestWindow(data, minLevel) {
  if (!data || data.length === 0) return null;

  const levels = data.map((item) => Number(item.pre_value || item.real_value || 0));
  const times = data.map((item) => item.record_time);

  let bestStartIdx = -1;
  let bestEndIdx = -1;
  let currentStart = -1;

  for (let i = 0; i < levels.length; i++) {
    if (levels[i] >= minLevel) {
      if (currentStart === -1) currentStart = i;
    } else {
      if (currentStart !== -1) {
        if (bestStartIdx === -1 || i - 1 - currentStart > bestEndIdx - bestStartIdx) {
          bestStartIdx = currentStart;
          bestEndIdx = i - 1;
        }
        currentStart = -1;
      }
    }
  }

  if (currentStart !== -1) {
    if (bestStartIdx === -1 || levels.length - 1 - currentStart > bestEndIdx - bestStartIdx) {
      bestStartIdx = currentStart;
      bestEndIdx = levels.length - 1;
    }
  }

  if (bestStartIdx === -1) return null;

  return {
    startTime: times[bestStartIdx],
    endTime: times[bestEndIdx],
    min: Math.min(...levels.slice(bestStartIdx, bestEndIdx + 1)),
    max: Math.max(...levels.slice(bestStartIdx, bestEndIdx + 1))
  };
}

function getSummaryStatus(window, minLevel) {
  if (!window) {
    return {
      label: '오늘 불가',
      detail: '가용 구간 없음',
      tone: 'bad'
    };
  }

  const durationHours =
    (new Date(window.endTime) - new Date(window.startTime)) / (1000 * 60 * 60);

  if (durationHours >= 10) {
    return {
      label: '오늘 대부분 가능',
      detail: `${formatTimeLabel(window.startTime)} ~ ${formatTimeLabel(
        window.endTime
      )}`,
      tone: 'good'
    };
  }

  return {
    label: '오늘 일부 가능',
    detail: `${formatTimeLabel(window.startTime)} ~ ${formatTimeLabel(
      window.endTime
    )}`,
    tone: 'caution'
  };
}

function findTideExtremes(data) {
  if (!data || data.length === 0) return [];

  const values = data.map((d) => Number(d.pre_value || d.real_value || 0));
  const extremes = [];

  // 중간 지점에서 간조/만조 찾기 (로컬 최소값/최대값)
  for (let i = 1; i < values.length - 1; i++) {
    // 간조: 이전 값과 다음 값보다 작은 지점 (로컬 최소값)
    if (values[i] < values[i - 1] && values[i] < values[i + 1]) {
      extremes.push({
        type: '간조',
        value: values[i],
        time: data[i].record_time
      });
    }
    // 만조: 이전 값과 다음 값보다 큰 지점 (로컬 최대값)
    if (values[i] > values[i - 1] && values[i] > values[i + 1]) {
      extremes.push({
        type: '만조',
        value: values[i],
        time: data[i].record_time
      });
    }
  }

  // 시작 지점 확인 (오늘 하루의 시작이므로 포함)
  if (values.length >= 2) {
    if (values[0] < values[1]) {
      extremes.push({
        type: '간조',
        value: values[0],
        time: data[0].record_time
      });
    } else if (values[0] > values[1]) {
      extremes.push({
        type: '만조',
        value: values[0],
        time: data[0].record_time
      });
    }
  }

  // 끝 지점 확인 (오늘 하루의 끝이므로 포함)
  if (values.length >= 2) {
    const lastIdx = values.length - 1;
    if (values[lastIdx] < values[lastIdx - 1]) {
      extremes.push({
        type: '간조',
        value: values[lastIdx],
        time: data[lastIdx].record_time
      });
    } else if (values[lastIdx] > values[lastIdx - 1]) {
      extremes.push({
        type: '만조',
        value: values[lastIdx],
        time: data[lastIdx].record_time
      });
    }
  }

  // 시간순으로 정렬
  extremes.sort((a, b) => new Date(a.time) - new Date(b.time));

  return extremes;
}

export default function SlopeDetail() {
  const router = useRouter();
  const { id } = router.query;

  const slope = slopes.find((s) => s.id === id);

  const [tideData, setTideData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [error, setError] = useState(null);
  const [sunTimes, setSunTimes] = useState(null);

  useEffect(() => {
    if (!slope) return;

    const fetchTide = async () => {
      setLoading(true);
      setError(null);
      try {
        const today = getTodayString();
        const res = await fetch(
          `/api/tide?obsCode=${slope.obsCode}&date=${today}`
        );
        const json = await res.json();
        if (json.error) {
          setError(json.error);
          setTideData(null);
        } else {
          setTideData(json.result?.data || []);
        }
      } catch (e) {
        setError('데이터를 불러오지 못했습니다.');
        setTideData(null);
      } finally {
        setLoading(false);
        setUpdatedAt(
          new Date().toTimeString().slice(0, 5) // HH:MM
        );
      }
    };

    fetchTide();

    // 일출/일몰 시간 가져오기
    const fetchSunTimes = async () => {
      if (slope.lat && slope.lng) {
        const times = await getSunTimes(slope.lat, slope.lng);
        setSunTimes(times);
      }
    };

    fetchSunTimes();
  }, [slope]);

  if (!slope) {
    return (
      <div className="app-container">
        <p>해당 슬로프를 찾을 수 없습니다.</p>
        <Link href="/">목록으로 돌아가기</Link>
      </div>
    );
  }

  const minLevel = slope.minWaterLevelCm;
  const classified = classifyLevels(tideData || [], minLevel);
  const bestWindow = getBestWindow(tideData || [], minLevel);
  const summary = getSummaryStatus(bestWindow, minLevel);

  // 일출/일몰 시간 위치 계산
  const tideDataArray = tideData || [];
  const sunrisePosition = sunTimes && tideDataArray.length > 0
    ? getTimePosition(sunTimes.sunrise, tideDataArray[0].record_time, tideDataArray[tideDataArray.length - 1].record_time)
    : null;
  const sunsetPosition = sunTimes && tideDataArray.length > 0
    ? getTimePosition(sunTimes.sunset, tideDataArray[0].record_time, tideDataArray[tideDataArray.length - 1].record_time)
    : null;

  // 간조/만조 찾기 (시간순으로 정렬됨, 오늘 하루만)
  const tideExtremes = findTideExtremes(tideData || []);

  // 근처 대체 슬로프 (아주 단순히 JSON에서 몇 개 골라 사용)
  const altSlopes = slopes
    .filter((s) => s.id !== slope.id)
    .slice(0, 2)
    .map((s, idx) => {
      const status =
        idx === 0
          ? '일부 가능'
          : '불가';
      const distance =
        idx === 0
          ? '11km'
          : '18km';
      return {
        id: s.id,
        name: s.name,
        status,
        distance
      };
    });

  const statusColor =
    summary.tone === 'good'
      ? '#22c55e'
      : summary.tone === 'caution'
      ? '#f97316'
      : '#9ca3af';

  return (
    <div className="app-container">
      {/* 헤더 */}
      <div className="header">
        <button
          className="back-button"
          onClick={() => router.push('/')}
          aria-label="뒤로가기"
        >
          ◀
        </button>
        <div className="title">{slope.name}</div>
        <button className="favorite-button" aria-label="즐겨찾기">
          ☆
        </button>
      </div>

      {/* 현재 가용 여부 */}
      <div className="section">
        <div className="section-title">현재 가용 여부</div>
        <div className="status-pill" style={{ backgroundColor: '#ecfdf3' }}>
          <span
            className="status-dot"
            style={{ backgroundColor: statusColor }}
          />
          <span>{summary.label}</span>
          {bestWindow && (
            <span style={{ fontSize: 12, color: '#4b5563' }}>
              ({summary.detail})
            </span>
          )}
        </div>
        <div className="status-meta">
          Est. · Tide API · Updated {updatedAt || '--:--'}
        </div>
        {error && (
          <div
            style={{
              marginTop: 4,
              fontSize: 12,
              color: '#b91c1c'
            }}
          >
            {error}
          </div>
        )}
      </div>

      {/* 슬로프 이용가능 시간대 */}
      <div className="section">
        <div className="section-title">슬로프 이용가능 시간대</div>
        <div className="tide-bar-container">
          <div className="tide-bar-scale">
            <span>00</span>
            <span>03</span>
            <span>06</span>
            <span>09</span>
            <span>12</span>
            <span>15</span>
            <span>18</span>
            <span>21</span>
          </div>
          <div className="tide-bar" style={{ position: 'relative' }}>
            {loading
              ? Array.from({ length: 24 }).map((_, idx) => (
                  <div
                    key={idx}
                    className="tide-bar-segment bad"
                    style={{ opacity: 0.4 }}
                  />
                ))
              : classified.map((cls, idx) => (
                  <div
                    key={idx}
                    className={`tide-bar-segment ${cls}`}
                  />
                ))}
            {sunrisePosition !== null && (
              <div
                className="sun-marker sunrise-marker"
                style={{ left: `${sunrisePosition}%` }}
              >
                <div className="sun-marker-line" />
                <div className="sun-marker-label sunrise-label">
                  일출 {formatTimeLabel(sunTimes.sunrise)}
                </div>
              </div>
            )}
            {sunsetPosition !== null && (
              <div
                className="sun-marker sunset-marker"
                style={{ left: `${sunsetPosition}%` }}
              >
                <div className="sun-marker-line" />
                <div className="sun-marker-label sunset-label">
                  일몰 {formatTimeLabel(sunTimes.sunset)}
                </div>
              </div>
            )}
          </div>
          <div className="tide-legend">
            <span>
              <span className="tide-legend-dot good" /> 초록 = 가능
            </span>
            <span>
              <span className="tide-legend-dot caution" /> 노랑 = 주의
            </span>
            <span>
              <span className="tide-legend-dot bad" /> 회색 = 불가
            </span>
          </div>
          <div className="helper-text">
            ※ 예상치 기반 정보로, 실제 현장 상황과 차이가 있을 수 있어요.
          </div>
        </div>
      </div>

      {/* 슬로프 기초 정보 */}
      <div className="section">
        <div className="section-title">슬로프 기초 정보</div>
        <div className="info-list">
          <div>• 지역: {slope.region}</div>
          <div>• 최소 수위: {slope.minWaterLevelCm}cm</div>
          <div>• 이용료: {slope.fee}</div>
          <div>• 사용가능여부: {slope.availableStatus}</div>
          <div>• 운영시간: {slope.operatorHours}</div>
          <div>• 경사/노출: {slope.slopeAngle}</div>
          <div>• 주차 공간: {slope.parking}</div>
          <div>• 혼잡도 추정: {slope.congestion}</div>
          <div>• 위치: 지도 보기(향후 연동 예정)</div>
        </div>
      </div>

      {/* 해당 날짜 조수 곡선(텍스트 버전) */}
      <div className="section">
        <div className="section-title">오늘 조수 요약</div>
        {tideExtremes.length > 0 ? (
          <div style={{ fontSize: 13 }}>
            {tideExtremes.map((extreme, idx) => (
              <div key={idx} style={{ marginBottom: 4 }}>
                • {extreme.type}:{' '}
                <strong>
                  {extreme.value}cm ({formatTimeLabel(extreme.time)})
                </strong>
              </div>
            ))}
            <div
              style={{
                marginTop: 8,
                fontSize: 11,
                color: '#6b7280'
              }}
            >
              → "조수 데이터 출처: 국립해양조사원 조위관측소 실측·예측 조위
              Open API"
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 13, color: '#9ca3af' }}>
            조수 데이터를 불러오는 중이거나, 데이터가 없습니다.
          </div>
        )}
      </div>

      {/* 추천 출항 시간대 */}
      <div className="section">
        <div className="section-title">추천 출항 시간대</div>
        {bestWindow ? (
          <div className="highlight-box">
            <div>
              • 가장 안정적:{' '}
              <strong>
                {formatTimeLabel(bestWindow.startTime)}–
                {formatTimeLabel(bestWindow.endTime)}
              </strong>
            </div>
            <div>
              • 출항 추천 이유: 기준 수위 {minLevel}cm 이상 구간이 연속적으로
              유지되는 시간대입니다.
            </div>
          </div>
        ) : (
          <div className="highlight-box">
            오늘은 기준 수위 {minLevel}cm 이상 구간이 뚜렷하지 않아, 출항을
            신중히 검토하는 것이 좋습니다.
          </div>
        )}
      </div>

      {/* 근처 대체 슬로프 */}
      <div className="section">
        <div className="section-title">근처 대체 슬로프 제안</div>
        <div className="alt-slope-list">
          {altSlopes.map((s) => (
            <div key={s.id} className="alt-slope-item">
              <span>
                {s.name} (거리 {s.distance})
              </span>
              <span>{s.status}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}