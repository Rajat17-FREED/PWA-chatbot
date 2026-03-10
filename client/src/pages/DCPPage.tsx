import Layout from '../components/pwa/Layout';
import PageHeader from '../components/pwa/PageHeader';
import './ProgramPage.css';

const steps = [
  { title: 'Debt Assessment', desc: 'All outstanding debts, current EMIs, and interest rates are identified and analyzed.' },
  { title: 'Consolidation Simulation', desc: 'The system estimates a consolidated loan covering your total outstanding amount.' },
  { title: 'EMI Calculation', desc: 'A new single EMI is calculated based on consolidated principal, tenure, and interest rate.' },
  { title: 'Enrollment', desc: 'You enroll in the consolidation program after reviewing the plan.' },
  { title: 'Loan Issuance', desc: 'The consolidated loan replaces your multiple debts — you pay one EMI going forward.' },
];

export default function DCPPage() {
  return (
    <Layout>
      <PageHeader title="Debt Consolidation Program (DCP)" subtitle="Combine multiple loans into a single EMI. Simplify your finances and reduce your monthly burden." />
      <div className="program-content">
        <section className="program-section">
          <h2>Who is DCP For?</h2>
          <div className="eligibility-grid">
            <div className="eligibility-item">Multiple active loans or credit cards</div>
            <div className="eligibility-item">FOIR greater than 50%</div>
            <div className="eligibility-item">Credit score above 700</div>
            <div className="eligibility-item">Minimum unsecured debt of ₹1,50,000</div>
            <div className="eligibility-item">Struggling to manage multiple EMIs</div>
            <div className="eligibility-item">Still largely current on repayments</div>
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
                <li>Single EMI — easier debt management</li>
                <li>Lower monthly repayment burden</li>
                <li>Reduced complexity — one payment instead of many</li>
                <li>Structured repayment schedule</li>
              </ul>
            </div>
            <div className="cons-col">
              <h3>Things to Know</h3>
              <ul>
                <li>Consolidation may extend repayment tenure</li>
                <li>Total interest paid may increase with longer tenure</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="program-section">
          <h2>Frequently Asked Questions</h2>
          <div className="faq-list">
            <details className="faq-item"><summary>What is FREED's loan consolidation program?</summary><p>It combines multiple debts into a single structured loan with one EMI, making repayment simpler and easier to manage.</p></details>
            <details className="faq-item"><summary>What types of loans can I consolidate?</summary><p>Typically unsecured debts such as credit card balances, personal loans, and app-based lending loans may be consolidated depending on eligibility.</p></details>
            <details className="faq-item"><summary>Can loan consolidation save me money?</summary><p>In some cases, yes. Consolidation can reduce the monthly EMI burden and simplify repayment, though total savings depend on the loan terms and tenure.</p></details>
            <details className="faq-item"><summary>Can I keep using my credit cards during the program?</summary><p>In most cases, customers are advised to avoid taking additional credit while enrolled to prevent further debt accumulation.</p></details>
            <details className="faq-item"><summary>How will consolidation affect my credit score?</summary><p>Consolidation itself does not harm your credit score. Successfully managing the consolidated loan and making timely payments may improve your credit profile.</p></details>
            <details className="faq-item"><summary>Can I get a consolidated loan with a low credit score?</summary><p>Eligibility depends on lender policies. The standard requirement is a credit score above 700, though some borrowers may qualify based on their overall financial profile.</p></details>
            <details className="faq-item"><summary>How long does approval take?</summary><p>Approval timelines vary based on lender processes and documentation requirements.</p></details>
          </div>
        </section>
      </div>
    </Layout>
  );
}
