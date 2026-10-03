import React from 'react';
import { AlertTriangle, RefreshCw, X, ArrowRight } from 'lucide-react';
import { WorkItem } from '../types';

interface ConflictModalProps {
  isOpen: boolean;
  onClose: () => void;
  onResolve: () => void;
  conflictData: {
    message: string;
    current_version: number;
    current_item: WorkItem;
  } | null;
  attemptedAction?: string;
}

export const ConflictModal: React.FC<ConflictModalProps> = ({
  isOpen,
  onClose,
  onResolve,
  conflictData,
  attemptedAction
}) => {
  if (!isOpen || !conflictData) return null;

  const current = conflictData.current_item;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-amber-500/50 rounded-xl shadow-2xl max-w-xl w-full p-6 text-slate-100 animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex items-start gap-4">
          <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-400">
            <AlertTriangle className="w-8 h-8" />
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-amber-300">
                Optimistic Concurrency Conflict (409)
              </h2>
              <button 
                onClick={onClose}
                className="text-slate-400 hover:text-white p-1 rounded-md transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-slate-300 mt-1">
              Another team member modified this work item while you were viewing it. To prevent accidental overwrites, your action was safely intercepted.
            </p>
          </div>
        </div>

        {/* Conflict Details */}
        <div className="mt-5 space-y-3 bg-slate-950/70 border border-slate-800 rounded-lg p-4 text-xs">
          <div className="flex justify-between items-center pb-2 border-b border-slate-800">
            <span className="text-slate-400">Work Item:</span>
            <span className="font-mono font-semibold text-slate-200">{current.tracking_num} - {current.title}</span>
          </div>

          <div className="flex justify-between items-center pb-2 border-b border-slate-800">
            <span className="text-slate-400">Interception Reason:</span>
            <span className="text-amber-400 font-medium">Stale version detected</span>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-1">
            <div className="bg-slate-900 p-2.5 rounded border border-slate-800">
              <div className="text-slate-400 uppercase text-[10px] tracking-wider mb-1">Your Stale View</div>
              <div className="font-mono text-slate-400">Version: {conflictData.current_version - 1}</div>
              <div className="text-slate-400 truncate mt-1">Action: {attemptedAction || 'Update'}</div>
            </div>

            <div className="bg-emerald-950/30 p-2.5 rounded border border-emerald-500/30">
              <div className="text-emerald-400 uppercase text-[10px] tracking-wider mb-1">Current Server State</div>
              <div className="font-mono text-emerald-300 font-bold">Version: {conflictData.current_version}</div>
              <div className="text-emerald-200 truncate mt-1">Status: {current.status}</div>
              <div className="text-emerald-200 truncate">Assignee: {current.assigned_user_name || 'Unassigned'}</div>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-lg transition"
          >
            Cancel
          </button>
          
          <button
            type="button"
            onClick={onResolve}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg shadow-lg shadow-indigo-600/30 transition"
          >
            <RefreshCw className="w-4 h-4" />
            Reload Latest Server State
          </button>
        </div>

      </div>
    </div>
  );
};
