import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ChevronDown, ChevronUp, Zap, AlertCircle, Info } from 'lucide-react';
import { useSearchStore } from '../stores/searchStore';
import { searchApi, savedSearchApi } from '../api/client';

const INDUSTRIES = [
  'Information Technology', 'Financial Services', 'Healthcare', 'Education',
  'Manufacturing', 'Retail', 'Consulting', 'Media', 'Real Estate', 'Telecommunications',
];

const YEARS_OF_EXP = [
  { value: '1', label: '1-2 years' },
  { value: '2', label: '3-5 years' },
  { value: '3', label: '6-10 years' },
  { value: '4', label: '10+ years' },
];

const COMPANY_SIZES = [
  { value: 'A', label: 'Self-employed' },
  { value: 'B', label: '1-10' },
  { value: 'C', label: '11-50' },
  { value: 'D', label: '51-200' },
  { value: 'E', label: '201-500' },
  { value: 'F', label: '501-1000' },
  { value: 'G', label: '1001-5000' },
  { value: 'H', label: '5001-10000' },
  { value: 'I', label: '10001+' },
];

export default function SearchPage() {
  const navigate = useNavigate();
  const { params, status, error, setParams, setStatus, setJobId, setError, setResults } = useSearchStore();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [templates, setTemplates] = useState<Array<{ id: string; name: string; string: string }>>([]);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [queryPreview, setQueryPreview] = useState('');

  useEffect(() => {
    savedSearchApi.templates().then((r) => setTemplates(r.data.templates)).catch(() => {});
  }, []);

  // Build query preview
  useEffect(() => {
    const parts: string[] = [];
    if (params.title) parts.push(`title:"${params.title}"`);
    if (params.company) parts.push(`company:"${params.company}"`);
    if (params.location) parts.push(`location:"${params.location}"`);
    if (params.customString) parts.push(`(${params.customString})`);
    setQueryPreview(parts.join(' AND ') || 'Build your search above…');
  }, [params]);

  const handleSearch = async () => {
    if (!params.title && !params.keywords && !params.customString && !params.company) {
      setError('Please fill in at least one search field.');
      return;
    }
    setError(null);
    setResults(null);
    setStatus('submitting');
    try {
      const res = await searchApi.execute(params);
      setJobId(res.data.jobId);
      setStatus('polling');
      navigate('/results');
    } catch (err: any) {
      setStatus('error');
      const code = err.response?.data?.error?.code;
      if (code === 'RATE_LIMIT_EXCEEDED') {
        setError('Rate limit reached. Max 30 searches per hour.');
      } else {
        setError(err.response?.data?.error?.message || 'Search failed. Please try again.');
      }
    }
  };

  const handleSave = async () => {
    if (!saveName) return;
    await savedSearchApi.create({ name: saveName, searchParams: params });
    setSaveDialogOpen(false);
    setSaveName('');
  };

  const applyTemplate = (template: { id: string; name: string; string: string }) => {
    setParams({ customString: template.string, templateId: template.id });
  };

  const toggleDegree = (deg: 'F' | 'S' | 'O') => {
    const current = params.connectionDegree || [];
    const next = current.includes(deg) ? current.filter((d) => d !== deg) : [...current, deg];
    setParams({ connectionDegree: next as Array<'F' | 'S' | 'O'> });
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Build Your Search</h1>
        <div className="flex items-center gap-1 text-xs bg-yellow-50 text-yellow-700 px-3 py-1.5 rounded-full border border-yellow-200">
          <Zap className="w-3.5 h-3.5" />
          LinkedIn Premium
        </div>
      </div>

      <div className="grid md:grid-cols-5 gap-6">
        {/* ── Filters Panel ── */}
        <div className="md:col-span-3 space-y-4">
          <div className="card p-5">
            <h2 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
              <Search className="w-4 h-4 text-linkedin-500" />
              LinkedIn Filters
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Job Title</label>
                <input
                  type="text"
                  placeholder="e.g. Data Scientist"
                  value={params.title || ''}
                  onChange={(e) => setParams({ title: e.target.value })}
                  className="input-field"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Company</label>
                <input
                  type="text"
                  placeholder="e.g. Eaton"
                  value={params.company || ''}
                  onChange={(e) => setParams({ company: e.target.value })}
                  className="input-field"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Location</label>
                <input
                  type="text"
                  placeholder="e.g. Mumbai"
                  value={params.location || ''}
                  onChange={(e) => setParams({ location: e.target.value })}
                  className="input-field"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Industry</label>
                <select
                  value={params.industry || ''}
                  onChange={(e) => setParams({ industry: e.target.value })}
                  className="input-field"
                >
                  <option value="">Any industry</option>
                  {INDUSTRIES.map((ind) => (
                    <option key={ind} value={ind}>{ind}</option>
                  ))}
                </select>
              </div>

              {/* Connection Degree */}
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-2">Connection Degree</label>
                <div className="flex gap-2">
                  {(['F', 'S', 'O'] as const).map((deg) => (
                    <button
                      key={deg}
                      type="button"
                      onClick={() => toggleDegree(deg)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                        params.connectionDegree?.includes(deg)
                          ? 'bg-linkedin-500 text-white border-linkedin-500'
                          : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      {deg === 'F' ? '1st' : deg === 'S' ? '2nd' : '3rd+'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Premium filters */}
            <button
              onClick={() => setShowAdvanced((v) => !v)}
              className="mt-4 flex items-center gap-1 text-sm text-linkedin-500 font-medium"
            >
              {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              LinkedIn Premium filters
            </button>

            {showAdvanced && (
              <div className="mt-4 grid grid-cols-2 gap-3 border-t pt-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Years of Experience</label>
                  <select
                    value={params.yearsOfExperience || ''}
                    onChange={(e) => setParams({ yearsOfExperience: e.target.value })}
                    className="input-field"
                  >
                    <option value="">Any</option>
                    {YEARS_OF_EXP.map((y) => (
                      <option key={y.value} value={y.value}>{y.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Company Size</label>
                  <select
                    value={params.companySize || ''}
                    onChange={(e) => setParams({ companySize: e.target.value })}
                    className="input-field"
                  >
                    <option value="">Any size</option>
                    {COMPANY_SIZES.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">School / University</label>
                  <input
                    type="text"
                    placeholder="e.g. IIT Bombay"
                    value={params.school || ''}
                    onChange={(e) => setParams({ school: e.target.value })}
                    className="input-field"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Boolean String Builder ── */}
        <div className="md:col-span-2 space-y-4">
          <div className="card p-5">
            <h2 className="font-semibold text-gray-800 mb-3">Custom Boolean String</h2>
            <div className="grid grid-cols-2 gap-2 mb-3">
              {templates.slice(0, 6).map((t) => (
                <button
                  key={t.id}
                  onClick={() => applyTemplate(t)}
                  className={`text-xs px-2.5 py-1.5 rounded-lg border text-left transition-colors ${
                    params.templateId === t.id
                      ? 'bg-linkedin-50 border-linkedin-300 text-linkedin-600'
                      : 'border-gray-200 hover:border-gray-300 text-gray-600'
                  }`}
                >
                  {t.name}
                </button>
              ))}
            </div>
            <textarea
              value={params.customString || ''}
              onChange={(e) => setParams({ customString: e.target.value, templateId: undefined })}
              placeholder={`#OpenToWork OR "Immediate Joiner"\nAND "Notice period: 0"`}
              className="input-field h-28 font-mono text-sm resize-none"
              aria-label="Custom Boolean search string"
            />
            <p className="text-xs text-gray-400 mt-1.5 flex items-center gap-1">
              <Info className="w-3 h-3" />
              Supports AND, OR, NOT, quotes, and parentheses
            </p>
          </div>

          {/* Query preview */}
          <div className="card p-4 bg-gray-50">
            <p className="text-xs font-medium text-gray-500 mb-1">Query preview</p>
            <p className="text-sm text-gray-800 font-mono break-words">{queryPreview}</p>
          </div>

          {/* Error */}
          {error && (
            <div className="flex gap-2 items-start p-3 bg-red-50 border border-red-200 rounded-lg">
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {/* Actions */}
          <button
            onClick={handleSearch}
            disabled={status === 'submitting' || status === 'polling'}
            className="btn-primary w-full py-3 text-base"
          >
            {status === 'submitting' || status === 'polling'
              ? <><span className="animate-spin mr-2">⟳</span> Searching…</>
              : <><Search className="w-5 h-5" /> Search LinkedIn</>}
          </button>
          <button
            onClick={() => setSaveDialogOpen(true)}
            className="btn-secondary w-full"
          >
            Save Search
          </button>
        </div>
      </div>

      {/* Save dialog */}
      {saveDialogOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="card p-6 w-full max-w-sm">
            <h3 className="font-semibold text-gray-900 mb-3">Save Search</h3>
            <input
              type="text"
              placeholder="Search name…"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              className="input-field mb-3"
            />
            <div className="flex gap-2">
              <button onClick={handleSave} className="btn-primary flex-1">Save</button>
              <button onClick={() => setSaveDialogOpen(false)} className="btn-secondary flex-1">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
