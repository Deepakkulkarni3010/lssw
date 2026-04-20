import { useEffect, useState } from 'react';
import { Settings, Shield, Download, Trash2, BarChart3, LogOut, ExternalLink, Key } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { searchApi, gdprApi, authApi, api } from '../api/client';

export default function SettingsPage() {
  const { user, logout } = useAuthStore();
  const [rateLimit, setRateLimit] = useState<{ used: number; limit: number; remaining: number; resetAt: number } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [liAt, setLiAt] = useState('');
  const [jsessionid, setJsessionid] = useState('');
  const [sessionStatus, setSessionStatus] = useState<'idle'|'saving'|'ok'|'error'>('idle');

  const handleSaveLinkedInSession = async () => {
    if (!liAt || !jsessionid) return;
    setSessionStatus('saving');
    try {
      await api.post('/auth/linkedin-session', { liAt, jsessionid });
      setSessionStatus('ok');
      setLiAt(''); setJsessionid('');
    } catch {
      setSessionStatus('error');
    }
  };

  useEffect(() => {
    searchApi.rateLimit().then((r) => setRateLimit(r.data)).catch(() => {});
  }, []);

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await gdprApi.export();
      const url = URL.createObjectURL(new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url; a.download = 'lssw-data-export.json'; a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!confirm('Permanently delete your account and all data? This cannot be undone.')) return;
    if (!confirm('Are you absolutely sure? All saved searches and history will be deleted.')) return;
    setDeleting(true);
    try {
      await gdprApi.deleteMe();
      logout();
      window.location.href = '/';
    } finally {
      setDeleting(false);
    }
  };

  const handleLogout = async () => {
    await authApi.logout().catch(() => {});
    logout();
    window.location.href = '/';
  };

  const resetMinutes = rateLimit
    ? Math.max(0, Math.ceil((rateLimit.resetAt - Date.now()) / 60000))
    : null;

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
        <Settings className="w-6 h-6 text-linkedin-500" />
        Settings
      </h1>

      {/* Account */}
      <div className="card p-5">
        <h2 className="font-semibold text-gray-800 mb-4">Account</h2>
        <div className="flex items-center gap-3 mb-4">
          {user?.profilePic && (
            <img src={user.profilePic} alt={user.fullName} className="w-12 h-12 rounded-full" />
          )}
          <div>
            <p className="font-medium text-gray-900">{user?.fullName}</p>
            <p className="text-sm text-gray-500">{user?.email}</p>
            <span className="inline-block mt-1 badge bg-yellow-100 text-yellow-700 capitalize">
              {user?.linkedinTier} account
            </span>
          </div>
        </div>
        <button onClick={handleLogout} className="btn-secondary flex items-center gap-2 text-sm">
          <LogOut className="w-4 h-4" />
          Log out
        </button>
      </div>


      {/* LinkedIn Browser Session */}
      <div className="card p-5 border-yellow-200 bg-yellow-50">
        <h2 className="font-semibold text-gray-800 mb-1 flex items-center gap-2">
          <Key className="w-4 h-4 text-yellow-600" />
          LinkedIn Session Setup (Required)
        </h2>
        <p className="text-sm text-gray-600 mb-3">
          To perform searches, paste your LinkedIn browser cookies below.
          Go to <strong>linkedin.com</strong> → F12 → Application → Cookies → copy <code>li_at</code> and <code>JSESSIONID</code>.
        </p>
        <div className="space-y-2 mb-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">li_at cookie</label>
            <input type="password" value={liAt} onChange={(e) => setLiAt(e.target.value)}
              placeholder="Paste li_at value..."
              className="input-field font-mono text-xs" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">JSESSIONID cookie</label>
            <input type="password" value={jsessionid} onChange={(e) => setJsessionid(e.target.value)}
              placeholder="Paste JSESSIONID value..."
              className="input-field font-mono text-xs" />
          </div>
        </div>
        <button onClick={handleSaveLinkedInSession}
          disabled={!liAt || !jsessionid || sessionStatus === 'saving'}
          className="btn-primary text-sm">
          {sessionStatus === 'saving' ? 'Saving…' : sessionStatus === 'ok' ? '✅ Session saved!' : sessionStatus === 'error' ? '❌ Failed — try again' : 'Save LinkedIn Session'}
        </button>
        <p className="text-xs text-gray-400 mt-2">Stored encrypted in Redis · Expires in 1 hour</p>
      </div>

      {/* Rate Limit */}
      <div className="card p-5">
        <h2 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-linkedin-500" />
          Search Rate Limit
        </h2>
        {rateLimit ? (
          <>
            <div className="flex justify-between text-sm mb-2">
              <span className="text-gray-600">Used this hour</span>
              <span className="font-semibold text-gray-900">{rateLimit.used} / {rateLimit.limit}</span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-2">
              <div
                className={`h-2 rounded-full transition-all ${
                  rateLimit.used >= rateLimit.limit ? 'bg-red-500' :
                  rateLimit.used >= rateLimit.limit * 0.8 ? 'bg-yellow-500' : 'bg-linkedin-500'
                }`}
                style={{ width: `${Math.min(100, (rateLimit.used / rateLimit.limit) * 100)}%` }}
              />
            </div>
            <p className="text-xs text-gray-400 mt-2">
              Resets in ~{resetMinutes} minutes · Max 30 searches/hour to comply with LinkedIn's bot-detection policy
            </p>
          </>
        ) : (
          <p className="text-sm text-gray-400">Loading…</p>
        )}
      </div>

      {/* GDPR */}
      <div className="card p-5">
        <h2 className="font-semibold text-gray-800 mb-1 flex items-center gap-2">
          <Shield className="w-4 h-4 text-linkedin-500" />
          Your Data & Privacy
        </h2>
        <p className="text-sm text-gray-500 mb-4">
          EU data residency · GDPR Art. 15, 17, 20 rights
        </p>
        <div className="space-y-2">
          <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
            <div>
              <p className="text-sm font-medium text-gray-800">Data Residency</p>
              <p className="text-xs text-gray-500">EU (Frankfurt region)</p>
            </div>
            <span className="badge bg-green-100 text-green-700">Active</span>
          </div>
          <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
            <div>
              <p className="text-sm font-medium text-gray-800">Candidate Data Storage</p>
              <p className="text-xs text-gray-500">Never stored — 10 min cache only</p>
            </div>
            <span className="badge bg-green-100 text-green-700">Compliant</span>
          </div>
          <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
            <div>
              <p className="text-sm font-medium text-gray-800">Search History Retention</p>
              <p className="text-xs text-gray-500">90 days, auto-purged</p>
            </div>
            <span className="badge bg-blue-100 text-blue-700">Configured</span>
          </div>
        </div>
        <div className="mt-4 flex flex-col sm:flex-row gap-2">
          <button onClick={handleExport} disabled={exporting} className="btn-secondary flex items-center gap-2 text-sm">
            <Download className="w-4 h-4" />
            {exporting ? 'Exporting…' : 'Export My Data (Art. 20)'}
          </button>
          <a href="/privacy" target="_blank" className="btn-secondary flex items-center gap-2 text-sm">
            <ExternalLink className="w-4 h-4" />
            Privacy Policy
          </a>
        </div>
      </div>

      {/* Danger zone */}
      <div className="card p-5 border-red-200">
        <h2 className="font-semibold text-red-700 mb-2">Delete Account</h2>
        <p className="text-sm text-gray-600 mb-4">
          Permanently delete your account, all saved searches, and search history.
          GDPR audit logs are retained for 365 days as required by law.
        </p>
        <button
          onClick={handleDeleteAccount}
          disabled={deleting}
          className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-700 text-sm font-medium rounded-lg border border-red-300 hover:bg-red-100 transition-colors disabled:opacity-50"
        >
          <Trash2 className="w-4 h-4" />
          {deleting ? 'Deleting…' : 'Delete My Account (GDPR Art. 17)'}
        </button>
      </div>
    </div>
  );
}
