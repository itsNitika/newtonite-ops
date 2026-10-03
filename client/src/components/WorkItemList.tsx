import React from 'react';
import { 
  AlertTriangle, 
  Clock, 
  MessageSquare, 
  User, 
  ShieldAlert, 
  CheckCircle2, 
  ChevronLeft, 
  ChevronRight,
  ShieldCheck,
  Zap
} from 'lucide-react';
import { WorkItem, UserWithTeams } from '../types';

interface WorkItemListProps {
  items: WorkItem[];
  onSelectItem: (id: string) => void;
  currentUser: UserWithTeams | null;
  onClaimFast: (item: WorkItem, e: React.MouseEvent) => void;
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
  onPageChange: (newPage: number) => void;
}

export const WorkItemList: React.FC<WorkItemListProps> = ({
  items,
  onSelectItem,
  currentUser,
  onClaimFast,
  pagination,
  onPageChange
}) => {
  // Compute relative SLA time string
  const getSlaDisplay = (item: WorkItem) => {
    if (item.status === 'RESOLVED' || item.status === 'CANCELLED') {
      return <span className="text-slate-500 text-xs">Completed</span>;
    }
    if (item.sla_breached) {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-red-400 bg-red-950/40 px-2 py-0.5 rounded border border-red-500/30">
          <AlertTriangle className="w-3 h-3 text-red-400 shrink-0" />
          BREACHED
        </span>
      );
    }
    const diffMs = new Date(item.sla_due_at).getTime() - Date.now();
    const diffHours = Math.round(diffMs / (1000 * 60 * 60));
    
    if (diffHours <= 1) {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-400 bg-amber-950/30 px-2 py-0.5 rounded border border-amber-500/30">
          <Clock className="w-3 h-3 text-amber-400" />
          &lt; 1 hour
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
        <Clock className="w-3 h-3 text-slate-500" />
        in {diffHours}h
      </span>
    );
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-lg overflow-hidden flex flex-col">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs text-slate-300">
          <thead className="bg-slate-950/80 text-slate-400 border-b border-slate-800 uppercase tracking-wider text-[10px]">
            <tr>
              <th className="py-3 px-4">Item & Version</th>
              <th className="py-3 px-4">Title & Category</th>
              <th className="py-3 px-4">Assigned Team</th>
              <th className="py-3 px-4">Assignee</th>
              <th className="py-3 px-4">Priority</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4">Target SLA</th>
              <th className="py-3 px-4 text-center">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 font-sans">
            {items.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-12 text-center text-slate-500">
                  No work items match the current filters.
                </td>
              </tr>
            ) : (
              items.map((item) => {
                const isClaimedByMe = item.assigned_user_id === currentUser?.id;

                return (
                  <tr
                    key={item.id}
                    onClick={() => onSelectItem(item.id)}
                    className="hover:bg-slate-800/40 cursor-pointer transition group"
                  >
                    {/* Tracking ID & Version */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="flex items-center gap-1.5 font-mono">
                        <span className="font-bold text-indigo-400 group-hover:text-indigo-300 transition">
                          {item.tracking_num}
                        </span>
                        <span className="text-[10px] text-slate-500 bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800" title="Item Version (for Optimistic Concurrency Control)">
                          v{item.version}
                        </span>
                      </div>
                    </td>

                    {/* Title & Category */}
                    <td className="py-3.5 px-4 max-w-md">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-100 group-hover:text-white transition truncate">
                          {item.title}
                        </span>
                        {item.requires_approval && (
                          <span title="Dual-signoff approval required" className="shrink-0">
                            <ShieldCheck className="w-3.5 h-3.5 text-purple-400" />
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400 flex items-center gap-2 mt-0.5">
                        <span className="text-slate-500">{item.category}</span>
                        {item.resolution_summary && (
                          <span className="text-emerald-400/90 font-medium truncate max-w-xs">
                            ✓ {item.resolution_summary}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Assigned Team */}
                    <td className="py-3.5 px-4 whitespace-nowrap text-slate-300">
                      {item.assigned_team_name || 'Engineering'}
                    </td>

                    {/* Assignee / Claim Action */}
                    <td className="py-3.5 px-4 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      {item.assigned_user_name ? (
                        <div className="flex items-center gap-1.5">
                          <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                            isClaimedByMe ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300'
                          }`}>
                            {item.assigned_user_name.charAt(0)}
                          </div>
                          <span className={isClaimedByMe ? 'text-indigo-300 font-semibold' : 'text-slate-300'}>
                            {item.assigned_user_name}
                          </span>
                        </div>
                      ) : (
                        <button
                          onClick={(e) => onClaimFast(item, e)}
                          className="px-2.5 py-1 text-[11px] font-semibold text-indigo-400 hover:text-white bg-indigo-500/10 hover:bg-indigo-600 border border-indigo-500/30 rounded transition"
                          title="Claim this unassigned work item"
                        >
                          Claim
                        </button>
                      )}
                    </td>

                    {/* Priority */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        item.priority === 'P0_CRITICAL' ? 'bg-red-500/20 text-red-400 border border-red-500/40 animate-pulse' :
                        item.priority === 'P1_HIGH' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
                        item.priority === 'P2_MEDIUM' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' :
                        'bg-slate-800 text-slate-400 border border-slate-700'
                      }`}>
                        {item.priority.replace('_', ' ')}
                      </span>
                    </td>

                    {/* Status */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        item.status === 'RESOLVED' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                        item.status === 'PENDING_APPROVAL' ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30' :
                        item.status === 'IN_PROGRESS' ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30' :
                        item.status === 'READY' ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' :
                        'bg-slate-800 text-slate-400 border border-slate-700'
                      }`}>
                        {item.status.replace('_', ' ')}
                      </span>
                    </td>

                    {/* Target SLA */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      {getSlaDisplay(item)}
                    </td>

                    {/* Comments */}
                    <td className="py-3.5 px-4 text-center whitespace-nowrap">
                      <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                        <MessageSquare className="w-3.5 h-3.5" />
                        {item.comment_count || 0}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div className="bg-slate-950 px-4 py-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
        <div>
          Showing page <span className="font-semibold text-slate-200">{pagination.page}</span> of{' '}
          <span className="font-semibold text-slate-200">{pagination.total_pages}</span> ({pagination.total} total items)
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => onPageChange(pagination.page - 1)}
            disabled={pagination.page <= 1}
            className="flex items-center gap-1 px-3 py-1 bg-slate-900 border border-slate-800 hover:bg-slate-800 disabled:opacity-30 rounded text-slate-300 transition"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            Previous
          </button>

          <button
            onClick={() => onPageChange(pagination.page + 1)}
            disabled={pagination.page >= pagination.total_pages}
            className="flex items-center gap-1 px-3 py-1 bg-slate-900 border border-slate-800 hover:bg-slate-800 disabled:opacity-30 rounded text-slate-300 transition"
          >
            Next
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
