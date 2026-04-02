import React, { useState, useRef, useEffect } from 'react';
import type { RepaymentMethodData, RepaymentOrderAccount } from '../../types';
import './RepaymentMethodPopup.css';

interface RepaymentMethodPopupProps {
  data: RepaymentMethodData;
  triggerText: string;
  method: 'snowball' | 'avalanche';
}

function formatINR(value: number): string {
  return `₹${value.toLocaleString('en-IN')}`;
}

function AccountCard({ account, isFirst }: { account: RepaymentOrderAccount; isFirst: boolean }) {
  const hasOverdue = (account.overdueAmount ?? 0) > 0;

  return (
    <div className={`freed-rpm__account ${isFirst ? 'freed-rpm__account--first' : ''}`}>
      <div className="freed-rpm__step-badge">
        <span>{account.step}</span>
      </div>
      <div className="freed-rpm__account-info">
        <div className="freed-rpm__account-name">{account.lenderName}</div>
        <div className="freed-rpm__account-type">{account.debtType}</div>
        <div className="freed-rpm__account-details">
          <span className="freed-rpm__amount">{formatINR(account.outstandingAmount)}</span>
          {account.interestRate != null && account.interestRate > 0 && (
            <span className="freed-rpm__rate">{account.interestRate}% p.a.</span>
          )}
          {hasOverdue && (
            <span className="freed-rpm__overdue">{formatINR(account.overdueAmount!)} overdue</span>
          )}
        </div>
      </div>
      {isFirst && <div className="freed-rpm__recommended-tag">Start here</div>}
    </div>
  );
}

export default function RepaymentMethodPopup({ data, triggerText, method }: RepaymentMethodPopupProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'snowball' | 'avalanche'>(method);
  const popupRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node) &&
          triggerRef.current && !triggerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsOpen(false); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen]);

  const activeAccounts = activeTab === 'snowball' ? data.snowball : data.avalanche;
  const isRecommended = data.recommended === activeTab;

  return (
    <>
      <span
        ref={triggerRef}
        className="freed-rpm__trigger"
        onClick={() => { setActiveTab(method); setIsOpen(!isOpen); }}
        role="button"
        tabIndex={0}
      >
        {triggerText}
      </span>

      {isOpen && (
        <div className="freed-rpm__overlay" onClick={() => setIsOpen(false)}>
          <div
            ref={popupRef}
            className="freed-rpm__popup"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="freed-rpm__header">
              <h3 className="freed-rpm__title">Repayment Strategy</h3>
              <button className="freed-rpm__close" onClick={() => setIsOpen(false)}>
                &times;
              </button>
            </div>

            {/* Tabs */}
            <div className="freed-rpm__tabs">
              <button
                className={`freed-rpm__tab ${activeTab === 'snowball' ? 'freed-rpm__tab--active' : ''}`}
                onClick={() => setActiveTab('snowball')}
              >
                Snowball
                {data.recommended === 'snowball' && (
                  <span className="freed-rpm__tab-badge">Recommended</span>
                )}
              </button>
              <button
                className={`freed-rpm__tab ${activeTab === 'avalanche' ? 'freed-rpm__tab--active' : ''}`}
                onClick={() => setActiveTab('avalanche')}
              >
                Avalanche
                {data.recommended === 'avalanche' && (
                  <span className="freed-rpm__tab-badge">Recommended</span>
                )}
              </button>
            </div>

            {/* Method description */}
            <div className="freed-rpm__description">
              {activeTab === 'snowball' ? (
                <p>Pay off <strong>smallest balances first</strong> for quick wins and momentum. Each cleared account frees up money for the next.</p>
              ) : (
                <p>Pay off <strong>highest interest rates first</strong> to save the most money over time. Reduces total interest paid.</p>
              )}
              {isRecommended && (
                <div className="freed-rpm__recommended-banner">
                  Based on your profile, this method is recommended for you
                </div>
              )}
            </div>

            {/* Account list */}
            <div className="freed-rpm__accounts">
              {activeAccounts.map((account, i) => (
                <React.Fragment key={`${account.lenderName}-${i}`}>
                  <AccountCard account={account} isFirst={i === 0} />
                  {i < activeAccounts.length - 1 && (
                    <div className="freed-rpm__connector">
                      <div className="freed-rpm__connector-line" />
                      <div className="freed-rpm__connector-arrow">&#8595;</div>
                    </div>
                  )}
                </React.Fragment>
              ))}
            </div>

            {/* Summary */}
            <div className="freed-rpm__summary">
              <div className="freed-rpm__summary-item">
                <span className="freed-rpm__summary-label">Total accounts</span>
                <span className="freed-rpm__summary-value">{activeAccounts.length}</span>
              </div>
              <div className="freed-rpm__summary-item">
                <span className="freed-rpm__summary-label">Total outstanding</span>
                <span className="freed-rpm__summary-value">
                  {formatINR(activeAccounts.reduce((sum, a) => sum + a.outstandingAmount, 0))}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
