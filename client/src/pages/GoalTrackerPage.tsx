import Layout from '../components/pwa/Layout';
import PageHeader from '../components/pwa/PageHeader';
import './ProgramPage.css';

const sampleGoals = [
  { label: 'Improve Credit Score to 750+', progress: 65 },
  { label: 'Reduce Credit Utilization to 30%', progress: 40 },
  { label: 'Clear Overdue Payments', progress: 80 },
];

export default function GoalTrackerPage() {
  return (
    <Layout>
      <PageHeader title="Goal Tracker" subtitle="Set financial goals, track progress, and get personalized steps to improve your credit health." />
      <div className="program-content">
        <section className="program-section">
          <h2>What is Goal Tracker?</h2>
          <p>The Goal Tracker helps you set and achieve credit-related goals with a personalized 6-month roadmap. It creates actionable steps based on your credit profile and tracks your progress over time.</p>
        </section>

        <section className="program-section">
          <h2>Goal Types</h2>
          <div className="eligibility-grid">
            <div className="eligibility-item">Improve credit score to a target</div>
            <div className="eligibility-item">Qualify for a specific loan</div>
            <div className="eligibility-item">Reduce credit utilization</div>
            <div className="eligibility-item">Build credit history from scratch</div>
          </div>
        </section>

        <section className="program-section">
          <h2>Sample Progress</h2>
          <div className="progress-list">
            {sampleGoals.map(g => (
              <div key={g.label} className="progress-item">
                <div className="progress-item__label">
                  <span>{g.label}</span>
                  <span>{g.progress}%</span>
                </div>
                <div className="progress-bar">
                  <div className="progress-bar__fill" style={{ width: `${g.progress}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="program-section">
          <h2>Credit Insights — ₹99/month</h2>
          <p>Subscribe to Credit Insights to power your Goal Tracker with real-time data:</p>
          <div className="eligibility-grid" style={{ marginTop: '16px' }}>
            <div className="eligibility-item">Latest credit score with explanation</div>
            <div className="eligibility-item">Monthly personalized video analysis</div>
            <div className="eligibility-item">Score factor breakdown</div>
            <div className="eligibility-item">6-month Credit Wrap report</div>
            <div className="eligibility-item">Actionable improvement steps</div>
            <div className="eligibility-item">Score improvement projections</div>
          </div>
        </section>

        <section className="program-section">
          <h2>How It Works</h2>
          <div className="process-steps">
            <div className="process-step">
              <div className="process-step__number">1</div>
              <div className="process-step__content">
                <h3>Set Your Goal</h3>
                <p>Choose a target — improving score, qualifying for a loan, or reducing utilization.</p>
              </div>
            </div>
            <div className="process-step">
              <div className="process-step__number">2</div>
              <div className="process-step__content">
                <h3>Get Your Roadmap</h3>
                <p>Receive a 6-month personalized plan with specific actions to take each month.</p>
              </div>
            </div>
            <div className="process-step">
              <div className="process-step__number">3</div>
              <div className="process-step__content">
                <h3>Track Progress</h3>
                <p>Monitor your progress with visual tracking. If goals aren't met, the system recalibrates your plan.</p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </Layout>
  );
}
