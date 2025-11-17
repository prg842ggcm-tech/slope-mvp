// pages/index.js
import Link from 'next/link';
import slopes from '../data/slopes.json';

export default function Home() {
  return (
    <div className="app-container">
      <h1 style={{ fontSize: '20px', fontWeight: 700, marginBottom: 12 }}>
        보트 슬로프 목록 (MVP)
      </h1>
      <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
        각 슬로프를 클릭하면 오늘 기준 가용 시간대를 확인할 수 있습니다.
      </p>

      <div>
        {slopes.map((slope) => (
          <Link key={slope.id} href={`/slope/${slope.id}`}>
            <div
              style={{
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid #e5e7eb',
                marginBottom: 8,
                cursor: 'pointer'
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
              <div style={{ fontSize: 12, color: '#6b7280' }}>
                최소 수위 기준: {slope.minWaterLevelCm}cm · 사용가능 여부:{' '}
                {slope.availableStatus}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}