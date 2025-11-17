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
    // 해당 슬로프 지역의 위도/경도를 사용하여 일출/일몰 시간 조회
    const url = `https://api.sunrise-sunset.org/json?lat=${lat}&lng=${lng}&date=${dateStr}&formatted=0`;
    const res = await fetch(url);
    const data = await res.json();
    
    if (data.status === 'OK' && data.results) {
      // API는 UTC 시간을 ISO 8601 형식으로 반환
      const sunriseUTC = new Date(data.results.sunrise);
      const sunsetUTC = new Date(data.results.sunset);
      
      // 한국 시간대(KST, UTC+9)로 변환
      // UTC 시간에 9시간을 더하여 KST로 변환
      const kstOffset = 9 * 60 * 60 * 1000; // 9시간을 밀리초로
      const sunriseKST = new Date(sunriseUTC.getTime() + kstOffset);
      const sunsetKST = new Date(sunsetUTC.getTime() + kstOffset);
      
      // YYYY-MM-DD HH:mm 형식으로 변환 (해당 슬로프 지역 기준 KST)
      const formatKST = (kstDate) => {
        // 이미 KST로 변환된 Date 객체에서 UTC 메서드를 사용하면 KST 시간이 추출됨
        const y = kstDate.getUTCFullYear();
        const m = (kstDate.getUTCMonth() + 1).toString().padStart(2, '0');
        const d = kstDate.getUTCDate().toString().padStart(2, '0');
        const h = kstDate.getUTCHours().toString().padStart(2, '0');
        const min = kstDate.getUTCMinutes().toString().padStart(2, '0');
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
  let extremes = [];

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

  // 00:00에 해당하는 정보와 마지막 시간의 정보 제외
  if (data.length > 0) {
    const firstTime = data[0].record_time;
    const lastTime = data[data.length - 1].record_time;
    
    // 0시인지 확인 (시간 부분이 00:00인지 체크)
    const firstDate = new Date(firstTime.replace(' ', 'T'));
    const isFirstMidnight = firstDate.getHours() === 0 && firstDate.getMinutes() === 0;
    
    extremes = extremes.filter((extreme) => {
      // 0시에 해당하는 정보 제외
      if (isFirstMidnight && extreme.time === firstTime) {
        return false;
      }
      // 마지막 정보 제외
      if (extreme.time === lastTime) {
        return false;
      }
      return true;
    });
  }

  return extremes;
}

function TideChart({ tideData, tideExtremes, sunTimes, classified, minLevel, currentTime }) {
  if (!tideData || tideData.length === 0) return null;

  const graphWidth = 700;
  const graphHeight = 250;
  const padding = { top: 30, right: 20, bottom: 50, left: 40 };
  const chartWidth = graphWidth - padding.left - padding.right;
  const chartHeight = graphHeight - padding.top - padding.bottom;

  const values = tideData.map((d) => Number(d.pre_value || d.real_value || 0));
  const times = tideData.map((d) => d.record_time);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const valueRange = maxValue - minValue || 1;
  const valuePadding = valueRange * 0.1;

  const startTime = new Date(times[0].replace(' ', 'T'));
  const endTime = new Date(times[times.length - 1].replace(' ', 'T'));
  const timeRange = endTime - startTime;

  // 좌표 변환 함수
  const getX = (timeStr) => {
    const time = new Date(timeStr.replace(' ', 'T'));
    const timeMs = time - startTime;
    return (timeMs / timeRange) * chartWidth;
  };

  const getY = (value) => {
    return chartHeight - ((value - minValue + valuePadding) / (valueRange + valuePadding * 2)) * chartHeight;
  };

  // 곡선 경로 생성 (부드러운 곡선 - Catmull-Rom 스플라인 기반)
  const createSmoothPath = () => {
    if (times.length < 2) return '';
    
    const points = times.map((time, idx) => ({
      x: getX(time),
      y: getY(values[idx])
    }));

    let path = `M ${points[0].x} ${points[0].y}`;
    
    if (points.length === 2) {
      return `${path} L ${points[1].x} ${points[1].y}`;
    }
    
    // Catmull-Rom 스플라인을 베지어 곡선으로 변환
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = i > 0 ? points[i - 1] : points[i];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = i < points.length - 2 ? points[i + 2] : points[i + 1];
      
      // Catmull-Rom 스플라인의 제어점 계산 (tension = 0.5)
      const tension = 0.5;
      
      const cp1x = p1.x + (p2.x - p0.x) / 6 * tension;
      const cp1y = p1.y + (p2.y - p0.y) / 6 * tension;
      const cp2x = p2.x - (p3.x - p1.x) / 6 * tension;
      const cp2y = p2.y - (p3.y - p1.y) / 6 * tension;
      
      path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
    }
    
    return path;
  };
  
  const pathData = createSmoothPath();

  // 이용가능 시간대 영역 계산 (초록/노랑/회색)
  const availabilityAreas = [];
  let currentAreaStart = null;
  let currentAreaType = null;
  
  times.forEach((time, idx) => {
    const type = classified[idx];
    if (currentAreaType !== type) {
      if (currentAreaStart !== null) {
        availabilityAreas.push({
          startX: getX(times[currentAreaStart]),
          endX: getX(time),
          type: currentAreaType
        });
      }
      currentAreaStart = idx;
      currentAreaType = type;
    }
  });
  
  if (currentAreaStart !== null) {
    availabilityAreas.push({
      startX: getX(times[currentAreaStart]),
      endX: chartWidth,
      type: currentAreaType
    });
  }

  // 일출/일몰 위치
  const sunriseX = sunTimes && times.length > 0
    ? getTimePosition(sunTimes.sunrise, times[0], times[times.length - 1])
    : null;
  const sunsetX = sunTimes && times.length > 0
    ? getTimePosition(sunTimes.sunset, times[0], times[times.length - 1])
    : null;

  // 현재 시각 위치 (대한민국 표준시 KST)
  const now = currentTime;
  const todayStr = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`;
  const currentTimeStr = `${todayStr} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
  const currentX = getTimePosition(currentTimeStr, times[0], times[times.length - 1]);

  // Y축 눈금
  const yTicks = 4;
  const yTickValues = [];
  for (let i = 0; i <= yTicks; i++) {
    const value = minValue - valuePadding + (valueRange + valuePadding * 2) * (1 - i / yTicks);
    yTickValues.push(Math.round(value));
  }

  const getAreaColor = (type) => {
    if (type === 'good') return '#22c55e'; // 진한 초록색
    if (type === 'caution') return '#facc15'; // 진한 노란색
    return '#e5e7eb'; // 밝은 회색
  };

  return (
    <div className="tide-chart-container">
      <svg
        width={graphWidth}
        height={graphHeight}
        viewBox={`0 0 ${graphWidth} ${graphHeight}`}
        className="tide-chart"
      >
        <defs>
          <linearGradient id="tideGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.05" />
          </linearGradient>
          {/* 이용불가 영역 빗금 패턴 */}
          <pattern
            id="unavailablePattern"
            x="0"
            y="0"
            width="10"
            height="10"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 0 10 L 10 0"
              stroke="#9ca3af"
              strokeWidth="1"
              opacity="0.6"
            />
          </pattern>
        </defs>

        <g transform={`translate(${padding.left}, ${padding.top})`}>
          {/* 이용가능 시간대 하이라이트 */}
          {availabilityAreas.map((area, idx) => (
            <g key={idx}>
              {/* 배경색 */}
              <rect
                x={area.startX}
                y={0}
                width={area.endX - area.startX}
                height={chartHeight}
                fill={getAreaColor(area.type)}
                opacity={area.type === 'bad' ? 0.4 : 0.6}
              />
              {/* 이용불가 영역에만 빗금 패턴 오버레이 */}
              {area.type === 'bad' && (
                <rect
                  x={area.startX}
                  y={0}
                  width={area.endX - area.startX}
                  height={chartHeight}
                  fill="url(#unavailablePattern)"
                  opacity="0.8"
                />
              )}
            </g>
          ))}

          {/* 그리드선 */}
          {yTickValues.map((value, idx) => {
            const y = getY(value);
            return (
              <g key={idx}>
                <line
                  x1={0}
                  y1={y}
                  x2={chartWidth}
                  y2={y}
                  stroke="#e5e7eb"
                  strokeWidth="1"
                  strokeDasharray="2,2"
                />
                <text
                  x={-8}
                  y={y + 4}
                  textAnchor="end"
                  fontSize="10"
                  fill="#6b7280"
                >
                  {value}
                </text>
              </g>
            );
          })}

          {/* 곡선 영역 (그라데이션) */}
          <path
            d={`${pathData} L ${chartWidth} ${chartHeight} L 0 ${chartHeight} Z`}
            fill="url(#tideGradient)"
          />

          {/* 조위 곡선 */}
          <path
            d={pathData}
            fill="none"
            stroke="#3b82f6"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* 최소 수위 기준선 */}
          <line
            x1={0}
            y1={getY(minLevel)}
            x2={chartWidth}
            y2={getY(minLevel)}
            stroke="#f59e0b"
            strokeWidth="1.5"
            strokeDasharray="4,4"
            opacity="0.6"
          />
          {/* 최소 수위 라벨 */}
          <g>
            <rect
              x={chartWidth - 120}
              y={getY(minLevel) - 10}
              width="115"
              height="16"
              rx="4"
              fill="#ffffff"
              stroke="#f59e0b"
              strokeWidth="1.5"
              opacity="0.95"
            />
            <text
              x={chartWidth - 62}
              y={getY(minLevel) - 1}
              textAnchor="middle"
              fontSize="10"
              fill="#f59e0b"
              fontWeight="600"
            >
              최소수위({minLevel}cm)
            </text>
          </g>

          {/* 고조/저조 마커 */}
          {tideExtremes.map((extreme, idx) => {
            const x = getX(extreme.time);
            const y = getY(extreme.value);
            const isHigh = extreme.type === '만조';
            return (
              <g key={idx}>
                <circle
                  cx={x}
                  cy={y}
                  r="7"
                  fill={isHigh ? '#dc2626' : '#2563eb'}
                  stroke="#ffffff"
                  strokeWidth="2"
                />
                <text
                  x={x}
                  y={y + 4}
                  textAnchor="middle"
                  fontSize="10"
                  fontWeight="600"
                  fill="#ffffff"
                >
                  {isHigh ? '고' : '저'}
                </text>
                <text
                  x={x}
                  y={y - 12}
                  textAnchor="middle"
                  fontSize="9"
                  fill={isHigh ? '#dc2626' : '#2563eb'}
                  fontWeight="600"
                >
                  {formatTimeLabel(extreme.time)}
                </text>
                <text
                  x={x}
                  y={y + 20}
                  textAnchor="middle"
                  fontSize="9"
                  fill="#6b7280"
                >
                  {extreme.value}cm
                </text>
              </g>
            );
          })}

          {/* 일출/일몰 표시 */}
          {sunriseX !== null && (
            <g>
              <line
                x1={(sunriseX / 100) * chartWidth}
                y1={0}
                x2={(sunriseX / 100) * chartWidth}
                y2={chartHeight}
                stroke="#f59e0b"
                strokeWidth="1.5"
                strokeDasharray="3,3"
                opacity="0.6"
              />
              <text
                x={(sunriseX / 100) * chartWidth}
                y={-8}
                textAnchor="middle"
                fontSize="10"
                fill="#f59e0b"
                fontWeight="500"
              >
                일출 {formatTimeLabel(sunTimes.sunrise)}
              </text>
            </g>
          )}
          {sunsetX !== null && (
            <g>
              <line
                x1={(sunsetX / 100) * chartWidth}
                y1={0}
                x2={(sunsetX / 100) * chartWidth}
                y2={chartHeight}
                stroke="#ea580c"
                strokeWidth="1.5"
                strokeDasharray="3,3"
                opacity="0.6"
              />
              <text
                x={(sunsetX / 100) * chartWidth}
                y={-8}
                textAnchor="middle"
                fontSize="10"
                fill="#ea580c"
                fontWeight="500"
              >
                일몰 {formatTimeLabel(sunTimes.sunset)}
              </text>
            </g>
          )}

          {/* 현재 시각 표시 (대한민국 표준시 KST) */}
          {currentX !== null && (
            <g>
              <line
                x1={(currentX / 100) * chartWidth}
                y1={0}
                x2={(currentX / 100) * chartWidth}
                y2={chartHeight}
                stroke="#ffffff"
                strokeWidth="2.5"
              />
              <polygon
                points={`${(currentX / 100) * chartWidth},0 ${(currentX / 100) * chartWidth - 6},-8 ${(currentX / 100) * chartWidth + 6},-8`}
                fill="#ffffff"
              />
              <text
                x={(currentX / 100) * chartWidth}
                y={-12}
                textAnchor="middle"
                fontSize="9"
                fill="#111827"
                fontWeight="600"
              >
                현재 시각
              </text>
            </g>
          )}

          {/* X축 시간 표시 (1시간 단위) */}
          {(() => {
            const startHour = startTime.getHours();
            const endHour = endTime.getHours();
            const hours = [];
            // 1시간 단위로 모든 시간 표시
            for (let h = startHour; h <= endHour + 1; h += 1) {
              if (h >= 0 && h <= 24) {
                const hourTime = new Date(startTime);
                hourTime.setHours(h, 0, 0, 0);
                if (hourTime >= startTime && hourTime <= endTime) {
                  hours.push(h);
                }
              }
            }
            return hours.map((hour) => {
              const hourTime = new Date(startTime);
              hourTime.setHours(hour, 0, 0, 0);
              const timeStr = `${hourTime.getFullYear()}-${(hourTime.getMonth() + 1).toString().padStart(2, '0')}-${hourTime.getDate().toString().padStart(2, '0')} ${hourTime.getHours().toString().padStart(2, '0')}:${hourTime.getMinutes().toString().padStart(2, '0')}`;
              const x = getX(timeStr);
              return (
                <g key={hour}>
                  <line
                    x1={x}
                    y1={chartHeight}
                    x2={x}
                    y2={chartHeight + 5}
                    stroke="#6b7280"
                    strokeWidth="1"
                  />
                  <text
                    x={x}
                    y={chartHeight + 18}
                    textAnchor="middle"
                    fontSize="10"
                    fill="#6b7280"
                  >
                    {hour.toString().padStart(2, '0')}
                  </text>
                </g>
              );
            });
          })()}

          {/* Y축 라벨 */}
          <text
            x={-25}
            y={chartHeight / 2}
            textAnchor="middle"
            fontSize="10"
            fill="#6b7280"
            transform={`rotate(-90, -25, ${chartHeight / 2})`}
          >
            조위 (cm)
          </text>
        </g>
      </svg>
    </div>
  );
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
  const [currentTime, setCurrentTime] = useState(new Date());

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

    // 현재 시각 업데이트 (실시간, 1초마다 - 대한민국 표준시 KST)
    const timeInterval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(timeInterval);
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
          {loading ? (
            <div style={{ fontSize: 13, color: '#9ca3af', textAlign: 'center', padding: '40px 0' }}>
              조수 데이터를 불러오는 중...
            </div>
          ) : tideData && tideData.length > 0 ? (
            <>
              <TideChart
                tideData={tideData}
                tideExtremes={tideExtremes}
                sunTimes={sunTimes}
                classified={classified}
                minLevel={minLevel}
                currentTime={currentTime}
              />
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
            </>
          ) : (
            <div style={{ fontSize: 13, color: '#9ca3af', textAlign: 'center', padding: '40px 0' }}>
              조수 데이터가 없습니다.
            </div>
          )}
        </div>
      </div>

      {/* 슬로프 정보 */}
      <div className="section">
        <div className="section-title">슬로프 정보</div>
        <div className="info-list">
          <div>• 지역: {slope.region}</div>
          <div>• 최소 수위: {slope.minWaterLevelCm}cm</div>
          <div>• 이용료: {slope.fee}</div>
          <div>• 사용가능여부: {slope.availableStatus}</div>
          <div>• 경사/노출: {slope.slopeAngle}</div>
          <div>• 위치: 지도 보기(향후 연동 예정)</div>
        </div>
      </div>

      {/* 해당 날짜 조수 곡선(텍스트 버전) */}
      <div className="section">
        <div className="section-title">오늘 조수 요약</div>
        {tideExtremes.length > 0 ? (
          <div className="tide-summary">
            {tideExtremes.map((extreme, idx) => (
              <div key={idx} className="tide-summary-item">
                <div
                  className={`tide-summary-circle ${
                    extreme.type === '만조' ? 'high-tide' : 'low-tide'
                  }`}
                >
                  {extreme.type === '만조' ? '고' : '저'}
                </div>
                <div className="tide-summary-content">
                  <div className="tide-summary-time">
                    {formatTimeLabel(extreme.time)}
                  </div>
                  <div className="tide-summary-value">{extreme.value}cm</div>
                </div>
              </div>
            ))}
            <div className="tide-summary-source">
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