import './ShieldTab.css';

export default function ShieldTab() {
  return (
    <div className="shield-tab">
      {/* Hero */}
      <section className="shield-tab__hero">
        <div className="shield-tab__icon-wrap">
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="var(--freed-navy)" strokeWidth="1.5" fill="rgba(27,43,101,0.05)" />
            <path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13" stroke="var(--freed-orange)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h1 className="shield-tab__title">FREED Shield</h1>
        <p className="shield-tab__subtitle">
          Get the power of FREED Shield to protect you from recovery harassment.
        </p>
      </section>

      {/* What is it */}
      <section className="shield-tab__section">
        <div className="shield-card">
          <h3>What is FREED Shield?</h3>
          <p>FREED Shield protects you from unethical recovery practices. If you're being harassed by recovery agents, we step in to help.</p>
        </div>
      </section>

      {/* Types of Harassment */}
      <section className="shield-tab__section">
        <h3 className="shield-tab__heading">Types of Recovery Harassment</h3>
        <div className="harassment-grid">
          {[
            { icon: '📞', title: 'Excessive Calls', desc: 'Repeated calls at odd hours or to family/friends' },
            { icon: '⚠️', title: 'Threats & Intimidation', desc: 'Threatening legal action, arrest, or property seizure' },
            { icon: '🏠', title: 'Unauthorized Visits', desc: 'Showing up at your home or workplace uninvited' },
            { icon: '📢', title: 'Public Embarrassment', desc: 'Sharing your debt info with neighbors or colleagues' },
            { icon: '❌', title: 'Misrepresentation', desc: 'Agents posing as police or court officials' },
          ].map((item, i) => (
            <div key={i} className="harassment-card">
              <span className="harassment-card__icon">{item.icon}</span>
              <strong>{item.title}</strong>
              <p>{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How It Works */}
      <section className="shield-tab__section">
        <h3 className="shield-tab__heading">How FREED Shield Works</h3>
        <div className="shield-steps">
          {[
            { step: '01', title: 'Report the Incident', desc: 'Tell us what happened — calls, visits, threats, or any form of harassment.' },
            { step: '02', title: 'Upload Evidence', desc: 'Share call recordings, screenshots, or photos as proof.' },
            { step: '03', title: 'We Review & Escalate', desc: 'Our team reviews your case and contacts the creditor directly.' },
            { step: '04', title: 'Resolution & Support', desc: 'We work to stop the harassment and keep you protected.' },
          ].map((item, i) => (
            <div key={i} className="shield-step">
              <div className="shield-step__number">{item.step}</div>
              <div className="shield-step__content">
                <strong>{item.title}</strong>
                <p>{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* RBI Guidelines */}
      <section className="shield-tab__section">
        <div className="rbi-card">
          <h3>🏛️ Your Rights Under RBI Guidelines</h3>
          <ul className="rbi-card__list">
            <li>Recovery agents must identify themselves</li>
            <li>No calls before 8 AM or after 7 PM</li>
            <li>No threatening language or physical intimidation</li>
            <li>No contacting third parties about your debt</li>
            <li>You can request agents to only communicate in writing</li>
          </ul>
        </div>
      </section>

      {/* Report CTA */}
      <section className="shield-tab__section">
        <button className="shield-tab__cta">
          Report Harassment
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ marginLeft: 8 }}>
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </section>

      {/* Dispute Section */}
      <section className="shield-tab__section">
        <div className="dispute-card">
          <h3>📝 Credit Report Dispute</h3>
          <p>Found errors in your credit report? We can help you raise a dispute.</p>
          <div className="dispute-card__errors">
            {['Wrong amounts', 'Duplicate accounts', 'Fraud entries', 'Closed loans shown active'].map((err, i) => (
              <span key={i} className="dispute-card__tag">{err}</span>
            ))}
          </div>
          <p className="dispute-card__timeline">Typical resolution: 30-45 days</p>
        </div>
      </section>

      <div style={{ height: 80 }} />
    </div>
  );
}
