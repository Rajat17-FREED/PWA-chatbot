import './CreditScoreGauge.css';

interface CreditScoreGaugeProps {
  score: number | null;
}

function getScoreData(score: number | null) {
  if (!score) return { label: 'N/A', color: '#9CA3AF', zone: 'Unknown', zoneColor: '#9CA3AF' };
  if (score >= 750) return { label: 'Excellent', color: '#10B981', zone: 'Excellent Zone', zoneColor: '#10B981' };
  if (score >= 700) return { label: 'Good', color: '#34D399', zone: 'Good Zone', zoneColor: '#34D399' };
  if (score >= 650) return { label: 'Fair', color: '#F59E0B', zone: 'Fair Zone', zoneColor: '#F59E0B' };
  if (score >= 550) return { label: 'Rebuilding', color: '#E8732A', zone: 'Rebuilding Zone', zoneColor: '#E8732A' };
  return { label: 'Critical', color: '#EF4444', zone: 'Critical Zone', zoneColor: '#EF4444' };
}

export default function CreditScoreGauge({ score }: CreditScoreGaugeProps) {
  const data = getScoreData(score);

  // Gauge arc math
  const cx = 120, cy = 120, r = 90;
  const startAngle = 135;
  const endAngle = 405;
  const totalAngle = endAngle - startAngle;

  // Score position on the arc (300-900 range)
  const normalizedScore = score ? Math.max(0, Math.min(1, (score - 300) / 600)) : 0;
  const scoreAngle = startAngle + normalizedScore * totalAngle;

  const polarToCartesian = (angle: number, radius: number) => {
    const rad = (angle * Math.PI) / 180;
    return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
  };

  const describeArc = (start: number, end: number, radius: number) => {
    const s = polarToCartesian(start, radius);
    const e = polarToCartesian(end, radius);
    const largeArcFlag = end - start > 180 ? 1 : 0;
    return `M ${s.x} ${s.y} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${e.x} ${e.y}`;
  };

  // Color stops for the gradient arc
  const segments = [
    { start: 135, end: 189, color: '#EF4444' },
    { start: 189, end: 243, color: '#F97316' },
    { start: 243, end: 297, color: '#F59E0B' },
    { start: 297, end: 351, color: '#84CC16' },
    { start: 351, end: 405, color: '#10B981' },
  ];

  const needlePos = polarToCartesian(scoreAngle, r - 10);

  return (
    <div className="credit-gauge">
      <div className="credit-gauge__header">
        <span>Here's Your Credit Score</span>
        <span className="credit-gauge__sparkle">✦</span>
      </div>

      <div className="credit-gauge__svg-wrap">
        <svg viewBox="0 0 240 160" className="credit-gauge__svg">
          {/* Background arc */}
          <path d={describeArc(startAngle, endAngle, r)} fill="none" stroke="#E5E7EB" strokeWidth="14" strokeLinecap="round" />

          {/* Colored segments */}
          {segments.map((seg, i) => (
            <path key={i} d={describeArc(seg.start, seg.end, r)} fill="none" stroke={seg.color} strokeWidth="14" strokeLinecap="butt" />
          ))}

          {/* Needle dot */}
          <circle cx={needlePos.x} cy={needlePos.y} r="8" fill={data.color} stroke="white" strokeWidth="3" />

          {/* Center score */}
          <text x={cx} y={cy - 5} textAnchor="middle" fill={data.color} fontSize="42" fontWeight="800" fontFamily="Inter, sans-serif">
            {score || '---'}
          </text>
          <text x={cx} y={cy + 18} textAnchor="middle" fill={data.color} fontSize="11" fontWeight="600" opacity="0.8">
            ▲
          </text>
        </svg>
      </div>

      <div className="credit-gauge__zone" style={{ borderColor: data.zoneColor }}>
        <div className="credit-gauge__zone-label" style={{ color: data.zoneColor }}>
          {data.zone}
        </div>
        <div className="credit-gauge__zone-powered">
          Powered by <strong>Experian</strong>
        </div>
        <p className="credit-gauge__zone-desc">
          {score && score < 650
            ? 'Your credit deliveries may be limited to secured cards or small-ticket loans with higher interest and stricter approval criteria.'
            : score && score >= 750
            ? 'This score unlocks access to the best interest rates and premium credit offers.'
            : 'Work on improving your score to unlock better financial products.'}
        </p>
      </div>
    </div>
  );
}
