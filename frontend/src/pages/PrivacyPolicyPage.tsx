import { ArrowLeft, Shield } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-10">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-6">
          <ArrowLeft className="w-4 h-4" /> Back
        </Link>

        <div className="card p-8">
          <div className="flex items-center gap-3 mb-6">
            <Shield className="w-8 h-8 text-linkedin-500" />
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Privacy Policy</h1>
              <p className="text-sm text-gray-500">LinkedIn Smart Search Wrapper · Last updated: April 2026</p>
            </div>
          </div>

          <div className="prose prose-sm max-w-none text-gray-700 space-y-6">
            <section>
              <h2 className="text-lg font-semibold text-gray-900">1. Data Controller</h2>
              <p>deepakkulkarni.space ("we", "us") operates the LinkedIn Smart Search Wrapper application. Contact: deepakakulkarni@gmail.com</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900">2. Data We Collect</h2>
              <p><strong>Authentication data:</strong> LinkedIn profile ID, name, email address, and profile photo are collected via LinkedIn OAuth 2.0 and stored in our EU database to create and maintain your account.</p>
              <p><strong>Search queries:</strong> Your search parameters (filters and Boolean strings) are stored in search history for up to 90 days to power the history and saved searches features.</p>
              <p><strong>Session data:</strong> An encrypted session cookie is used to maintain your authenticated session. No LinkedIn credentials (username/password) are ever stored.</p>
              <p><strong>Not collected:</strong> Candidate profile data from search results is <strong>never</strong> persistently stored. Results are cached in memory for a maximum of 10 minutes and then permanently deleted.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900">3. Legal Basis (GDPR Art. 6)</h2>
              <p>We process your data based on your explicit consent (Art. 6(1)(a)) given on first login, and on the performance of the contract to provide you with the service (Art. 6(1)(b)).</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900">4. Data Residency & Storage</h2>
              <p>All data is processed and stored exclusively within the European Union (Hostinger EU datacenter, Frankfurt, Germany). We do not transfer personal data outside the EU/EEA.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900">5. Data Retention</h2>
              <ul className="list-disc list-inside space-y-1">
                <li>Account data: Retained while your account is active</li>
                <li>Search history: Auto-deleted after 90 days</li>
                <li>Search results cache: Deleted after 10 minutes</li>
                <li>GDPR audit logs: Retained for 365 days as required by applicable law</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900">6. Your Rights (GDPR Art. 15–22)</h2>
              <ul className="list-disc list-inside space-y-1">
                <li><strong>Right of Access (Art. 15):</strong> View your audit log in Settings</li>
                <li><strong>Right to Erasure (Art. 17):</strong> Delete your account from Settings</li>
                <li><strong>Right to Portability (Art. 20):</strong> Export your data from Settings</li>
                <li><strong>Right to Withdraw Consent:</strong> Log out at any time to end processing</li>
                <li><strong>Right to Lodge a Complaint:</strong> Contact your national data protection authority</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900">7. Cookies</h2>
              <p>We use one essential session cookie (<code>lssw.sid</code>) required for authentication. We do not use analytics, advertising, or tracking cookies.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900">8. LinkedIn Terms of Service</h2>
              <p>This application uses LinkedIn OAuth 2.0 for authentication (explicitly permitted). The automated LinkedIn search feature should be reviewed against LinkedIn's Terms of Service (Section 8.2) before commercial deployment. Users are responsible for their own compliance with LinkedIn's usage policies.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900">9. Contact</h2>
              <p>For privacy inquiries: <a href="mailto:deepakakulkarni@gmail.com" className="text-linkedin-500 underline">deepakakulkarni@gmail.com</a></p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
