import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, ArrowLeft, User, Building2, MapPin, RefreshCw, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useSearchStore, CandidateCard } from '../stores/searchStore';
import { searchApi } from '../api/client';

function CandidateCardItem({ candidate }: { candidate: CandidateCard }) {
  return (
    <div className="card p-4 hover:shadow-md transition-shadow">
      <div className="flex gap-3">
        {candidate.profilePicUrl ? (
          <img
            src={candidate.profilePicUrl}
            alt={candidate.name}
            className="w-12 h-12 rounded-full border border-gray-200 object-cover flex-shrink-0"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        ) : (
          <div className="w-12 h-12 rounded-full bg-linkedin-50 flex items-center justify-center flex-shrink-0">
            <User className="w-6 h-6 text-linkedin-500" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-gray-900 text-sm">{candidate.name}</span>
                <span className="badge bg-gray-100 text-gray-600 text-xs">
                  {candidate.connectionDegree}
                </span>
                {candidate.isOpenToWork && (
                  <span className="badge bg-green-100 text-green-700 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    Open to Work
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-600 mt-0.5">{candidate.title}</p>
            </div>
            <a
              href={candidate.profileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-shrink-0 p-1.5 text-linkedin-500 hover:bg-linkedin-50 rounded-lg transition-colors"
              title="View profile"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>
          {candidate.company && (
            <div className="flex items-center gap-1 mt-1.5 text-xs text-gray-500">
              <Building2 className="w-3.5 h-3.5" />
              {candidate.company}
            </div>
          )}
          {candidate.location && (
            <div className="flex items-center gap-1 mt-0.5 text-xs text-gray-500">
              <MapPin className="w-3.5 h-3.5" />
              {candidate.location}
            </div>
          )}
          {candidate.headline && (
            <p className="mt-2 text-xs text-gray-600 line-clamp-2">{candidate.headline}</p>
          )}
          {candidate.mutualConnections ? (
            <p className="mt-1 text-xs text-gray-400">{candidate.mutualConnections} mutual connections</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function ResultsPage() {
  const navigate = useNavigate();
  const { jobId, results, status, setResults, setStatus, setError } = useSearchStore();
  const [polling, setPolling] = useState(true);
  const [jobStatus, setJobStatus] = useState<string>('pending');

  useEffect(() => {
    if (!jobId) { navigate('/search'); return; }
    if (results) { setPolling(false); return; }

    let interval: ReturnType<typeof setInterval>;
    const poll = async () => {
      try {
        const res = await searchApi.status(jobId);
        const job = res.data;
        setJobStatus(job.status);

        if (job.status === 'completed') {
          clearInterval(interval);
          const resultsRes = await searchApi.results(jobId);
          setResults(resultsRes.data);
          setStatus('completed');
          setPolling(false);
        } else if (['failed', 'captcha', 'rate_limited'].includes(job.status)) {
          clearInterval(interval);
          setStatus('error');
          setPolling(false);
          const msgs: Record<string, string> = {
            captcha: 'LinkedIn requires verification. Please log into LinkedIn directly, then retry.',
            rate_limited: 'Rate limit exceeded. Please wait before searching again.',
            failed: 'Search failed. Please try again.',
          };
          setError(msgs[job.status] || 'Search failed.');
        }
      } catch {
        clearInterval(interval);
        setPolling(false);
        setStatus('error');
        setError('Connection error. Please try again.');
      }
    };

    poll();
    interval = setInterval(poll, 1000);
    return () => clearInterval(interval);
  }, [jobId]);

  if (polling) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-12 text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-linkedin-500 mx-auto mb-4" />
        <p className="text-gray-600 font-medium">Searching LinkedIn…</p>
        <p className="text-sm text-gray-400 mt-1 capitalize">{jobStatus}</p>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="max-w-5xl mx-auto px-4 py-12">
        <div className="card p-8 text-center">
          <AlertTriangle className="w-12 h-12 text-yellow-500 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Search Error</h2>
          <p className="text-gray-600 mb-6">{useSearchStore.getState().error}</p>
          <button onClick={() => navigate('/search')} className="btn-primary">
            Back to Search
          </button>
        </div>
      </div>
    );
  }

  if (!results) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-12 text-center">
        <p className="text-gray-500">No results found.</p>
        <button onClick={() => navigate('/search')} className="btn-secondary mt-4">
          Back to Search
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <button
            onClick={() => navigate('/search')}
            className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Search
          </button>
          <h1 className="text-xl font-bold text-gray-900">
            {results.total} result{results.total !== 1 ? 's' : ''} found
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {results.cached ? 'From cache · ' : ''}
            {results.durationMs ? `${results.durationMs}ms` : ''}
          </p>
        </div>
        <button onClick={() => navigate('/search')} className="btn-secondary flex items-center gap-2">
          <RefreshCw className="w-4 h-4" />
          New Search
        </button>
      </div>

      {/* Results grid */}
      {results.results.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-gray-500">No candidates found for your search criteria.</p>
          <p className="text-sm text-gray-400 mt-2">Try broadening your filters or modifying the Boolean string.</p>
          <button onClick={() => navigate('/search')} className="btn-secondary mt-4">
            Adjust Search
          </button>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {results.results.map((candidate, i) => (
            <CandidateCardItem key={`${candidate.profileUrl}-${i}`} candidate={candidate} />
          ))}
        </div>
      )}
    </div>
  );
}
