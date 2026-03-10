import './CreditScoreChart.css';

interface CreditScoreChartProps {
  score: number | null;
}

const LABELS = [
  { name: 'Credit Utilization', angle: -90 },
  { name: 'Enquiries', angle: -18 },
  { name: 'Credit Mix', angle: 54 },
  { name: 'Payment History', angle: 126 },
  { name: 'Credit Age', angle: 198 },
];

function getScoreRating(score: number | null): { label: string; color: string } {
  if (!score) return { label: 'N/A', color: '#9CA3AF' };
  if (score >= 750) return { label: 'Excellent!', color: '#10B981' };
  if (score >= 700) return { label: 'Good', color: '#34D399' };
  if (score >= 650) return { label: 'Fair', color: '#F59E0B' };
  if (score >= 550) return { label: 'Poor', color: '#EF4444' };
  return { label: 'Very Poor', color: '#DC2626' };
}

export default function CreditScoreChart({ score }: CreditScoreChartProps) {
  const rating = getScoreRating(score);
  const cx = 150, cy = 150, r = 100;

  const getPoint = (angle: number, radius: number) => {
    const rad = (angle * Math.PI) / 180;
    return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
  };

  // Pentagon grid lines (3 levels)
  const gridLevels = [0.4, 0.7, 1.0];
  const gridPaths = gridLevels.map(level => {
    const points = LABELS.map(l => getPoint(l.angle, r * level));
    return points.map(p => `${p.x},${p.y}`).join(' ');
  });

  // Data polygon
  const scoreRatio = score ? Math.min(score / 900, 1) : 0;
  const dataRadii = [
    scoreRatio * 0.95,
    scoreRatio * 0.85,
    scoreRatio * 0.6,
    scoreRatio * 0.75,
    scoreRatio * 0.65,
  ];
  const dataPoints = LABELS.map((l, i) => getPoint(l.angle, r * dataRadii[i]));
  const dataPath = dataPoints.map(p => `${p.x},${p.y}`).join(' ');

  // Axis lines
  const axisLines = LABELS.map(l => getPoint(l.angle, r));

  return (
    <div className="credit-chart">
      {/* Score heading */}
      <h2 className="credit-chart__heading">
        Your Credit Score is{' '}
        <span className="credit-chart__rating" style={{ color: rating.color }}>
          {rating.label}
        </span>
        {score && score >= 700 && <span className="credit-chart__sparkle"> ✦</span>}
      </h2>

      {/* Subtitle - matching reference image */}
      <div className="credit-chart__subtitle">
        <p className="credit-chart__subtitle-light">You're seeing just the surface</p>
        <h3 className="credit-chart__subtitle-bold">Unlock Key Factors</h3>
        <p className="credit-chart__subtitle-desc">that shape your credit score</p>
      </div>

      {/* Chart with surrounding labels */}
      <div className="credit-chart__container">
        {/* Factor labels around the chart */}
        <div className="credit-chart__factor credit-chart__factor--top">
          <span className="credit-chart__factor-name">Credit Utilization</span>
          <span className="credit-chart__factor-lock">🔒</span>
        </div>
        <div className="credit-chart__factor credit-chart__factor--right-top">
          <span className="credit-chart__factor-name">Enquiries</span>
          <span className="credit-chart__factor-lock">🔒</span>
        </div>
        <div className="credit-chart__factor credit-chart__factor--right-bottom">
          <span className="credit-chart__factor-name">Credit Mix</span>
          <span className="credit-chart__factor-lock">🔒</span>
        </div>
        <div className="credit-chart__factor credit-chart__factor--left-bottom">
          <span className="credit-chart__factor-name">Payment History</span>
          <span className="credit-chart__factor-lock">🔒</span>
        </div>
        <div className="credit-chart__factor credit-chart__factor--left-top">
          <span className="credit-chart__factor-name">Credit Age</span>
          <span className="credit-chart__factor-lock">🔒</span>
        </div>

        <svg viewBox="0 0 300 300" className="credit-chart__svg">
          {/* Grid lines */}
          {gridPaths.map((points, i) => (
            <polygon key={i} points={points} fill="none" stroke="#E5E7EB" strokeWidth="1" />
          ))}

          {/* Axis lines */}
          {axisLines.map((point, i) => (
            <line key={i} x1={cx} y1={cy} x2={point.x} y2={point.y} stroke="#D1D5DB" strokeWidth="0.5" />
          ))}

          {/* Data polygon */}
          <polygon
            points={dataPath}
            fill="rgba(123, 198, 126, 0.2)"
            stroke="rgba(123, 198, 126, 0.7)"
            strokeWidth="2"
          />

          {/* Data points */}
          {dataPoints.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r="4" fill="#7BC67E" stroke="white" strokeWidth="2" />
          ))}

          {/* Center score badge */}
          <g>
            <polygon
              points={LABELS.map(l => getPoint(l.angle, 38)).map(p => `${p.x},${p.y}`).join(' ')}
              fill="var(--freed-navy)"
            />
            <text x={cx} y={cy - 2} textAnchor="middle" fill="white" fontSize="28" fontWeight="800" fontFamily="Inter, sans-serif">
              {score || '---'}
            </text>
            <text x={cx} y={cy + 18} textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize="14">
              🔒
            </text>
          </g>
        </svg>
      </div>
    </div>
  );
}
