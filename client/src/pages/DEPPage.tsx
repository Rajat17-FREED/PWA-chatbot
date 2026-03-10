import Layout from '../components/pwa/Layout';
import PageHeader from '../components/pwa/PageHeader';
import './ProgramPage.css';

const steps = [
  { title: 'Credit Analysis', desc: 'Your active loans, outstanding balances, EMIs, and interest rates are analyzed from your credit report.' },
  { title: 'Income & Commitment', desc: 'You provide your monthly income and the amount you can allocate toward accelerated debt repayment.' },
  { title: 'Program Simulation', desc: 'The system calculates an optimized repayment sequence, potential interest savings, and your new debt-free timeline.' },
  { title: 'Plan Generation', desc: 'A personalized DEP plan is generated with clear repayment priorities and milestones.' },
  { title: 'Execution', desc: 'You follow the structured repayment strategy to pay off loans faster and save on interest.' },
];

export default function DEPPage() {
  return (
    <Layout>
      <PageHeader title="Debt Elimination Program (DEP)" subtitle="A structured repayment strategy to help you pay off loans faster and reduce total interest paid." />
      <div className="program-content">
        <section className="program-section">
          <h2>Who is DEP For?</h2>
          <div className="eligibility-grid">
            <div className="eligibility-item">Active loans or credit card balances</div>
            <div className="eligibility-item">FOIR less than 50%</div>
            <div className="eligibility-item">Currently able to make payments</div>
            <div className="eligibility-item">No delinquency on accounts</div>
            <div className="eligibility-item">Some surplus monthly income available</div>
            <div className="eligibility-item">Want to become debt-free faster</div>
          </div>
        </section>

        <section className="program-section">
          <h2>How It Works</h2>
          <div className="process-steps">
            {steps.map((s, i) => (
              <div key={i} className="process-step">
                <div className="process-step__number">{i + 1}</div>
                <div className="process-step__content">
                  <h3>{s.title}</h3>
                  <p>{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="program-section">
          <h2>Advantages & Disadvantages</h2>
          <div className="pros-cons">
            <div className="pros-col">
              <h3>Advantages</h3>
              <ul>
                <li>Faster debt repayment — close loans ahead of schedule</li>
                <li>Reduced total interest paid</li>
                <li>Better credit health from lower outstanding balances</li>
                <li>Clear structured repayment roadmap</li>
              </ul>
            </div>
            <div className="cons-col">
              <h3>Things to Know</h3>
              <ul>
                <li>Requires consistent financial discipline</li>
                <li>Higher repayments may reduce short-term spending capacity</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="program-section">
          <h2>Frequently Asked Questions</h2>
          <div className="faq-list">
            <details className="faq-item"><summary>How can I close my loans faster?</summary><p>By allocating surplus income toward accelerated repayment using a priority-based strategy. DEP creates an optimized sequence to maximize interest savings.</p></details>
            <details className="faq-item"><summary>Which loan should I pay off first?</summary><p>DEP analyzes all your loans and determines the optimal payoff order based on interest rates, balances, and your financial capacity.</p></details>
            <details className="faq-item"><summary>How much interest can I save?</summary><p>Savings depend on your loan portfolio and the surplus amount you can commit. DEP's simulation shows exact projected savings before you enroll.</p></details>
            <details className="faq-item"><summary>Will this improve my credit score?</summary><p>Yes. Reducing outstanding balances improves your credit utilization ratio, which positively impacts your credit score over time.</p></details>
          </div>
        </section>
      </div>
    </Layout>
  );
}
