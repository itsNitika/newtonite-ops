import React from 'react';
import { 
  Activity, 
  Plus, 
  Layers, 
  UserCheck, 
  ShieldCheck, 
  Wifi, 
  WifiOff, 
  Zap, 
  Users,
  AlertCircle
} from 'lucide-react';
import { UserWithTeams } from '../types';

interface HeaderProps {
  currentUser: UserWithTeams | null;
  users: UserWithTeams[];
  onSelectUser: (user: UserWithTeams) => void;
  isConnected: boolean;
  onOpenCreateModal: () => void;
  onOpenOutboxModal: () => void;
  activeItemCount?: number;
  unassignedCount?: number;
}

export const Header: React.FC<HeaderProps> = ({
  currentUser,
  users,
  onSelectUser,
  isConnected,
  onOpenCreateModal,
  onOpenOutboxModal,
  activeItemCount = 0,
  unassignedCount = 0
}) => {
  return (
    <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-30 shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        
        {/* Brand & System Status */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-gradient-to-tr from-indigo-600 via-indigo-500 to-purple-500 flex items-center justify-center shadow-lg shadow-indigo-600/30">
              <Activity className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-base tracking-tight text-white">NEWTONITE</span>
                <span className="text-[10px] uppercase font-mono tracking-widest px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                  OPS HUB
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-medium">Operations Coordination Platform</p>
            </div>
          </div>

          {/* SSE Live Connection Pill */}
          <div className="hidden sm:flex items-center gap-2 px-2.5 py-1 rounded-full bg-slate-950 border border-slate-800 text-xs">
            {isConnected ? (
              <>
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <span className="text-emerald-400 font-medium text-[11px]">Live Real-Time Sync</span>
              </>
            ) : (
              <>
                <span className="h-2 w-2 rounded-full bg-amber-500"></span>
                <span className="text-amber-400 font-medium text-[11px]">Reconnecting...</span>
              </>
            )}
          </div>
        </div>

        {/* Right Section: Persona Switcher & Primary Actions */}
        <div className="flex items-center gap-4">
          
          {/* Outbox & Background Jobs Button */}
          <button
            onClick={onOpenOutboxModal}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-800 text-slate-200 hover:text-white border border-slate-700/80 text-xs font-medium transition"
            title="Inspect background Outbox Queue and SLA worker"
          >
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden md:inline">Worker & Outbox</span>
          </button>

          {/* Persona Switcher Dropdown */}
          <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-lg p-1">
            <span className="text-[11px] text-slate-400 pl-2 hidden lg:inline">Simulate Persona:</span>
            <select
              value={currentUser?.id || ''}
              onChange={(e) => {
                const found = users.find(u => u.id === e.target.value);
                if (found) onSelectUser(found);
              }}
              aria-label="Simulate Persona"
              className="bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded px-2.5 py-1 font-medium focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            >
              {users.map(u => {
                const teamRole = u.teams[0] ? `${u.teams[0].team_name} (${u.teams[0].role})` : (u.is_admin ? 'Global Admin' : 'Staff');
                return (
                  <option key={u.id} value={u.id}>
                    {u.name} — {teamRole}
                  </option>
                );
              })}
            </select>
          </div>

          {/* Create Work Item Button */}
          <button
            onClick={onOpenCreateModal}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/30 transition"
          >
            <Plus className="w-4 h-4" />
            <span>New Request</span>
          </button>

        </div>

      </div>
    </header>
  );
};
