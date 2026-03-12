import { useState, useRef, useEffect, useCallback } from 'react';
import type { TooltipGroup } from '../../types';
import './AccountTooltip.css';

interface AccountTooltipProps {
  value: string;      // the bold display value, e.g. "6" or "20"
  group: TooltipGroup;
}

/** Format a number as ₹X,XX,XXX (Indian locale) */
function formatINR(value: number | null | undefined): string | null {
  if (value === null || value === undefined || value === 0) return null;
  return '₹' + value.toLocaleString('en-IN');
}

export default function AccountTooltip({ value, group }: AccountTooltipProps) {
  const [visible, setVisible] = useState(false);
  const [direction, setDirection] = useState<'above' | 'below'>('above');
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    // Determine whether to open above or below based on available viewport space
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setDirection(rect.top > 140 ? 'above' : 'below');
    }
    setVisible(true);
  }, []);

  const hide = useCallback(() => {
    // Small delay so the user can move into the tooltip without it closing
    hideTimer.current = setTimeout(() => setVisible(false), 120);
  }, []);

  const cancelHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }, []);

  // Touch support — toggle on tap, close on outside tap
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    setVisible(v => {
      if (!v && triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        setDirection(rect.top > 140 ? 'above' : 'below');
      }
      return !v;
    });
  }, []);

  useEffect(() => {
    if (!visible) return;
    const onTouchOutside = (e: TouchEvent) => {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target as Node) &&
        tooltipRef.current && !tooltipRef.current.contains(e.target as Node)
      ) {
        setVisible(false);
      }
    };
    document.addEventListener('touchstart', onTouchOutside);
    return () => document.removeEventListener('touchstart', onTouchOutside);
  }, [visible]);

  // Cleanup timer on unmount
  useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current); }, []);

  const MAX_VISIBLE = 6;
  const hasDetails = group.details && group.details.length > 0;
  const items = hasDetails ? group.details!.slice(0, MAX_VISIBLE) : group.accounts.slice(0, MAX_VISIBLE);
  const totalCount = hasDetails ? group.details!.length : group.accounts.length;
  const remaining = totalCount - MAX_VISIBLE;

  return (
    <span className="freed-acct-tooltip-wrapper">
      <strong
        ref={triggerRef}
        className="freed-message__bold freed-acct-trigger"
        onMouseEnter={show}
        onMouseLeave={hide}
        onTouchStart={handleTouchStart}
        aria-describedby={visible ? 'acct-tooltip' : undefined}
      >
        {value}
      </strong>

      {visible && (
        <div
          id="acct-tooltip"
          ref={tooltipRef}
          role="tooltip"
          className={`freed-acct-tooltip freed-acct-tooltip--${direction}`}
          onMouseEnter={cancelHide}
          onMouseLeave={hide}
        >
          <div className="freed-acct-tooltip__label">{group.label}</div>
          <ul className="freed-acct-tooltip__list" aria-label={group.label}>
            {items.map((item, i) => {
              const isDetail = typeof item === 'object' && 'name' in item;
              const name = isDetail ? item.name : item;
              const detail = isDetail ? item : null;
              const amountStr = detail ? formatINR(detail.outstanding) : null;
              const overdueStr = detail?.overdue ? formatINR(detail.overdue) : null;

              return (
                <li key={i} className="freed-acct-tooltip__item">
                  <span className="freed-acct-tooltip__dot" aria-hidden="true" />
                  <span className="freed-acct-tooltip__content">
                    <span className="freed-acct-tooltip__name">{name}</span>
                    {detail?.debtType && (
                      <span className="freed-acct-tooltip__type">{detail.debtType}</span>
                    )}
                    {(amountStr || overdueStr) && (
                      <span className="freed-acct-tooltip__amounts">
                        {amountStr && <span className="freed-acct-tooltip__amount">{amountStr}</span>}
                        {overdueStr && <span className="freed-acct-tooltip__overdue">{overdueStr} overdue</span>}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
            {remaining > 0 && (
              <li className="freed-acct-tooltip__more">+{remaining} more</li>
            )}
          </ul>
        </div>
      )}
    </span>
  );
}
