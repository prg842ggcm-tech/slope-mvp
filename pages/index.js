// pages/index.js
import { useEffect, useState } from 'react';
import Link from 'next/link';
import slopes from '../data/slopes.json';

function formatDateToString(date) {
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const d = date.getDate().toString().padStart(2, '0');
  return `${y}${m}${d}`;
}

function formatTimeLabel(dateStr) {
  const d = new Date(dateStr.replace(' ', 'T'));
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

async function getSunTimes(lat, lng, date = null) {
  try {
    const targetDate = date || new Date();
    const dateStr = `${targetDate.getFullYear()}-${(targetDate.getMonth() + 1).toString().padStart(2, '0')}-${targetDate.getDate().toString().padStart(2, '0')}`;
    const url = `https://api.sunrise-sunset.org/json?lat=${lat}&lng=${lng}&date=${dateStr}&formatted=0`;
    const res = await fetch(url);
    const data = await res.json();
    
    if (data.status === 'OK' && data.results) {
      const sunriseUTC = new Date(data.results.sunrise);
      const sunsetUTC = new Date(data.results.sunset);
      
      const kstOffset = 9 * 60 * 60 * 1000;
      const sunriseKST = new Date(sunriseUTC.getTime() + kstOffset);
      const sunsetKST = new Date(sunsetUTC.getTime() + kstOffset);
      
      const formatKST = (kstDate) => {
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

function classifyLevels(data, minLevel) {
  if (!data || data.length === 0) return [];
  
  return data.map((item) => {
    const value = Number(item.tide_level || item.pre_value || 0);
    if (value >= minLevel + 20) return 'good';
    if (value >= minLevel) return 'caution';
    return 'bad';
  });
}

function isNightTime(timeStr, sunrise, sunset) {
  if (!sunrise || !sunset) return false;
  
  const time = new Date(timeStr.replace(' ', 'T'));
  const sunriseTime = new Date(sunrise.replace(' ', 'T'));
  const sunsetTime = new Date(sunset.replace(' ', 'T'));
  
  // 일몰 이후 또는 일출 이전이면 야간
  return time >= sunsetTime || time < sunriseTime;
}

function getAvailableWindows(data, classified, sunTimes) {
  if (!data || data.length === 0 || !classified) return [];
  
  const windows = [];
  let currentWindowStart = null;
  let currentWindowStartIdx = -1;
  
  data.forEach((item, idx) => {
    const type = classified[idx];
    
    // good 구간만 표시 (caution 제외)
    if (type === 'good') {
      if (currentWindowStart === null) {
        currentWindowStart = item.record_time;
        currentWindowStartIdx = idx;
      }
    } else {
      if (currentWindowStart !== null) {
        // 이전 구간 종료 (이전 항목이 마지막 good 구간)
        const endTime = idx > 0 ? data[idx - 1].record_time : currentWindowStart;
        windows.push({
          startTime: currentWindowStart,
          endTime: endTime,
          isNight: isNightTime(currentWindowStart, sunTimes?.sunrise, sunTimes?.sunset)
        });
        currentWindowStart = null;
        currentWindowStartIdx = -1;
      }
    }
  });
  
  // 마지막 구간 처리
  if (currentWindowStart !== null) {
    windows.push({
      startTime: currentWindowStart,
      endTime: data[data.length - 1].record_time,
      isNight: isNightTime(currentWindowStart, sunTimes?.sunrise, sunTimes?.sunset)
    });
  }
  
  return windows;
}

export default function Home() {
  const [slopeWindows, setSlopeWindows] = useState({});
  const [slopeWaterTemps, setSlopeWaterTemps] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAllSlopeWindows = async () => {
      const today = new Date();
      const dateString = formatDateToString(today);
      
      const windowPromises = slopes.map(async (slope) => {
        try {
          // 조위 데이터, 일출/일몰 시간, 수온 데이터를 병렬로 가져오기
          const [tideRes, sunTimes, waterTempRes] = await Promise.all([
            fetch(`/api/tide?obsCode=${slope.obsCode}&date=${dateString}`),
            getSunTimes(slope.lat, slope.lng, today),
            fetch(`/api/waterTemp?obsCode=${slope.obsCode}&date=${dateString}`)
          ]);
          
          if (!tideRes.ok) return { slopeId: slope.id, windows: [] };
          
          const json = await tideRes.json();
          if (json.error || json.result?.error) {
            return { slopeId: slope.id, windows: [] };
          }
          
          const allData = json.result?.data || json.data || (Array.isArray(json.result) ? json.result : []);
          if (!Array.isArray(allData) || allData.length === 0) {
            return { slopeId: slope.id, windows: [] };
          }
          
          // 예측 조위 데이터 필터링
          const tideData = allData.filter((item) => {
            const value = item.tide_level || item.pre_value;
            return value !== null && 
                   value !== undefined && 
                   value !== '' &&
                   !isNaN(Number(value));
          });
          
          if (tideData.length === 0) {
            return { slopeId: slope.id, windows: [] };
          }
          
          // 시간순으로 정렬
          const sortedData = [...tideData].sort((a, b) => {
            if (!a.record_time || !b.record_time) return 0;
            return a.record_time.localeCompare(b.record_time);
          });
          
          // 1시간 단위로 집계
          const hourMap = new Map();
          sortedData.forEach((item) => {
            if (!item.record_time) return;
            
            const timeStr = item.record_time.replace(' ', 'T');
            const dateObj = new Date(timeStr);
            const hour = dateObj.getHours();
            const minute = dateObj.getMinutes();
            
            if (minute === 0 || !hourMap.has(hour)) {
              const value = Number(item.tide_level || item.pre_value || 0);
              hourMap.set(hour, {
                record_time: `${item.record_time.split(' ')[0]} ${hour.toString().padStart(2, '0')}:00`,
                pre_value: value,
                tide_level: value
              });
            }
          });
          
          const finalData = Array.from(hourMap.values()).sort((a, b) => {
            return a.record_time.localeCompare(b.record_time);
          });
          
          // 이용가능 시간대 계산 (good만)
          const classified = classifyLevels(finalData, slope.minWaterLevelCm);
          const windows = getAvailableWindows(finalData, classified, sunTimes);
          
          // 수온 데이터 처리
          let waterTemp = null;
          if (waterTempRes.ok) {
            const waterTempJson = await waterTempRes.json();
            if (!waterTempJson.error && !waterTempJson.result?.error) {
              const allWaterTempData = waterTempJson.result?.data || waterTempJson.data || [];
              if (Array.isArray(allWaterTempData) && allWaterTempData.length > 0) {
                const sortedWaterTempData = [...allWaterTempData].sort((a, b) => {
                  if (!a.record_time || !b.record_time) return 0;
                  return a.record_time.localeCompare(b.record_time);
                });
                const latestWaterTemp = sortedWaterTempData[sortedWaterTempData.length - 1];
                if (latestWaterTemp && latestWaterTemp.water_temp) {
                  waterTemp = Number(latestWaterTemp.water_temp);
                }
              }
            }
          }
          
          return { slopeId: slope.id, windows, waterTemp };
        } catch (e) {
          console.error(`슬로프 ${slope.id} 조위 데이터 가져오기 오류:`, e);
          return { slopeId: slope.id, windows: [], waterTemp: null };
        }
      });
      
      const results = await Promise.all(windowPromises);
      const windowsMap = {};
      const waterTempsMap = {};
      results.forEach(({ slopeId, windows, waterTemp }) => {
        windowsMap[slopeId] = windows;
        if (waterTemp !== null) {
          waterTempsMap[slopeId] = waterTemp;
        }
      });
      
      setSlopeWindows(windowsMap);
      setSlopeWaterTemps(waterTempsMap);
      setLoading(false);
    };
    
    fetchAllSlopeWindows();
  }, []);

  return (
    <div className="app-container">
      <h1 style={{ fontSize: '20px', fontWeight: 700, marginBottom: 12 }}>
        보트 슬로프 목록 (MVP)
      </h1>
      <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
        각 슬로프를 클릭하면 오늘 기준 가용 시간대를 확인할 수 있습니다.
      </p>

      <div>
        {slopes.map((slope) => {
          const windows = slopeWindows[slope.id] || [];
          const waterTemp = slopeWaterTemps[slope.id];
          
          return (
            <Link key={slope.id} href={`/slope/${slope.id}`}>
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px solid #e5e7eb',
                  marginBottom: 8,
                  cursor: 'pointer',
                  transition: 'background-color 0.2s'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#f9fafb';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    marginBottom: 4
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{slope.name}</span>
                  <span
                    style={{
                      fontSize: 11,
                      color: '#6b7280',
                      marginLeft: 6
                    }}
                  >
                    ({slope.region})
                  </span>
                </div>
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
                  최소 수위 기준: {slope.minWaterLevelCm}cm · 사용가능 여부:{' '}
                  {slope.availableStatus}
                  {waterTemp !== undefined && (
                    <span> · 수온: {waterTemp.toFixed(1)}℃</span>
                  )}
                </div>
                {loading ? (
                  <div style={{ fontSize: 11, color: '#9ca3af', fontStyle: 'italic' }}>
                    이용가능 시간대 확인 중...
                  </div>
                ) : windows.length > 0 ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: 4 }}>
                    {windows.map((window, idx) => (
                      <div
                        key={idx}
                        style={{
                          display: 'inline-block',
                          padding: '4px 8px',
                          borderRadius: '4px',
                          fontSize: '11px',
                          fontWeight: 500,
                          backgroundColor: window.isNight ? '#15803d' : '#22c55e',
                          color: '#ffffff'
                        }}
                      >
                        {formatTimeLabel(window.startTime)} ~ {formatTimeLabel(window.endTime)}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: '#9ca3af', fontStyle: 'italic', marginTop: 4 }}>
                    이용가능 시간대 없음
                  </div>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}