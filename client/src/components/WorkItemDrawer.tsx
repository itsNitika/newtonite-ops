import React, { useState, useEffect } from 'react';
import { 
  X, 
  CheckCircle, 
  Clock, 
  User, 
  Users, 
  ShieldCheck, 
  ShieldAlert, 
  MessageSquare, 
  History, 
  AlertTriangle, 
  ArrowRight, 
  Send,
  Eye,
  Check,
  Ban,
  FileText
} from 'lucide-react';
import { WorkItem, AuditEvent, Comment, UserWithTeams, WorkItemStatus } from '../types';
import { api, ApiError } from '../api';

interface WorkItemDrawerProps {
  itemId: string | null;
  onClose: () => void;
  currentUser: UserWithTeams | null;
  onWorkItemUpdated: () => void;
  onConflict: (errData: any, attemptedAction: string) => void;
}

export const WorkItemDrawer: React.FC<WorkItemDrawerProps> = ({
  itemId,
  onClose,
  currentUser,
  onWorkItemUpdated,
  onConflict
}) => {
  const [data, setData] = useState<{
    item: WorkItem;
    auditEvents: AuditEvent[];
    comments: Comment[];
    presence: { userId: string; userName: string }[];
  } | null>(null);

  const [activeTab, setActiveTab] = useState<'details' | 'audit' | 'comments'>('details');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resolution form state
  const [showResolveForm, setShowResolveForm] = useState(false);
  const [resolutionSummary, setResolutionSummary] = useState('');
  const [rootCauseCategory, setRootCauseCategory] = useState('CODE_DEFECT');

  // Approval note state
  const [approvalNote, setApprovalNote] = useState('');

  // Comment input state
  const [newComment, setNewComment] = useState('');
  const [isInternalComment, setIsInternalComment] = useState(false);
  const [submittingComment, setSubmittingComment] = useState(false);

  const fetchItem = async (showSpinner: boolean = true) => {
    if (!itemId) return;
    try {
      if (showSpinner) setLoading(true);
      const res = await api.getWorkItemById(itemId);
      setData(res);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load work item');
    } finally {
      if (showSpinner) setLoading(false);
    }
  };

  // Heartbeat presence registration while drawer is open
  useEffect(() => {
    if (itemId) {
      fetchItem();
      // Send initial presence
      api.sendPresence(itemId);

      const presenceInterval = setInterval(() => {
        api.sendPresence(itemId);
        // Soft refresh without spinner
        fetchItem(false);
      }, 5000);

      return () => clearInterval(presenceInterval);
    }
  }, [itemId]);

  if (!itemId || !data) return null;

  const item = data.item;

  // Claim handler with OCC
  const handleClaim = async () => {
    try {
      setError(null);
      await api.claimWorkItem(item.id, item.version);
      onWorkItemUpdated();
      fetchItem(false);
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 409) {
        onConflict(err.data, 'Claim Responsibility');
      } else {
        setError(err.message || 'Failed to claim');
      }
    }
  };

  // Transition handler with OCC
  const handleTransition = async (targetStatus: WorkItemStatus) => {
    if (targetStatus === 'RESOLVED' && !showResolveForm) {
      setShowResolveForm(true);
      return;
    }

    try {
      setError(null);
      await api.transitionStatus(item.id, targetStatus, item.version, {
        resolution_summary: resolutionSummary || undefined,
        root_cause_category: rootCauseCategory || undefined
      });
      setShowResolveForm(false);
      onWorkItemUpdated();
      fetchItem(false);
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 409) {
        onConflict(err.data, `Transition to ${targetStatus}`);
      } else {
        setError(err.message || 'Failed to transition status');
      }
    }
  };

  // Approval handler with OCC
  const handleApprove = async (decision: 'APPROVED' | 'REJECTED') => {
    try {
      setError(null);
      await api.approveWorkItem(item.id, decision, approvalNote, item.version);
      setApprovalNote('');
      onWorkItemUpdated();
      fetchItem(false);
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 409) {
        onConflict(err.data, `Approval Decision: ${decision}`);
      } else {
        setError(err.message || 'Approval action failed');
      }
    }
  };

  // Comment submit
  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim()) return;

    try {
      setSubmittingComment(true);
      await api.addComment(item.id, newComment, isInternalComment);
      setNewComment('');
      fetchItem(false);
    } catch (err: any) {
      alert(err.message || 'Failed to add comment');
    } finally {
      setSubmittingComment(false);
    }
  };

  // Check segregation of duties
  const isCreatorOrOwner = currentUser?.id === item.created_by_user_id || currentUser?.id === item.assigned_user_id;
  const isApproverForTeam = currentUser?.is_admin || currentUser?.teams.some(
    t => t.team_id === item.assigned_team_id && (t.role === 'APPROVER' || t.role === 'LEAD')
  );

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-slate-900 border-l border-slate-800 w-full max-w-2xl h-full shadow-2xl flex flex-col text-slate-100">
        
        {/* Top Header */}
        <div className="p-5 border-b border-slate-800 bg-slate-950/80">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-bold text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">
                {item.tracking_num}
              </span>
              <span className="font-mono text-[11px] text-slate-400 bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
                v{item.version}
              </span>
              <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                item.priority === 'P0_CRITICAL' ? 'bg-red-500/20 text-red-400 border border-red-500/30 animate-pulse' :
                item.priority === 'P1_HIGH' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
                item.priority === 'P2_MEDIUM' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' :
                'bg-slate-700 text-slate-300'
              }`}>
                {item.priority.replace('_', ' ')}
              </span>
              <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-slate-800 text-slate-300 border border-slate-700">
                {item.category}
              </span>
            </div>

            <button 
              onClick={onClose}
              className="text-slate-400 hover:text-white p-1 rounded-md transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <h1 className="text-lg font-bold text-slate-100 mt-2 leading-snug">
            {item.title}
          </h1>

          {/* Active Viewers & Presence Banner */}
          {data.presence && data.presence.length > 0 && (
            <div className="mt-3 flex items-center gap-2 py-1.5 px-2.5 rounded-lg bg-indigo-950/30 border border-indigo-500/20 text-xs text-indigo-300">
              <Eye className="w-4 h-4 text-indigo-400 shrink-0" />
              <span className="truncate">
                Active Viewers: {data.presence.map(p => p.userName).join(', ')}
              </span>
            </div>
          )}

          {/* SLA Warning Banner */}
          {item.sla_breached && (
            <div className="mt-2 flex items-center gap-2 py-1 px-2.5 rounded-lg bg-red-950/40 border border-red-500/30 text-xs text-red-300">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
              <span>SLA Breached: Resolution overdue according to priority commitments.</span>
            </div>
          )}
        </div>

        {/* Action Toolbar */}
        <div className="p-4 bg-slate-900 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
          
          {/* Claim Button */}
          <div className="flex items-center gap-2">
            {item.assigned_user_id !== currentUser?.id ? (
              <button
                onClick={handleClaim}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg shadow-sm transition"
              >
                <User className="w-3.5 h-3.5" />
                Claim Responsibility
              </button>
            ) : (
              <span className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-semibold rounded-lg">
                <Check className="w-3.5 h-3.5" />
                Assigned to You
              </span>
            )}

            <span className="text-xs text-slate-400">
              Assigned to: <strong className="text-slate-200">{item.assigned_user_name || 'Unassigned Queue'}</strong>
            </span>
          </div>

          {/* Status Transitions */}
          <div className="flex items-center gap-2">
            {item.status === 'TRIAGE' && (
              <button
                onClick={() => handleTransition('READY')}
                className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg border border-slate-700 transition"
              >
                Mark Ready
              </button>
            )}

            {(item.status === 'READY' || item.status === 'TRIAGE') && (
              <button
                onClick={() => handleTransition('IN_PROGRESS')}
                className="px-2.5 py-1.5 bg-indigo-600/80 hover:bg-indigo-600 text-white text-xs font-medium rounded-lg transition"
              >
                Start Working
              </button>
            )}

            {item.status === 'IN_PROGRESS' && item.requires_approval && (
              <button
                onClick={() => handleTransition('PENDING_APPROVAL')}
                className="px-2.5 py-1.5 bg-purple-600 hover:bg-purple-500 text-white text-xs font-medium rounded-lg transition"
              >
                Request Dual-Signoff
              </button>
            )}

            {item.status === 'IN_PROGRESS' && !item.requires_approval && (
              <button
                onClick={() => setShowResolveForm(true)}
                className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg transition"
              >
                Resolve Work Item
              </button>
            )}

            {item.status === 'PENDING_APPROVAL' && item.approval_status === 'APPROVED' && (
              <button
                onClick={() => setShowResolveForm(true)}
                className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg transition"
              >
                Complete & Resolve
              </button>
            )}
          </div>

        </div>

        {error && (
          <div className="mx-5 mt-3 p-3 bg-red-950/60 border border-red-500/40 rounded-lg text-xs text-red-200 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Dual-Signoff Approval Gate Panel */}
        {item.requires_approval && (
          <div className="m-4 p-4 rounded-xl bg-purple-950/20 border border-purple-500/30">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-xs font-bold text-purple-300">
                <ShieldCheck className="w-4 h-4 text-purple-400" />
                Dual-Signoff Approval Gate
              </div>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                item.approval_status === 'APPROVED' ? 'bg-emerald-500/20 text-emerald-400' :
                item.approval_status === 'REJECTED' ? 'bg-red-500/20 text-red-400' :
                'bg-amber-500/20 text-amber-300'
              }`}>
                STATUS: {item.approval_status}
              </span>
            </div>

            {item.approval_status === 'PENDING' && (
              <div className="space-y-3 mt-3">
                {isCreatorOrOwner && !currentUser?.is_admin ? (
                  <div className="p-2.5 rounded bg-amber-950/30 border border-amber-500/30 text-xs text-amber-300">
                    <strong>Segregation of Duties Enforced:</strong> As the creator or assigned owner of this request, you cannot approve your own signoff. A separate Team Lead or Approver must review it.
                  </div>
                ) : isApproverForTeam ? (
                  <div className="space-y-2">
                    <p className="text-xs text-slate-300">
                      You hold approval authority for {item.assigned_team_name}. Review and supply signoff:
                    </p>
                    <input
                      type="text"
                      value={approvalNote}
                      onChange={(e) => setApprovalNote(e.target.value)}
                      placeholder="Signoff audit note (e.g., Verified beneficiary OFAC checks)"
                      className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-purple-500"
                    />
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        onClick={() => handleApprove('APPROVED')}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-semibold shadow transition"
                      >
                        Approve Request
                      </button>
                      <button
                        onClick={() => handleApprove('REJECTED')}
                        className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded text-xs font-semibold transition"
                      >
                        Reject Request
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-slate-400">
                    Awaiting review from an authorized Team Lead or Approver.
                  </div>
                )}
              </div>
            )}

            {item.approval_status === 'APPROVED' && (
              <div className="text-xs text-emerald-300 mt-1">
                Approved by <strong>{item.approved_by_user_name || 'Authorized Lead'}</strong>: "{item.approval_note || 'Signoff granted'}"
              </div>
            )}
          </div>
        )}

        {/* Resolution Completion Modal / Section */}
        {showResolveForm && (
          <div className="m-4 p-4 rounded-xl bg-emerald-950/20 border border-emerald-500/30 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-emerald-300 flex items-center gap-2">
                <CheckCircle className="w-4 h-4" />
                Complete Resolution (Required for Audit Trail)
              </h3>
              <button onClick={() => setShowResolveForm(false)} className="text-slate-400 hover:text-white text-xs">Cancel</button>
            </div>

            <div>
              <label className="block text-[11px] text-slate-300 mb-1">
                Resolution Summary <span className="text-red-400">*</span>
              </label>
              <textarea
                rows={2}
                required
                value={resolutionSummary}
                onChange={(e) => setResolutionSummary(e.target.value)}
                placeholder="What action was taken to remediate the request? What changed?"
                className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-slate-300 mb-1">Root Cause Category</label>
                <select
                  value={rootCauseCategory}
                  onChange={(e) => setRootCauseCategory(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200"
                >
                  <option value="CODE_DEFECT">Code Defect</option>
                  <option value="CONFIGURATION_ERROR">Configuration Error</option>
                  <option value="UPSTREAM_OUTAGE">Upstream Vendor Outage</option>
                  <option value="CUSTOMER_ACTION">Customer Action / Dispute</option>
                  <option value="PROCESS_COMPLETED">Standard Process Completed</option>
                </select>
              </div>

              <div className="flex items-end">
                <button
                  onClick={() => handleTransition('RESOLVED')}
                  className="w-full py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-semibold shadow transition"
                >
                  Submit & Resolve
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="border-b border-slate-800 px-5 flex gap-6 text-xs font-medium">
          <button
            onClick={() => setActiveTab('details')}
            className={`py-3 border-b-2 transition ${
              activeTab === 'details'
                ? 'border-indigo-500 text-indigo-400 font-semibold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Details & Context
          </button>

          <button
            onClick={() => setActiveTab('comments')}
            className={`py-3 border-b-2 transition flex items-center gap-1.5 ${
              activeTab === 'comments'
                ? 'border-indigo-500 text-indigo-400 font-semibold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Discussion
            <span className="px-1.5 py-0.2 rounded-full bg-slate-800 text-[10px] text-slate-300">
              {data.comments.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('audit')}
            className={`py-3 border-b-2 transition flex items-center gap-1.5 ${
              activeTab === 'audit'
                ? 'border-indigo-500 text-indigo-400 font-semibold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Immutable Audit Trail
            <span className="px-1.5 py-0.2 rounded-full bg-slate-800 text-[10px] text-slate-300">
              {data.auditEvents.length}
            </span>
          </button>
        </div>

        {/* Tab Contents */}
        <div className="flex-1 overflow-y-auto p-5">
          
          {/* TAB 1: Details */}
          {activeTab === 'details' && (
            <div className="space-y-5 text-xs">
              <div>
                <h4 className="text-slate-400 uppercase tracking-wider text-[10px] font-bold mb-1">Description</h4>
                <p className="text-sm text-slate-200 leading-relaxed bg-slate-950/50 p-3 rounded-lg border border-slate-800">
                  {item.description}
                </p>
              </div>

              {/* Resolution details if resolved */}
              {item.status === 'RESOLVED' && item.resolution_summary && (
                <div className="bg-emerald-950/20 border border-emerald-500/30 p-3.5 rounded-lg space-y-1">
                  <div className="text-emerald-400 font-bold uppercase text-[10px] tracking-wider">Resolution Outcome</div>
                  <div className="text-slate-200 text-xs">{item.resolution_summary}</div>
                  <div className="text-slate-400 text-[11px] pt-1">
                    Root Cause: <strong className="text-slate-200">{item.root_cause_category}</strong>
                  </div>
                </div>
              )}

              {/* Category-specific metadata */}
              {item.parsed_metadata && Object.keys(item.parsed_metadata).length > 0 && (
                <div>
                  <h4 className="text-slate-400 uppercase tracking-wider text-[10px] font-bold mb-1.5">Operational Metadata</h4>
                  <div className="bg-slate-950 rounded-lg border border-slate-800 divide-y divide-slate-800/60 font-mono text-[11px]">
                    {Object.entries(item.parsed_metadata).map(([k, v]) => (
                      <div key={k} className="p-2.5 flex justify-between">
                        <span className="text-slate-400">{k}:</span>
                        <span className="text-indigo-300 font-semibold">{String(v)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Attribution and Timing Grid */}
              <div className="grid grid-cols-2 gap-3 pt-2">
                <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                  <div className="text-slate-400 text-[10px] uppercase font-bold">Created By</div>
                  <div className="text-slate-200 font-medium mt-1">{item.created_by_user_name || 'System'}</div>
                  <div className="text-slate-500 text-[11px] mt-0.5">{new Date(item.created_at).toLocaleString()}</div>
                </div>

                <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                  <div className="text-slate-400 text-[10px] uppercase font-bold">SLA Commitment</div>
                  <div className={`font-medium mt-1 ${item.sla_breached ? 'text-red-400 font-bold' : 'text-slate-200'}`}>
                    {item.sla_breached ? 'BREACHED' : 'Due ' + new Date(item.sla_due_at).toLocaleTimeString()}
                  </div>
                  <div className="text-slate-500 text-[11px] mt-0.5">Target: {new Date(item.sla_due_at).toLocaleString()}</div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: Comments */}
          {activeTab === 'comments' && (
            <div className="flex flex-col h-full space-y-4">
              <div className="flex-1 space-y-3 overflow-y-auto">
                {data.comments.length === 0 ? (
                  <div className="text-center py-10 text-slate-500 text-xs">
                    No discussion notes yet. Leave a note below.
                  </div>
                ) : (
                  data.comments.map(c => (
                    <div 
                      key={c.id} 
                      className={`p-3 rounded-lg border text-xs ${
                        c.is_internal_only 
                          ? 'bg-amber-950/20 border-amber-500/30' 
                          : 'bg-slate-950/70 border-slate-800'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <strong className="text-slate-200">{c.user_name || 'Team Member'}</strong>
                          {c.is_internal_only && (
                            <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-semibold border border-amber-500/30">
                              Internal Note
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-500">
                          {new Date(c.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-slate-300 whitespace-pre-wrap">{c.content}</p>
                    </div>
                  ))
                )}
              </div>

              {/* Add Comment Input */}
              <form onSubmit={handleAddComment} className="pt-3 border-t border-slate-800">
                <textarea
                  rows={2}
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder="Share updates, investigation findings, or questions..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
                
                <div className="flex items-center justify-between mt-2">
                  <label className="flex items-center gap-1.5 text-[11px] text-slate-400 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={isInternalComment}
                      onChange={(e) => setIsInternalComment(e.target.checked)}
                      className="rounded bg-slate-900 border-slate-700 text-amber-500 focus:ring-amber-500"
                    />
                    <span>Mark as Internal Team Note</span>
                  </label>

                  <button
                    type="submit"
                    disabled={submittingComment || !newComment.trim()}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold transition disabled:opacity-50"
                  >
                    <Send className="w-3.5 h-3.5" />
                    Send Note
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* TAB 3: Immutable Audit Trail */}
          {activeTab === 'audit' && (
            <div className="space-y-4">
              <div className="text-xs text-slate-400">
                Every state transition, ownership change, and approval decision is immutably logged for compliance and post-incident review.
              </div>

              <div className="relative pl-6 space-y-6 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-800">
                {data.auditEvents.map((evt, idx) => (
                  <div key={evt.id} className="relative">
                    <div className="absolute -left-6 top-1 w-2.5 h-2.5 rounded-full bg-indigo-500 ring-4 ring-slate-900" />
                    
                    <div className="bg-slate-950/70 p-3 rounded-lg border border-slate-800 text-xs">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-bold text-slate-200">
                          {evt.event_type.replace('_', ' ')}
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono">
                          {new Date(evt.created_at).toLocaleTimeString()}
                        </span>
                      </div>

                      <div className="text-slate-400 text-[11px]">
                        Actor: <strong className="text-slate-300">{evt.actor_name || evt.actor_user_id || 'System Automation'}</strong>
                      </div>

                      {evt.comment && (
                        <div className="text-slate-300 mt-1 italic text-[11px]">
                          "{evt.comment}"
                        </div>
                      )}

                      {evt.new_state && (
                        <div className="mt-2 pt-2 border-t border-slate-800/80 font-mono text-[10px] text-slate-400">
                          <span>Updated state: {evt.new_state}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>

      </div>
    </div>
  );
};
