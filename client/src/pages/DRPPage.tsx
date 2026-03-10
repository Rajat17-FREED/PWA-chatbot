import Layout from '../components/pwa/Layout';
import PageHeader from '../components/pwa/PageHeader';
import './ProgramPage.css';

const steps = [
  { title: 'Free Credit Assessment', desc: 'Your credit report, outstanding balances, repayment history, and capacity are evaluated.' },
  { title: 'Personalised Resolution Plan', desc: 'A tailored strategy including estimated settlement amounts and monthly contributions.' },
  { title: 'No Upfront Fees', desc: 'Program fees are linked to progress — you pay as settlements are achieved.' },
  { title: 'Harassment Support', desc: 'Guidance on handling recovery calls and escalation support during the process.' },
  { title: 'FREED Shield Protection', desc: 'Upload proof of harassment, escalate complaints, and get support for unfair practices.' },
  { title: 'Negotiated Settlement', desc: 'FREED negotiates with lenders to settle your debt for a reduced amount and close accounts.' },
];

export default function DRPPage() {
  return (
    <Layout>
      <PageHeader title="Debt Resolution Program (DRP)" subtitle="Settle your outstanding debts for a reduced amount through structured negotiation with lenders." />
      <div className="program-content">
        <section className="program-section">
          <h2>Who is DRP For?</h2>
          <div className="eligibility-grid">
            <div className="eligibility-item">Missed loan or credit card payments</div>
            <div className="eligibility-item">Facing recovery calls or collections</div>
            <div className="eligibility-item">Cannot repay outstanding debt in full</div>
            <div className="eligibility-item">Experiencing severe financial distress</div>
            <div className="eligibility-item">Delinquent unsecured loan accounts</div>
            <div className="eligibility-item">FOIR too high for regular repayment</div>
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
                <li>Settle debts for less than total outstanding</li>
                <li>Professional negotiation with lenders</li>
                <li>Relief from financial pressure and stress</li>
                <li>Clear path toward financial recovery</li>
                <li>No upfront program fees</li>
              </ul>
            </div>
            <div className="cons-col">
              <h3>Things to Know</h3>
              <ul>
                <li>Settlement may negatively affect credit score</li>
                <li>Settlement remarks appear in credit report</li>
                <li>Future credit access may be more difficult initially</li>
                <li>Requires discipline during the settlement process</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="program-section">
          <h2>Frequently Asked Questions</h2>
          <div className="faq-list">
            <details className="faq-item"><summary>How does your Loan Settlement Program work?</summary><p>FREED evaluates your financial situation and negotiates with lenders to settle debts for a reduced amount through a structured repayment process. You make monthly contributions to a Special Purpose Account, and settlements are negotiated as funds accumulate.</p></details>
            <details className="faq-item"><summary>Is loan settlement legitimate / is it legal?</summary><p>Yes. Debt settlement is a legitimate financial solution in India for borrowers who cannot repay their loans in full. It involves negotiating with lenders to accept a reduced payment as full settlement.</p></details>
            <details className="faq-item"><summary>What is a Special Purpose Account?</summary><p>A dedicated account used to accumulate funds for settling debts. Customers make monthly contributions until sufficient funds are available. The account is managed by an independent trustee, and you retain control over your funds.</p></details>
            <details className="faq-item"><summary>Will the program affect my credit score?</summary><p>Yes. Settled accounts may be reported differently than fully paid accounts, which can negatively impact your score. However, once debts are resolved, you can begin rebuilding your credit profile.</p></details>
            <details className="faq-item"><summary>Why do we charge a Platform Fee?</summary><p>The fee covers debt counseling, negotiation with lenders, harassment support, platform access, credit monitoring tools, and program management. Fees are linked to progress, not charged upfront.</p></details>
            <details className="faq-item"><summary>Do you guarantee a specific settlement percentage?</summary><p>No. Settlement outcomes depend on the lender, account status, and your repayment behaviour. Each lender has its own policies and negotiation varies case by case.</p></details>
            <details className="faq-item"><summary>Should I include all my loans in the program?</summary><p>This depends on your financial situation and the strategy developed during the program. In many cases, including multiple debts can help create a more effective settlement plan.</p></details>
            <details className="faq-item"><summary>Do interest and late fees continue after enrollment?</summary><p>Interest and penalties may continue to accrue until a settlement agreement is reached. The goal is to negotiate a final settlement that resolves the account.</p></details>
          </div>
        </section>
      </div>
    </Layout>
  );
}
