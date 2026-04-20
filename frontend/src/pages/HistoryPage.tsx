import { useEffect, useState } from 'react';
import { Clock, Trash2, Play, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { historyApi } from '../api/client';
import { useSearchStore } from '../stores/searchStore';
import { format } from 'date-fns';

interface HistoryEntry {
  id: string;
  searchParams: Record<string, unknown>;
  resultCount?: number;
  executedAt: string;
  durationMs?: number;
  status: string;
  errorMessage?: string;
}

const STATUS_CONFIG: Record<string, { icon: typeof CheckCircle; color: string; label: string }> = {
  completed:    { icon: CheckCircle,    color: 'text-green-500',  label: 'Completed' },
  failed:       { icon: XCircle,        color: 'text-red-500',    label: 'Failed' },
  captcha:      { icon: AlertTriangle,  color: 'text-yellow-500', label: 'CAPTCHA' },
  rate_limited: { icon: AlertTriangle,  color: 'text-orange-500', label: 'Rate Limited' },
};

export default function HistoryPage() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { setParams } = useSearchStore();

  useEffect(() => {
    historyApi.list().then((r) => setEntries(r.data.data)).finally(() => setLoading(false));
  }, []);

  const handleDelete = async (id: string) => {
    await historyApi.delete(id);
    setEntries((prev) => prev.filter((e) => e.id !== id));
  };

  const handleClearAll = async () => {
    if (!confirm('Clear all search history?')) return;
    await historyApi.clearAll();
    setEntries([]);
  };

  const handleRerun = (entry: HistoryEntry) => {
    setParams(entry.searchParams as any);
    navigate('/search');
  };

  const getTitle = (params: Record<string, unknown>) => {
    const parts = [params.title, params.company, params.customString].filter(Boolean);
    return parts.slice(0, 2).join(' · ') || 'Unnamed search';
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Clock className="w-6 h-6 text-linkedin-500" />
          Search History
        </h1>
        {entries.length > 0 && (
          <button onClick={handleClearAll} className="btn-secondary text-sm text-red-600 border-red-200 hover:bg-red-50">
            Clear All
          </button>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => <div key={i} className="card h-16 animate-pulse bg-gray-100" />)}
        </div>
      ) : entries.length === 0 ? (
        <div className="card p-10 text-center">
          <Clock className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No search history yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => {
            const cfg = STATUS_CONFIG[entry.status] || STATUS_CONFIG.completed;
            const Icon = cfg.icon;
            return (
              <div key={entry.id} className="card p-3.5 flex items-center gap-3">
                <Icon className={`w-4 h-4 flex-shrink-0 ${cfg.color}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {getTitle(entry.searchParams)}
                  </p>
                  <div className="flex items-center gap-3 text-xs text-gray-400 mt-0.5">
                    <span>{format(new Date(entry.executedAt), 'MMM d, HH:mm')}</span>
                    {entry.resultCount !== undefined && <span>{entry.resultCount} results</span>}
                    {entry.durationMs && <span>{entry.durationMs}ms</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => handleRerun(entry)}
                    className="p-1.5 text-linkedin-500 hover:bg-linkedin-50 rounded-lg transition-colors"
                    title="Run again"
                  >
                    <Play className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(entry.id)}
                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="text-xs text-gray-400 mt-4 text-center">
        History auto-purged after 90 days (GDPR compliance)
      </p>
    </div>
  );
}
