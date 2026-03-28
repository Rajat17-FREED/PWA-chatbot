import { useEffect, useState } from 'react';
import { useDashboard } from '../../context/DashboardContext';
import './PaywallPage.css';

type PlanId = 'monthly' | 'six-months' | 'twelve-months';

interface PlanOption {
  id: PlanId;
  title: string;
  price: string;
  duration: string;
  saveText?: string;
  badge?: string;
  ctaText: string;
}

const PLANS: PlanOption[] = [
  {
    id: 'monthly',
    title: 'Monthly',
    price: '₹99',
    duration: '/Month',
    ctaText: 'Pay ₹99 + 18%GST/Month',
  },
  {
    id: 'six-months',
    title: '6 Months',
    price: '₹449',
    duration: '/6 Months',
    saveText: 'Save ₹145',
    badge: 'Preferred',
    ctaText: 'Pay ₹381 + 18%GST/Month',
  },
  {
    id: 'twelve-months',
    title: '12 Months',
    price: '₹649',
    duration: '/12 Months',
    saveText: 'Save ₹539',
    ctaText: 'Pay ₹649 + 18%GST/12 Months',
  },
];

const FEATURE_CARDS = [
  '/assets/ci/paywall/feature-1.png',
  '/assets/ci/paywall/feature-2.png',
  '/assets/ci/paywall/feature-3.png',
  '/assets/ci/paywall/feature-4.png',
  '/assets/ci/paywall/feature-5.png',
  '/assets/ci/paywall/feature-6.png',
  '/assets/ci/paywall/feature-7.png',
];

export default function PaywallPage() {
  const { setCurrentView } = useDashboard();
  const [selectedPlan, setSelectedPlan] = useState<PlanId>('six-months');
  const [activeCardIndex, setActiveCardIndex] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActiveCardIndex(current => (current + 1) % FEATURE_CARDS.length);
    }, 3200);

    return () => window.clearInterval(timer);
  }, []);

  const activePlan = PLANS.find(plan => plan.id === selectedPlan) || PLANS[1];

  return (
    <div className="pw">
      <div className="pw__header">
        <button type="button" className="pw__back" onClick={() => setCurrentView('dashboard')} aria-label="Back">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M15 18l-6-6 6-6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <h1 className="pw__title">Subscription</h1>
        <div className="pw__header-spacer" />
      </div>

      <div className="pw__body">
        <p className="pw__subtitle">Choose a plan that works best for you</p>

        <div className="pw__plans" role="radiogroup" aria-label="Subscription plans">
          {PLANS.map(plan => {
            const selected = selectedPlan === plan.id;
            return (
              <button
                key={plan.id}
                type="button"
                role="radio"
                aria-checked={selected}
                className={`pw__plan ${selected ? 'pw__plan--active' : ''}`}
                onClick={() => setSelectedPlan(plan.id)}
              >
                {plan.badge && <span className="pw__plan-badge">{plan.badge}</span>}
                <span className={`pw__radio ${selected ? 'pw__radio--active' : ''}`} aria-hidden="true" />
                <span className="pw__plan-title">{plan.title}</span>
                <strong className="pw__plan-price">{plan.price}</strong>
                <span className="pw__plan-duration">{plan.duration}</span>
                {plan.saveText && <span className="pw__plan-save">{plan.saveText}</span>}
              </button>
            );
          })}
        </div>

        <div className="pw__section-head">
          <span className="pw__section-line" />
          <h2 className="pw__section-title">What you will get</h2>
          <span className="pw__section-line" />
        </div>

        <div className="pw__carousel">
          <div className="pw__carousel-card">
            <img
              src={FEATURE_CARDS[activeCardIndex]}
              alt="Subscription feature card"
              className="pw__carousel-image"
            />
          </div>
          <div className="pw__dots" aria-label="Paywall feature slides">
            {FEATURE_CARDS.map((_, index) => (
              <button
                key={index}
                type="button"
                className={`pw__dot ${activeCardIndex === index ? 'pw__dot--active' : ''}`}
                onClick={() => setActiveCardIndex(index)}
                aria-label={`Show feature ${index + 1}`}
              />
            ))}
          </div>
        </div>

        <div className="pw__promo">
          <div className="pw__promo-copy">
            <p className="pw__promo-kicker">We love responsible borrowers!</p>
            <strong className="pw__promo-title">IF YOUR SCORE INCREASES BY 25 POINTS*</strong>
            <p className="pw__promo-text">
              Your subscription drops to just <span>₹229/Month</span>
            </p>
          </div>
          <div className="pw__promo-illustration" aria-hidden="true">
            <div className="pw__promo-coin pw__promo-coin--one" />
            <div className="pw__promo-coin pw__promo-coin--two" />
            <div className="pw__promo-device" />
          </div>
        </div>
      </div>

      <div className="pw__footer">
        <button type="button" className="pw__cta">
          {activePlan.ctaText}
        </button>
        <p className="pw__footer-note">100% secure. Cancel anytime.</p>
      </div>
    </div>
  );
}
