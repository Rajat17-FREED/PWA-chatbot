import Layout from '../components/pwa/Layout';
import PageHeader from '../components/pwa/PageHeader';
import './ProgramPage.css';

const scoreRanges = [
  { range: '750 – 900', label: 'Excellent', color: '#10B981', desc: 'High chance of loan approval, best interest rates' },
  { range: '700 – 749', label: 'Good', color: '#34D399', desc: 'Loan approvals likely, competitive rates' },
  { range: '650 – 699', label: 'Fair', color: '#F59E0B', desc: 'Some lenders may approve with higher rates' },
  { range: '550 – 649', label: 'Poor', color: '#F97316', desc: 'Loan approvals difficult' },
  { range: '300 – 549', label: 'Very Poor', color: '#EF4444', desc: 'Most lenders will reject applications' },
  { range: '-1 / NH', label: 'No History', color: '#6B7280', desc: 'New to Credit — no score generated yet' },
];

const factors = [
  { title: 'Payment History', desc: 'The most important factor. Paying EMIs and credit card bills on time builds a strong score. Even one missed payment can cause a noticeable drop.', weight: 'Highest Impact' },
  { title: 'Credit Utilization', desc: 'How much of your available credit limit you are using. Experts recommend keeping utilization below 30-40% of your credit limit.', weight: 'High Impact' },
  { title: 'Credit Mix', desc: 'A balanced mix of secured (home, auto) and unsecured (personal, credit card) loans shows versatility in credit management.', weight: 'Medium Impact' },
  { title: 'Length of Credit History', desc: 'Longer credit history shows more reliable behaviour. Avoid closing your oldest credit accounts.', weight: 'Medium Impact' },
  { title: 'Credit Enquiries', desc: 'Each loan application triggers a hard inquiry. Too many applications in a short time signals financial stress.', weight: 'Lower Impact' },
];

export default function CreditScorePage() {
  return (
    <Layout>
      <PageHeader title="Understanding Your Credit Score" subtitle="Your credit score is your financial report card — a 3-digit number (300-900) that tells lenders how reliable you are." />
      <div className="program-content">
        <section className="program-section">
          <h2>Credit Score Ranges</h2>
          <div className="score-table">
            {scoreRanges.map(s => (
              <div key={s.range} className="score-row">
                <div className="score-range">{s.range}</div>
                <span className="score-badge" style={{ background: s.color }}>{s.label}</span>
                <div className="score-desc">{s.desc}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="program-section">
          <h2>Key Factors Affecting Your Score</h2>
          <div className="factors-grid">
            {factors.map(f => (
              <div key={f.title} className="factor-card">
                <div className="factor-card__header">
                  <h3>{f.title}</h3>
                  <span className="factor-badge">{f.weight}</span>
                </div>
                <p>{f.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="program-section">
          <h2>Common Mistakes That Hurt Your Score</h2>
          <div className="faq-list">
            <details className="faq-item"><summary>Missing EMI or credit card payments</summary><p>Even a single late payment can significantly lower your score and remains on your report for years. Set payment reminders or enable auto-debit.</p></details>
            <details className="faq-item"><summary>Paying only minimum due on credit cards</summary><p>The remaining balance accumulates interest, increasing your utilization ratio over time. Try to pay the full bill each month.</p></details>
            <details className="faq-item"><summary>Using too much of your credit limit</summary><p>High utilization (above 40%) signals financial stress. Keep spending well below your limit.</p></details>
            <details className="faq-item"><summary>Applying for too many loans at once</summary><p>Each application triggers a hard inquiry. Multiple applications in a short period can drop your score.</p></details>
            <details className="faq-item"><summary>Closing old credit cards</summary><p>Older accounts contribute to your credit history length. Closing them reduces your average credit age.</p></details>
            <details className="faq-item"><summary>Ignoring errors in your credit report</summary><p>Incorrect or outdated information can harm your score. Check your report periodically and dispute errors.</p></details>
          </div>
        </section>

        <section className="program-section">
          <h2>Tips for a Healthy Credit Score</h2>
          <ul className="tips-list">
            <li>Pay EMIs and credit card bills on time every month</li>
            <li>Keep credit card utilization below 30-40%</li>
            <li>Avoid applying for multiple loans simultaneously</li>
            <li>Maintain older credit accounts when possible</li>
            <li>Monitor your credit report regularly for errors</li>
            <li>Maintain a healthy mix of secured and unsecured credit</li>
          </ul>
        </section>
      </div>
    </Layout>
  );
}
