import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Cookie, X } from 'lucide-react';

const CONSENT_KEY = 'lssw_cookie_consent';

export default function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(CONSENT_KEY);
    if (!stored) setVisible(true);
  }, []);

  const accept = () => {
    localStorage.setItem(CONSENT_KEY, JSON.stringify({ accepted: true, at: new Date().toISOString() }));
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      className="fixed bottom-0 inset-x-0 z-50 p-4 bg-white border-t border-gray-200 shadow-lg md:max-w-xl md:mx-auto md:bottom-4 md:rounded-xl md:border"
    >
      <div className="flex gap-3">
        <Cookie className="w-6 h-6 text-linkedin-500 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm text-gray-700">
            We use only essential session cookies required for authentication. No tracking, no analytics.{' '}
            <Link to="/privacy" className="text-linkedin-500 underline">Privacy Policy</Link>
          </p>
          <div className="flex gap-2 mt-3">
            <button onClick={accept} className="btn-primary text-sm py-1.5 px-4">
              Accept
            </button>
            <button onClick={() => setVisible(false)} className="btn-secondary text-sm py-1.5 px-4">
              Decline (essential only)
            </button>
          </div>
        </div>
        <button
          onClick={() => setVisible(false)}
          className="self-start text-gray-400 hover:text-gray-600"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
