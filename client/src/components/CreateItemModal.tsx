import React, { useState } from 'react';
import { X, Plus, AlertCircle, Clock, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { Category, Priority, Team, UserWithTeams } from '../types';
import { api } from '../api';

interface CreateItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  onItemCreated: () => void;
  teams: Team[];
  users: UserWithTeams[];
  currentUser: UserWithTeams | null;
}

export const CreateItemModal: React.FC<CreateItemModalProps> = ({
  isOpen,
  onClose,
  onItemCreated,
  teams,
  users,
  currentUser
}) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<Category>('ENGINEERING');
  const [priority, setPriority] = useState<Priority>('P1_HIGH');
  const [assignedTeamId, setAssignedTeamId] = useState(teams[0]?.id || 'team-eng');
  const [assignedUserId, setAssignedUserId] = useState<string>('');
  const [requiresApproval, setRequiresApproval] = useState(false);
  
  // Category specific metadata
  const [metaKey, setMetaKey] = useState('affected_service');
  const [metaVal, setMetaVal] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idempotencyInfo, setIdempotencyInfo] = useState<string | null>(null);

  if (!isOpen) return null;

  const getSlaNotice = (p: Priority) => {
    switch (p) {
      case 'P0_CRITICAL': return 'Target SLA: 1 Hour (Automatic escalation)';
      case 'P1_HIGH': return 'Target SLA: 4 Hours';
      case 'P2_MEDIUM': return 'Target SLA: 24 Hours';
      case 'P3_LOW': return 'Target SLA: 72 Hours';
    }
  };

  const handleSubmit = async (e: React.FormEvent, simulateDuplicate: boolean = false) => {
    if (e) e.preventDefault();
    setError(null);
    setIdempotencyInfo(null);

    if (title.trim().length < 3) {
      setError('Title must be at least 3 characters');
      return;
    }
    if (description.trim().length < 5) {
      setError('Description must be at least 5 characters');
      return;
    }

    try {
      setLoading(true);
      const metadata = metaVal ? { [metaKey]: metaVal } : {};

      const payload = {
        title: title.trim(),
        description: description.trim(),
        category,
        priority,
        assigned_team_id: assignedTeamId,
        assigned_user_id: assignedUserId || undefined,
        requires_approval: requiresApproval,
        metadata
      };

      if (simulateDuplicate) {
        // Test idempotency deduplication with explicit key
        const fixedKey = 'sim-test-' + Math.random().toString(36).substring(2, 9);
        const res1 = await api.createWorkItem(payload, fixedKey);
        // Second identical request with same key
        const res2 = await api.createWorkItem(payload, fixedKey);

        setIdempotencyInfo(
          `Idempotency Verified! Request was sent twice with key '${fixedKey}'. Second response returned cached item with X-Idempotent-Replay: true.`
        );
        setTimeout(() => {
          onItemCreated();
          onClose();
        }, 3000);
        return;
      }

      await api.createWorkItem(payload);
      onItemCreated();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to create work item');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-2xl max-w-2xl w-full p-6 text-slate-100 flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-500/10 border border-indigo-500/30 rounded-lg text-indigo-400">
              <Plus className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-100">Create Operational Request</h2>
              <p className="text-xs text-slate-400">
                Log a new incident, customer escalation, compliance check, or engineering action.
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

        {error && (
          <div className="mt-4 p-3 bg-red-950/50 border border-red-500/50 rounded-lg text-xs text-red-200 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {idempotencyInfo && (
          <div className="mt-4 p-3 bg-emerald-950/50 border border-emerald-500/50 rounded-lg text-xs text-emerald-200 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{idempotencyInfo}</span>
          </div>
        )}

        <form onSubmit={(e) => handleSubmit(e, false)} className="mt-4 space-y-4 overflow-y-auto pr-1">
          
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Title <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Stripe Webhook 502 Failures during flash sale"
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Category</label>
              <select
                value={category}
                onChange={(e) => {
                  const cat = e.target.value as Category;
                  setCategory(cat);
                  if (cat === 'PAYMENTS') setMetaKey('transaction_id');
                  else if (cat === 'INCIDENT') setMetaKey('affected_service');
                  else if (cat === 'COMPLIANCE') setMetaKey('regulatory_scope');
                  else setMetaKey('system_tag');
                }}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                <option value="ENGINEERING">Engineering</option>
                <option value="PAYMENTS">Payment Operations</option>
                <option value="INCIDENT">Incident / SecOps</option>
                <option value="COMPLIANCE">Compliance / Risk</option>
                <option value="CUSTOMER_OPS">Customer Escalations</option>
                <option value="GENERAL">General Operational</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Priority / Urgency</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as Priority)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                <option value="P0_CRITICAL">P0 - Critical Outage (1h SLA)</option>
                <option value="P1_HIGH">P1 - High Priority (4h SLA)</option>
                <option value="P2_MEDIUM">P2 - Medium Priority (24h SLA)</option>
                <option value="P3_LOW">P3 - Low Priority (72h SLA)</option>
              </select>
              <div className="text-[11px] text-amber-400/90 mt-1 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {getSlaNotice(priority)}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Assigned Team</label>
              <select
                value={assignedTeamId}
                onChange={(e) => setAssignedTeamId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                {teams.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Assign User (Optional)</label>
              <select
                value={assignedUserId}
                onChange={(e) => setAssignedUserId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                <option value="">Leave Unassigned (Open Queue)</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Description & Context <span className="text-red-400">*</span>
            </label>
            <textarea
              required
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Explain the background, symptoms, customer impact, or approval requirements..."
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Operational Metadata */}
          <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800 space-y-2">
            <div className="text-[11px] font-semibold text-slate-300">Category Specific Metadata</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <input
                  type="text"
                  value={metaKey}
                  onChange={(e) => setMetaKey(e.target.value)}
                  placeholder="Key (e.g. affected_service)"
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-200 font-mono"
                />
              </div>
              <div>
                <input
                  type="text"
                  value={metaVal}
                  onChange={(e) => setMetaVal(e.target.value)}
                  placeholder="Value (e.g. redis-cluster-1)"
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-200"
                />
              </div>
            </div>
          </div>

          {/* Dual-Signoff Checkbox */}
          <div className="flex items-center gap-3 p-3 bg-indigo-950/20 border border-indigo-500/30 rounded-lg">
            <input
              type="checkbox"
              id="requiresApproval"
              checked={requiresApproval}
              onChange={(e) => setRequiresApproval(e.target.checked)}
              className="w-4 h-4 rounded text-indigo-600 bg-slate-900 border-slate-700 focus:ring-indigo-500"
            />
            <label htmlFor="requiresApproval" className="text-xs text-slate-200 select-none cursor-pointer">
              <span className="font-semibold text-indigo-300">Enforce Dual-Signoff Approval Gate</span>
              <p className="text-[11px] text-slate-400">
                Item cannot be resolved without explicit signoff by a Team Lead or Approver (segregation of duties applies).
              </p>
            </label>
          </div>

          {/* Form Actions */}
          <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
            <button
              type="button"
              onClick={(e) => handleSubmit(e, true)}
              disabled={loading}
              className="px-3 py-1.5 text-xs font-mono text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded-lg transition"
              title="Sends duplicate requests with same Idempotency-Key to demonstrate backend deduplication"
            >
              Simulate Double-Click (Test Idempotency)
            </button>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-lg transition"
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg shadow-lg shadow-indigo-600/30 transition disabled:opacity-50"
              >
                {loading ? 'Creating...' : 'Create Work Item'}
              </button>
            </div>
          </div>

        </form>

      </div>
    </div>
  );
};
