import { useMemo, useRef, useState, useCallback } from 'react';
import './GoalTrackerWidget.css';

interface GoalTrackerWidgetProps {
  currentScore: number;
  targetScore: number;
  delta: number;
}

function getMonthLabels(count: number): string[] {
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const now = new Date();
  const start = now.getMonth();
  return Array.from({ length: count }, (_, i) => months[(start + i) % 12]);
}

function buildScoreCurve(current: number, target: number, months: number): number[] {
  const points: number[] = [current];
  const diff = target - current;
  for (let i = 1; i <= months; i++) {
    const t = i / months;
    const eased = 1 - Math.pow(1 - t, 2);
    points.push(Math.round(current + diff * eased));
  }
  return points;
}

export default function GoalTrackerWidget({
  currentScore,
  targetScore,
  delta,
}: GoalTrackerWidgetProps) {
  const monthCount = 6;
  const monthLabels = useMemo(() => getMonthLabels(monthCount + 1), []);
  const scorePoints = useMemo(() => buildScoreCurve(currentScore, targetScore, monthCount), [currentScore, targetScore]);

  // Chart dimensions
  const chartW = 380;
  const chartH = 200;
  const padL = 36;
  const padR = 16;
  const padT = 32;
  const padB = 28;
  const plotW = chartW - padL - padR;
  const plotH = chartH - padT - padB;

  // Fixed Y-axis grid: 450, 600, 750, 900
  const gridLines = [450, 600, 750, 900];
  const minScore = 450;
  const maxScore = 900;
  const scoreRange = maxScore - minScore;

  const toX = (i: number) => padL + (i / monthCount) * plotW;
  const toY = (score: number) => padT + plotH - ((score - minScore) / scoreRange) * plotH;

  const allPoints = scorePoints.map((s, i) => `${toX(i)},${toY(s)}`).join(' ');

  const midIndex = 2;
  const lastIndex = monthCount;

  // ── Slide-to-action state ──
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startXRef = useRef(0);
  const maxSlideRef = useRef(0);
  const THUMB_SIZE = 54; // px
  const TRIGGER_RATIO = 0.65; // trigger at 65% slide

  const triggerAction = useCallback(() => {
    window.dispatchEvent(new CustomEvent('freed-open-view', { detail: { view: 'paywall' } }));
    window.dispatchEvent(new CustomEvent('freed-close-chat'));
  }, []);

  const getMaxSlide = () => {
    if (!trackRef.current) return 200;
    return trackRef.current.offsetWidth - THUMB_SIZE - 12; // 12 = padding
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    startXRef.current = e.clientX - dragX;
    maxSlideRef.current = getMaxSlide();
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    const raw = e.clientX - startXRef.current;
    const clamped = Math.max(0, Math.min(raw, maxSlideRef.current));
    setDragX(clamped);
  };

  const onPointerUp = () => {
    if (!dragging) return;
    setDragging(false);
    const max = maxSlideRef.current || getMaxSlide();
    if (dragX / max >= TRIGGER_RATIO) {
      setDragX(max);
      triggerAction();
    } else {
      setDragX(0);
    }
  };

  return (
    <div className="gt-widget">
      <div className="gt-widget__header">
        <div>
          <div className="gt-widget__title">Credit Score Trend</div>
          <div className="gt-widget__subtitle">Expert insights to stay on track</div>
        </div>
        <div className="gt-widget__delta-badge">
          <svg className="gt-widget__delta-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M7 17l4.2-4.2m0 0c.4-.4.6-.9.6-1.4 0-1.1-.9-2-2-2s-2 .9-2 2 .9 2 2 2c.5 0 1-.2 1.4-.6zm0 0L17 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
          {delta} Points*
        </div>
      </div>

      <div className="gt-widget__chart">
        <svg viewBox={`0 0 ${chartW} ${chartH}`} preserveAspectRatio="xMidYMid meet">
          {gridLines.map(score => {
            const isDashed = score !== 450;
            return (
              <g key={score}>
                <line
                  className={isDashed ? 'gt-widget__chart-grid-line--dashed' : 'gt-widget__chart-grid-line--solid'}
                  x1={padL} y1={toY(score)}
                  x2={chartW - padR} y2={toY(score)}
                />
                <text className="gt-widget__chart-score-axis" x={padL - 8} y={toY(score) + 3.5}>
                  {score}
                </text>
              </g>
            );
          })}

          <polyline className="gt-widget__chart-line" points={allPoints} />

          {[0, midIndex, lastIndex].map(i => {
            const score = scorePoints[i];
            const cx = toX(i);
            const cy = toY(score);
            const isLast = i === lastIndex;
            return (
              <circle
                key={i}
                className={`gt-widget__chart-dot ${isLast ? 'gt-widget__chart-dot--target' : ''}`}
                cx={cx}
                cy={cy}
                r={isLast ? 7 : 6}
              />
            );
          })}

          {[0, midIndex, lastIndex].map(i => {
            const score = scorePoints[i];
            const cx = toX(i);
            const cy = toY(score);
            const isLast = i === lastIndex;
            const labelText = `${score}${isLast ? '*' : ''}`;
            const labelW = labelText.length * 8 + 14;
            const labelH = 22;
            const labelY = cy - labelH - 10;
            return (
              <g key={`label-${i}`}>
                <rect
                  className={isLast ? 'gt-widget__chart-label-bg gt-widget__chart-label-bg--target' : 'gt-widget__chart-label-bg'}
                  x={cx - labelW / 2}
                  y={labelY}
                  width={labelW}
                  height={labelH}
                  rx={10}
                />
                <text
                  className={isLast ? 'gt-widget__chart-label gt-widget__chart-label--target' : 'gt-widget__chart-label'}
                  x={cx}
                  y={labelY + labelH / 2}
                  textAnchor="middle"
                  dominantBaseline="central"
                >
                  {labelText}
                </text>
              </g>
            );
          })}

          {monthLabels.map((label, i) => (
            <text
              key={label + i}
              className="gt-widget__chart-month"
              x={toX(i)}
              y={chartH - 4}
            >
              {label}
            </text>
          ))}
        </svg>
      </div>

      <div className="gt-widget__disclaimer">
        *The score projections shown are estimates from your credit. <a href="#">Read More.</a>
      </div>

      {/* Slide-to-action CTA */}
      <div className="gt-widget__swipe-track" ref={trackRef}>
        <div
          className={`gt-widget__swipe-thumb ${dragging ? 'gt-widget__swipe-thumb--dragging' : ''}`}
          style={{ transform: `translateX(${dragX}px)` }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M5 6l6 6-6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.4" />
            <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
            <path d="M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <span className="gt-widget__swipe-label">Swipe to see how</span>
      </div>
    </div>
  );
}
