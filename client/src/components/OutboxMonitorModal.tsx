import React, { useState, useEffect } from 'react';
import { X, RefreshCw, AlertCircle, CheckCircle2, Clock, Zap, ArrowRight, RotateCcw } from 'lucide-react';
import { OutboxJob, OutboxStats } from '../types';
import { api } from '../api';

interface OutboxMonitorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const OutboxMonitorModal: React.FC<OutboxMonitorModalProps> = ({ isOpen, onClose }) => {
  const [jobs, setJobs] = useState<OutboxJob[]>([]);
  const [stats, setStats] = useState<OutboxStats | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const fetchJobs = async () => {
    try {
      setLoading(true);
      const res = await api.getOutboxJobs(filterStatus);
      setJobs(res.jobs);
      setStats(res.stats);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchJobs();
      const interval = setInterval(fetchJobs, 3000);
      return () => clearInterval(interval);
    }
  }, [isOpen, filterStatus]);

  const handleRetry = async (jobId: string) => {
    try {
      await api.retryOutboxJob(jobId);
      setActionMessage(`Job ${jobId} reset to PENDING for immediate processing.`);
      setTimeout(() => setActionMessage(null), 4000);
      fetchJobs();
    } catch (err: any) {
      alert(err.message || 'Retry failed');
    }
  };

  const handleTriggerSla = async () => {
    try {
      const res = await api.triggerSlaCheck();
      setActionMessage(`SLA evaluation executed. ${res.breached_detected} newly breached items detected.`);
      setTimeout(() => setActionMessage(null), 4000);
    } catch (err: any) {
      alert(err.message || 'SLA check failed');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-2xl max-w-4xl w-full p-6 text-slate-100 flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-500/10 border border-indigo-500/30 rounded-lg text-indigo-400">
              <Zap className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                Transactional Outbox & Worker Health
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  Worker Active (3s loop)
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Guarantees at-least-once async execution for notifications, SLA evaluations, and audit enrichment.
              </p>
            </div>
          </div>
          
          <button 
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-md transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Stats Bar */}
        {stats && (
          <div className="grid grid-cols-5 gap-3 my-4">
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
              <div className="text-[11px] text-slate-400 font-medium">Total Jobs</div>
              <div className="text-xl font-bold font-mono text-slate-100">{stats.total || 0}</div>
            </div>
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
              <div className="text-[11px] text-amber-400 font-medium">Pending</div>
              <div className="text-xl font-bold font-mono text-amber-300">{stats.pending || 0}</div>
            </div>
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
              <div className="text-[11px] text-emerald-400 font-medium">Completed</div>
              <div className="text-xl font-bold font-mono text-emerald-400">{stats.completed || 0}</div>
            </div>
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
              <div className="text-[11px] text-orange-400 font-medium">Retrying / Failed</div>
              <div className="text-xl font-bold font-mono text-orange-400">{stats.failed || 0}</div>
            </div>
            <div className="bg-slate-950 p-3 rounded-lg border border-red-500/30 bg-red-950/10">
              <div className="text-[11px] text-red-400 font-medium">Dead Letter (DLQ)</div>
              <div className="text-xl font-bold font-mono text-red-400">{stats.dead_letter || 0}</div>
            </div>
          </div>
        )}

        {actionMessage && (
          <div className="mb-3 px-3 py-2 bg-indigo-950/60 border border-indigo-500/40 rounded-lg text-xs text-indigo-200 flex items-center justify-between">
            <span>{actionMessage}</span>
            <button onClick={() => setActionMessage(null)} className="text-indigo-400 hover:text-white">✕</button>
          </div>
        )}

        {/* Action Controls */}
        <div className="flex items-center justify-between gap-3 mb-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-slate-400">Filter status:</span>
            {['', 'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'DEAD_LETTER'].map(s => (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                className={`px-2.5 py-1 rounded text-[11px] font-medium transition ${
                  filterStatus === s 
                    ? 'bg-indigo-600 text-white' 
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {s || 'ALL'}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleTriggerSla}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700 transition"
              title="Runs periodic SLA breach check immediately"
            >
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              Run SLA Check Now
            </button>

            <button
              onClick={fetchJobs}
              disabled={loading}
              className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700 transition"
              title="Refresh Queue"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Job Queue Table */}
        <div className="flex-1 overflow-auto border border-slate-800 rounded-lg bg-slate-950/50">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-900/90 text-slate-400 sticky top-0 border-b border-slate-800 text-[11px] uppercase tracking-wider">
              <tr>
                <th className="p-3">Job ID / Type</th>
                <th className="p-3">Status</th>
                <th className="p-3">Attempts</th>
                <th className="p-3">Next Retry / Timing</th>
                <th className="p-3">Error / Diagnostics</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {jobs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-500 font-sans">
                    No jobs found for this filter.
                  </td>
                </tr>
              ) : (
                jobs.map(job => (
                  <tr key={job.id} className="hover:bg-slate-900/50 transition">
                    <td className="p-3">
                      <div className="font-semibold text-slate-200">{job.id}</div>
                      <div className="text-[10px] text-slate-400 font-sans mt-0.5">{job.event_type}</div>
                    </td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                        job.status === 'COMPLETED' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                        job.status === 'DEAD_LETTER' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
                        job.status === 'FAILED' ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30' :
                        job.status === 'PROCESSING' ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 animate-pulse' :
                        'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                      }`}>
                        {job.status}
                      </span>
                    </td>
                    <td className="p-3">
                      {job.attempts} / {job.max_attempts}
                    </td>
                    <td className="p-3 text-[11px] text-slate-400 font-sans">
                      {job.status === 'FAILED' ? (
                        <span>Retry at {new Date(job.next_retry_at).toLocaleTimeString()}</span>
                      ) : (
                        <span>Updated {new Date(job.updated_at).toLocaleTimeString()}</span>
                      )}
                    </td>
                    <td className="p-3 max-w-xs truncate text-[11px] text-slate-400 font-sans" title={job.last_error || ''}>
                      {job.last_error ? (
                        <span className="text-red-400">{job.last_error}</span>
                      ) : (
                        <span className="text-slate-600">None</span>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      {(job.status === 'FAILED' || job.status === 'DEAD_LETTER') && (
                        <button
                          onClick={() => handleRetry(job.id)}
                          className="flex items-center gap-1 ml-auto px-2 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-[10px] font-sans font-medium transition"
                        >
                          <RotateCcw className="w-3 h-3" />
                          Retry
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

      </div>
    </div>
  );
};
