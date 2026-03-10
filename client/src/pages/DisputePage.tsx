import Layout from '../components/pwa/Layout';
import PageHeader from '../components/pwa/PageHeader';
import './ProgramPage.css';

const commonErrors = [
  { title: 'Wrong Outstanding Amount', desc: 'Your credit report shows an incorrect balance that doesn\'t match your actual outstanding.' },
  { title: 'Duplicate Account Entries', desc: 'The same loan appears multiple times in your report, inflating your total debt.' },
  { title: 'Fraud Account', desc: 'A loan or credit card appears on your report that you never applied for.' },
  { title: 'Closed Loan Still Active', desc: 'A loan you\'ve fully repaid still shows as active or outstanding.' },
  { title: 'Incorrect Personal Details', desc: 'Wrong name, address, or other personal information in your credit report.' },
];

export default function DisputePage() {
  return (
    <Layout>
      <PageHeader title="Raise a Dispute" subtitle="Found errors in your credit report? Report incorrect information and get it corrected." />
      <div className="program-content">
        <section className="program-section">
          <h2>Common Credit Report Errors</h2>
          <div className="factors-grid">
            {commonErrors.map(e => (
              <div key={e.title} className="factor-card">
                <h3>{e.title}</h3>
                <p>{e.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="program-section">
          <h2>How to Raise a Dispute</h2>
          <div className="process-steps">
            <div className="process-step">
              <div className="process-step__number">1</div>
              <div className="process-step__content">
                <h3>Check Your Credit Report</h3>
                <p>Review your credit report carefully for any incorrect or outdated information.</p>
              </div>
            </div>
            <div className="process-step">
              <div className="process-step__number">2</div>
              <div className="process-step__content">
                <h3>Identify the Error</h3>
                <p>Note the specific account, the incorrect detail, and what the correct information should be.</p>
              </div>
            </div>
            <div className="process-step">
              <div className="process-step__number">3</div>
              <div className="process-step__content">
                <h3>File a Dispute</h3>
                <p>Contact the credit bureau (CIBIL, Experian, Equifax, or CRIF) with supporting documents to correct the error.</p>
              </div>
            </div>
            <div className="process-step">
              <div className="process-step__number">4</div>
              <div className="process-step__content">
                <h3>Follow Up</h3>
                <p>Track your dispute status. Bureaus typically resolve disputes within 30-45 days.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="program-section">
          <h2>Why Correcting Errors Matters</h2>
          <ul className="tips-list">
            <li>Incorrect information can lower your credit score unfairly</li>
            <li>Errors may lead to loan application rejections</li>
            <li>Fraudulent accounts can indicate identity theft</li>
            <li>Accurate reports help lenders assess you fairly</li>
          </ul>
        </section>

        <section className="program-section">
          <h2>Need Help?</h2>
          <p>If you need assistance identifying errors or filing disputes, our team can help guide you through the process. Use the chat assistant to get started.</p>
        </section>
      </div>
    </Layout>
  );
}
