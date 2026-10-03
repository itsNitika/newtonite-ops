import React from 'react';
import { WorkItem, WorkItemStatus, UserWithTeams } from '../types';
import { AlertTriangle, Clock, MessageSquare, ShieldCheck, User } from 'lucide-react';

interface KanbanBoardProps {
  items: WorkItem[];
  onSelectItem: (id: string) => void;
  currentUser: UserWithTeams | null;
}

const COLUMNS: { id: WorkItemStatus; title: string; color: string }[] = [
  { id: 'TRIAGE', title: 'Triage Queue', color: 'border-slate-700 bg-slate-900/60' },
  { id: 'READY', title: 'Ready for Work', color: 'border-cyan-500/30 bg-cyan-950/10' },
  { id: 'IN_PROGRESS', title: 'In Progress', color: 'border-indigo-500/30 bg-indigo-950/10' },
  { id: 'PENDING_APPROVAL', title: 'Pending Dual-Signoff', color: 'border-purple-500/30 bg-purple-950/10' },
  { id: 'RESOLVED', title: 'Resolved & Closed', color: 'border-emerald-500/30 bg-emerald-950/10' }
];

export const KanbanBoard: React.FC<KanbanBoardProps> = ({
  items,
  onSelectItem,
  currentUser
}) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-5 gap-4 h-[calc(100vh-14rem)] min-h-[500px]">
      {COLUMNS.map(col => {
        const colItems = items.filter(item => item.status === col.id);

        return (
          <div
            key={col.id}
            className={`flex flex-col rounded-xl border ${col.color} backdrop-blur-xs p-3 overflow-hidden shadow-sm`}
          >
            {/* Column Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-800/80 mb-3">
              <h3 className="text-xs font-bold text-slate-200 tracking-wide">
                {col.title}
              </h3>
              <span className="px-2 py-0.5 rounded-full bg-slate-800 text-[11px] font-mono text-slate-300">
                {colItems.length}
              </span>
            </div>

            {/* Column Cards */}
            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
              {colItems.length === 0 ? (
                <div className="h-28 border border-dashed border-slate-800/80 rounded-lg flex items-center justify-center text-slate-500 text-xs italic">
                  Empty
                </div>
              ) : (
                colItems.map(item => {
                  const isMine = item.assigned_user_id === currentUser?.id;

                  return (
                    <div
                      key={item.id}
                      onClick={() => onSelectItem(item.id)}
                      className="p-3 bg-slate-900 hover:bg-slate-800/90 border border-slate-800 hover:border-slate-700 rounded-lg shadow-sm cursor-pointer transition space-y-2 group"
                    >
                      {/* Card Top: Tracking ID, Version, Priority */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 font-mono text-xs">
                          <span className="font-bold text-indigo-400 group-hover:text-indigo-300 transition">
                            {item.tracking_num}
                          </span>
                          <span className="text-[10px] text-slate-500 bg-slate-950 px-1 rounded">
                            v{item.version}
                          </span>
                        </div>

                        <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold ${
                          item.priority === 'P0_CRITICAL' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
                          item.priority === 'P1_HIGH' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
                          'bg-slate-800 text-slate-400'
                        }`}>
                          {item.priority.replace('_', ' ')}
                        </span>
                      </div>

                      {/* Title */}
                      <div className="text-xs font-semibold text-slate-100 group-hover:text-white line-clamp-2">
                        {item.title}
                      </div>

                      {/* SLA Breach Alert */}
                      {item.sla_breached && item.status !== 'RESOLVED' && (
                        <div className="flex items-center gap-1 text-[10px] text-red-400 font-bold bg-red-950/40 px-1.5 py-0.5 rounded border border-red-500/30">
                          <AlertTriangle className="w-3 h-3 shrink-0" />
                          SLA Breached
                        </div>
                      )}

                      {/* Card Footer: Assignee & Meta */}
                      <div className="pt-2 border-t border-slate-800/70 flex items-center justify-between text-[11px] text-slate-400">
                        <div className="flex items-center gap-1.5">
                          <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold ${
                            isMine ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300'
                          }`}>
                            {item.assigned_user_name ? item.assigned_user_name.charAt(0) : '?'}
                          </div>
                          <span className={`truncate max-w-[90px] ${isMine ? 'text-indigo-300 font-medium' : ''}`}>
                            {item.assigned_user_name || 'Unassigned'}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          {item.requires_approval && (
                            <span title="Dual-signoff required">
                              <ShieldCheck className="w-3 h-3 text-purple-400" />
                            </span>
                          )}
                          <span className="flex items-center gap-0.5 text-slate-500">
                            <MessageSquare className="w-3 h-3" />
                            {item.comment_count || 0}
                          </span>
                        </div>
                      </div>

                    </div>
                  );
                })
              )}
            </div>

          </div>
        );
      })}
    </div>
  );
};
