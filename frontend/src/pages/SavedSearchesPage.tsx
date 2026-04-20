import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bookmark, Play, Trash2, Edit2, Calendar, Hash } from 'lucide-react';
import { savedSearchApi } from '../api/client';
import { useSearchStore } from '../stores/searchStore';
import { format } from 'date-fns';

interface SavedSearch {
  id: string;
  name: string;
  description?: string;
  searchParams: object;
  runCount: number;
  lastRunAt?: string;
  createdAt: string;
}

export default function SavedSearchesPage() {
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { setParams, setJobId, setStatus } = useSearchStore();

  useEffect(() => {
    savedSearchApi.list()
      .then((r) => setSearches(r.data.data))
      .finally(() => setLoading(false));
  }, []);

  const handleRun = async (search: SavedSearch) => {
    setParams(search.searchParams as any);
    navigate('/search');
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this saved search?')) return;
    await savedSearchApi.delete(id);
    setSearches((prev) => prev.filter((s) => s.id !== id));
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="card p-4 animate-pulse h-20 bg-gray-100" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Bookmark className="w-6 h-6 text-linkedin-500" />
          Saved Searches
        </h1>
        <button onClick={() => navigate('/search')} className="btn-primary">
          New Search
        </button>
      </div>

      {searches.length === 0 ? (
        <div className="card p-10 text-center">
          <Bookmark className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No saved searches yet</p>
          <p className="text-sm text-gray-400 mt-1">Build a search and click "Save Search"</p>
        </div>
      ) : (
        <div className="space-y-3">
          {searches.map((search) => (
            <div key={search.id} className="card p-4 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-900">{search.name}</h3>
                  {search.description && (
                    <p className="text-sm text-gray-500 mt-0.5">{search.description}</p>
                  )}
                  <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                    <span className="flex items-center gap-1">
                      <Hash className="w-3 h-3" />
                      {search.runCount} runs
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      Created {format(new Date(search.createdAt), 'MMM d, yyyy')}
                    </span>
                    {search.lastRunAt && (
                      <span>Last run {format(new Date(search.lastRunAt), 'MMM d')}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => handleRun(search)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-linkedin-500 text-white text-sm rounded-lg hover:bg-linkedin-600 transition-colors"
                  >
                    <Play className="w-3.5 h-3.5" />
                    Run
                  </button>
                  <button
                    onClick={() => handleDelete(search.id)}
                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
