import Layout from '../components/pwa/Layout';
import PageHeader from '../components/pwa/PageHeader';
import './ProgramPage.css';

const steps = [
  { title: 'Report the Incident', desc: 'Report harassment from recovery agents or lenders through the FREED Shield section.' },
  { title: 'Upload Supporting Evidence', desc: 'Upload call recordings, screenshots, messages, or written descriptions of the event.' },
  { title: 'Review & Escalation', desc: 'The case is reviewed and escalated to the concerned lender or relevant authority if required.' },
  { title: 'Resolution Support', desc: 'Receive guidance on managing the situation and what steps may follow.' },
];

const harassmentTypes = [
  { title: 'Repeated or Excessive Calls', desc: 'Agents calling repeatedly within short intervals or at inappropriate times.' },
  { title: 'Abusive or Threatening Language', desc: 'Using offensive language, threats, or intimidation during communication.' },
  { title: 'Public Embarrassment', desc: 'Contacting family, colleagues, or neighbours to cause social pressure.' },
  { title: 'Misrepresentation', desc: 'Providing misleading information about legal consequences or falsely claiming authority.' },
  { title: 'Unauthorized Visits', desc: 'Visiting your home or workplace in an intimidating or inappropriate manner.' },
];

export default function FreedShieldPage() {
  return (
    <Layout>
      <PageHeader title="FREED Shield" subtitle="Protection from recovery agent harassment. Report incidents, upload evidence, and get support." />
      <div className="program-content">
        <section className="program-section">
          <h2>How FREED Shield Works</h2>
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
          <h2>Types of Harassment You Can Report</h2>
          <div className="factors-grid">
            {harassmentTypes.map(h => (
              <div key={h.title} className="factor-card">
                <h3>{h.title}</h3>
                <p>{h.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="program-section">
          <h2>Know Your Legal Rights</h2>
          <p>Borrowers in India are protected by RBI guidelines regarding fair debt recovery practices:</p>
          <div className="eligibility-grid" style={{ marginTop: '16px' }}>
            <div className="eligibility-item">Recovery agents must communicate respectfully</div>
            <div className="eligibility-item">Calls restricted to 7:00 AM - 7:00 PM</div>
            <div className="eligibility-item">No public humiliation or shaming</div>
            <div className="eligibility-item">Agents must identify themselves and their lender</div>
            <div className="eligibility-item">No intimidation, coercion, or unlawful actions</div>
            <div className="eligibility-item">Right to raise complaints with lender or RBI</div>
          </div>
        </section>

        <section className="program-section">
          <h2>Frequently Asked Questions</h2>
          <div className="faq-list">
            <details className="faq-item"><summary>What is FREED Shield?</summary><p>A support feature designed to help customers handle harassment or unfair recovery practices by lenders or recovery agents.</p></details>
            <details className="faq-item"><summary>How does FREED Shield protect me?</summary><p>You can report harassment incidents and upload supporting evidence, which can be escalated to lenders for review and resolution.</p></details>
            <details className="faq-item"><summary>Is FREED Shield a legal service?</summary><p>FREED Shield provides support and escalation mechanisms but is not a legal representation service.</p></details>
            <details className="faq-item"><summary>Can FREED Shield help if agents visit my home or office?</summary><p>Yes. The feature provides guidance and escalation support for such situations, helping you report inappropriate recovery practices.</p></details>
            <details className="faq-item"><summary>Will my evidence be shared with my lender automatically?</summary><p>Evidence may be reviewed and escalated to lenders when necessary to address the issue.</p></details>
            <details className="faq-item"><summary>Is uploading evidence mandatory?</summary><p>No. Uploading evidence is optional but can help strengthen a complaint.</p></details>
            <details className="faq-item"><summary>What formats can I upload as proof?</summary><p>Screenshots, call recordings, messages, photos, or other relevant documents.</p></details>
            <details className="faq-item"><summary>Will reporting harassment affect my credit score?</summary><p>No. Reporting harassment through FREED Shield does not impact your credit score.</p></details>
          </div>
        </section>
      </div>
    </Layout>
  );
}
