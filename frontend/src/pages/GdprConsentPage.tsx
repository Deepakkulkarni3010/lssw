import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Shield, CheckCircle, AlertCircle } from 'lucide-react';
import { authApi } from '../api/client';
import { useAuthStore } from '../stores/authStore';

export default function GdprConsentPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [checked, setChecked] = useState(false);
  const navigate = useNavigate();
  const { user, setUser } = useAuthStore();

  const handleAccept = async () => {
    if (!checked) { setError('Please read and accept the privacy policy.'); return; }
    setLoading(true);
    try {
      await authApi.gdprConsent();
      if (user) setUser({ ...user, gdprConsented: true });
      navigate('/search');
    } catch {
      setError('Failed to record consent. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const points = [
    'We process your LinkedIn profile (name, email, photo) to create your account.',
    'Search queries are stored for 90 days to support your history and saved searches.',
    'Candidate profiles from search results are NEVER stored — results cache for max 10 minutes.',
    'Your data is processed exclusively in the EU (Frankfurt region).',
    'You can export or delete all your data at any time from Settings.',
    'We do not sell, share, or transfer your data to third parties.',
  ];

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="card max-w-lg w-full p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center">
            <Shield className="w-6 h-6 text-linkedin-500" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Privacy & Data Consent</h1>
            <p className="text-sm text-gray-500">GDPR — EU Regulation 2016/679</p>
          </div>
        </div>

        <p className="text-gray-700 mb-4">
          Before using LinkedIn Smart Search, please review how we process your personal data:
        </p>

        <ul className="space-y-3 mb-6">
          {points.map((pt, i) => (
            <li key={i} className="flex gap-3 text-sm text-gray-700">
              <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
              {pt}
            </li>
          ))}
        </ul>

        <p className="text-sm text-gray-600 mb-5">
          For full details, read our{' '}
          <Link to="/privacy" target="_blank" className="text-linkedin-500 underline">
            Privacy Policy
          </Link>
          . Data controller: deepakkulkarni.space.
        </p>

        <label className="flex items-start gap-3 mb-5 cursor-pointer">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className="mt-0.5 w-4 h-4 accent-linkedin-500"
          />
          <span className="text-sm text-gray-700">
            I have read and understand the privacy policy and consent to the processing of my personal data as described above.
          </span>
        </label>

        {error && (
          <div className="flex gap-2 items-center text-red-600 text-sm mb-4">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        )}

        <button
          onClick={handleAccept}
          disabled={loading || !checked}
          className="btn-primary w-full py-3"
        >
          {loading ? 'Processing…' : 'I Accept — Continue to App'}
        </button>

        <button
          onClick={() => { authApi.logout(); window.location.href = '/'; }}
          className="mt-3 w-full text-sm text-gray-500 hover:text-gray-700 underline"
        >
          Decline and log out
        </button>
      </div>
    </div>
  );
}
