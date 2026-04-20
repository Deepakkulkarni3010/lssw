import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Linkedin, Search, Bookmark, Zap, Shield } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';

export default function LoginPage() {
  const { user, isLoading } = useAuthStore();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && user?.gdprConsented) navigate('/search');
    else if (!isLoading && user && !user.gdprConsented) navigate('/gdpr-consent');
  }, [user, isLoading, navigate]);

  const handleLogin = () => {
    window.location.href = '/auth/linkedin';
  };

  const features = [
    { icon: Search, title: 'Boolean + Filters', desc: 'Combine LinkedIn filters with #OpenToWork, "Immediate Joiner" and any custom string simultaneously.' },
    { icon: Bookmark, title: 'Saved Templates', desc: 'Save compound searches and re-run with one click. Build a library of recruiter workflows.' },
    { icon: Zap, title: 'LinkedIn Premium', desc: 'Leverage your Premium account\'s extended filters — experience, company size, school.' },
    { icon: Shield, title: 'GDPR Compliant', desc: 'EU data residency. No candidate data stored. Your privacy is our first concern.' },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex flex-col">
      {/* Header */}
      <header className="px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center gap-2 text-linkedin-500 font-bold text-xl">
          <Linkedin className="w-7 h-7" />
          <span>LinkedIn Smart Search</span>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-12">
        <div className="text-center max-w-2xl mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-linkedin-50 text-linkedin-500 rounded-full text-sm font-medium mb-4">
            <span className="w-2 h-2 bg-linkedin-500 rounded-full animate-pulse" />
            LinkedIn Premium Enhanced
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4 leading-tight">
            Find the Right Candidates, <span className="text-linkedin-500">Faster</span>
          </h1>
          <p className="text-lg text-gray-600 mb-8">
            Layer Boolean search strings on top of LinkedIn's structured filters.
            One query, zero compromise.
          </p>

          {/* Login button */}
          <button
            onClick={handleLogin}
            className="inline-flex items-center gap-3 px-8 py-4 bg-linkedin-500 text-white text-lg font-semibold rounded-xl hover:bg-linkedin-600 transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5"
            aria-label="Sign in with LinkedIn"
          >
            <Linkedin className="w-6 h-6" />
            Sign in with LinkedIn
          </button>
          <p className="mt-3 text-sm text-gray-500">
            No passwords stored. OAuth 2.0 only.
          </p>
        </div>

        {/* Feature cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl w-full">
          {features.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="card p-5 flex gap-4">
              <div className="w-10 h-10 bg-linkedin-50 rounded-lg flex items-center justify-center flex-shrink-0">
                <Icon className="w-5 h-5 text-linkedin-500" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 mb-1">{title}</h3>
                <p className="text-sm text-gray-600">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </main>

      {/* Footer */}
      <footer className="text-center py-4 text-sm text-gray-400">
        <a href="/privacy" className="hover:text-gray-600 underline">Privacy Policy</a>
        {' · '}
        EU Data Residency · deepakkulkarni.space
      </footer>
    </div>
  );
}
