import type { User } from '../../../types';
import { SEGMENT_LABELS } from '../../../constants';
import './ProgramTab.css';

interface ProgramTabProps {
  user: User;
}

const PROGRAM_INFO: Record<string, { title: string; tagline: string; features: { icon: string; title: string; desc: string }[]; cta: string }> = {
  DEP: {
    title: 'Debt Elimination Program',
    tagline: 'Close your loans faster with our personalised strategies and save up to ₹24,000* in interest.',
    features: [
      { icon: '📋', title: 'Clear payoff plan', desc: 'Close your loans faster with our personalised strategies' },
      { icon: '📊', title: 'Credit health explained', desc: 'Monthly videos that break down your score in plain english' },
      { icon: '📈', title: 'Credit score boost plan', desc: 'Get personalised step-by-step guidance based on your target score' },
      { icon: '🔔', title: 'Smart payment reminders', desc: 'Stay on time, every time. Avoid late fees and credit dips' },
      { icon: '🔄', title: 'Credit Wrap', desc: 'Understand how your past affects your score' },
    ],
    cta: 'Explore DEP',
  },
  DRP_Eligible: {
    title: 'Debt Resolution Program',
    tagline: 'Save on your overdue loans and have a team to support you when you need it the most.',
    features: [
      { icon: '🤝', title: 'Professional negotiation', desc: 'We negotiate with your creditors on your behalf' },
      { icon: '🛡️', title: 'FREED Shield protection', desc: 'Protection from recovery harassment' },
      { icon: '💰', title: 'Settlement savings', desc: 'Save up to 50% on your total outstanding debt' },
      { icon: '📋', title: 'Structured plan', desc: 'Clear timeline with monthly payment schedule' },
      { icon: '📊', title: 'Credit recovery path', desc: 'Step-by-step plan to rebuild your credit score' },
    ],
    cta: 'Start DRP Journey',
  },
  DRP_Ineligible: {
    title: 'Financial Recovery Guidance',
    tagline: 'While you may not be eligible for DRP right now, we can still help you manage your situation.',
    features: [
      { icon: '📊', title: 'Credit insights', desc: 'Understand what\'s affecting your credit score' },
      { icon: '🛡️', title: 'FREED Shield', desc: 'Protection from recovery agent harassment' },
      { icon: '💡', title: 'Recovery guidance', desc: 'Steps to improve your financial situation' },
      { icon: '📈', title: 'Score improvement', desc: 'Personalized plan to rebuild your credit' },
    ],
    cta: 'Get Started',
  },
  DCP_Eligible: {
    title: 'Debt Consolidation Program',
    tagline: 'Combine multiple EMIs into one. Simplify your finances and reduce your monthly burden.',
    features: [
      { icon: '🔗', title: 'Single EMI', desc: 'Combine all your loans into one manageable payment' },
      { icon: '💸', title: 'Lower monthly burden', desc: 'Reduce your FOIR and free up monthly cash flow' },
      { icon: '📋', title: 'Simple process', desc: 'Easy application with quick approval' },
      { icon: '📊', title: 'Better credit health', desc: 'Structured repayment improves your credit over time' },
    ],
    cta: 'Explore DCP',
  },
  DCP_Ineligible: {
    title: 'Credit Improvement Program',
    tagline: 'Work on your credit profile to qualify for better financial products.',
    features: [
      { icon: '📊', title: 'Score analysis', desc: 'Understand factors dragging your score down' },
      { icon: '📈', title: 'Improvement roadmap', desc: 'Step-by-step guidance to improve your credit' },
      { icon: '💡', title: 'Smart tips', desc: 'Actionable advice for better financial health' },
    ],
    cta: 'Start Improving',
  },
  NTC: {
    title: 'Credit Building Program',
    tagline: 'Start your credit journey on the right foot with FREED\'s guidance.',
    features: [
      { icon: '🏗️', title: 'Build from scratch', desc: 'Learn how to establish your first credit lines' },
      { icon: '💳', title: 'Secured cards', desc: 'Get started with FD-backed credit cards' },
      { icon: '📊', title: 'Score monitoring', desc: 'Track your credit score as it grows' },
      { icon: '🎯', title: 'Goal setting', desc: 'Set targets and track your credit building progress' },
    ],
    cta: 'Learn More About FREED',
  },
  Others: {
    title: 'Credit Wellness Program',
    tagline: 'Maintain and improve your credit health with ongoing monitoring and insights.',
    features: [
      { icon: '📊', title: 'Credit monitoring', desc: 'Stay on top of changes to your credit profile' },
      { icon: '🎯', title: 'Score goals', desc: 'Set and track credit improvement targets' },
      { icon: '💡', title: 'Smart insights', desc: 'Personalized tips based on your credit data' },
    ],
    cta: 'Get Insights',
  },
};

export default function ProgramTab({ user }: ProgramTabProps) {
  const seg = user.segment;
  const program = PROGRAM_INFO[seg] || PROGRAM_INFO.Others;

  return (
    <div className="program-tab">
      {/* Program Header */}
      <section className="program-tab__hero">
        <div className="program-tab__badge">
          {SEGMENT_LABELS[seg] || seg}
        </div>
        <h1 className="program-tab__title">{program.title}</h1>
        <p className="program-tab__tagline">{program.tagline}</p>
      </section>

      {/* Premium Card */}
      <section className="program-tab__section">
        <div className="premium-card">
          <div className="premium-card__header">
            <span className="premium-card__star">⭐</span>
            <span className="premium-card__label">P R E M I U M</span>
            <span className="premium-card__star">⭐</span>
          </div>
          <p className="premium-card__sub">Unlock smarter credit decisions via</p>
          <strong className="premium-card__pulse">Pulse 👑</strong>
          <div className="premium-card__price">
            <span className="premium-card__tag">Limited Time Offer</span>
            <div className="premium-card__amount">₹99<span>/mo</span></div>
            <p className="premium-card__billing">Billed Monthly</p>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="program-tab__section">
        <div className="program-features">
          <div className="program-features__header">
            <span>✦</span>
            <strong>Unlock the Plan That Puts You in Control</strong>
            <span>✦</span>
          </div>

          {program.features.map((f, i) => (
            <div key={i} className="program-feature">
              <div className="program-feature__icon">{f.icon}</div>
              <div className="program-feature__content">
                <strong>{f.title}</strong>
                <p>{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Boost Offer */}
      {(seg === 'DEP' || seg === 'DRP_Eligible') && (
        <section className="program-tab__section">
          <div className="boost-offer">
            <p>We love responsible borrowers! 🎉</p>
            <strong>IF YOU BOOST YOUR SCORE BY 50 POINTS*</strong>
            <p className="boost-offer__sub">Your subscription drops to just <strong>₹49/Month</strong></p>
          </div>
        </section>
      )}

      {/* CTA */}
      <section className="program-tab__section">
        <button className="program-tab__cta">
          {program.cta}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ marginLeft: 8 }}>
            <path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <p className="program-tab__secure">100% secure. Cancel anytime.</p>
      </section>

      <div style={{ height: 80 }} />
    </div>
  );
}
