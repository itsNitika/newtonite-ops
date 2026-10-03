import React, { useState, useEffect, useCallback } from 'react';
import { 
  Search, 
  Filter, 
  LayoutList, 
  Kanban, 
  RotateCcw, 
  AlertTriangle, 
  Zap, 
  CheckCircle2, 
  UserCheck, 
  ShieldAlert,
  Clock
} from 'lucide-react';
import { Header } from './components/Header';
import { WorkItemList } from './components/WorkItemList';
import { KanbanBoard } from './components/KanbanBoard';
import { WorkItemDrawer } from './components/WorkItemDrawer';
import { CreateItemModal } from './components/CreateItemModal';
import { ConflictModal } from './components/ConflictModal';
import { OutboxMonitorModal } from './components/OutboxMonitorModal';
import { useSSE, SSEEvent } from './hooks/useSSE';
import { api, setActiveUser, getActiveUser, ApiError } from './api';
import { WorkItem, UserWithTeams, Team, Category, Priority, WorkItemStatus } from './types';

export default function App() {
  // Global Data
  const [users, setUsers] = useState<UserWithTeams[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [currentUser, setCurrentUser] = useState<UserWithTeams | null>(null);

  // Work Items & Filter State
  const [workItems, setWorkItems] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'table' | 'kanban'>('table');
  const [search, setSearch] = useState('');
  const [quickFilter, setQuickFilter] = useState<'all' | 'mine' | 'my_team' | 'approval' | 'sla_breached' | 'unassigned'>('all');
  const [selectedTeam, setSelectedTeam] = useState<string>('');
  const [selectedPriority, setSelectedPriority] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, total_pages: 1 });

  // Drawer & Modal States
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isOutboxOpen, setIsOutboxOpen] = useState(false);

  // Concurrency Conflict State
  const [conflictData, setConflictData] = useState<{
    message: string;
    current_version: number;
    current_item: WorkItem;
  } | null>(null);
  const [conflictAction, setConflictAction] = useState<string>('');

  // Live Toast Notification
  const [toast, setToast] = useState<{ message: string; type: 'info' | 'warn' | 'success' } | null>(null);

  const showToast = (message: string, type: 'info' | 'warn' | 'success' = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  };

  // SSE Realtime integration
  const handleRealtimeEvent = useCallback((event: SSEEvent) => {
    if (event.type === 'WORK_ITEM_CREATED') {
      showToast(`New Request: [${event.data.item.tracking_num}] ${event.data.item.title}`, 'info');
      fetchWorkItems(false);
    } else if (event.type === 'WORK_ITEM_UPDATED') {
      showToast(`Updated: [${event.data.item.tracking_num}] v${event.data.item.version}`, 'info');
      fetchWorkItems(false);
    } else if (event.type === 'SLA_BREACHED') {
      showToast(`⚠️ SLA Breached on [${event.data.trackingNum}]: ${event.data.title}`, 'warn');
      fetchWorkItems(false);
    }
  }, []);

  const { isConnected } = useSSE(handleRealtimeEvent);

  // Fetch initial users and teams
  useEffect(() => {
    const init = async () => {
      try {
        const [uList, tList] = await Promise.all([
          api.getUsers(),
          api.getTeams()
        ]);
        setUsers(uList);
        setTeams(tList);

        const storedUserId = getActiveUser();
        const active = uList.find(u => u.id === storedUserId) || uList[0];
        if (active) {
          setCurrentUser(active);
          setActiveUser(active.id);
        }
      } catch (err) {
        console.error('Initialization error:', err);
      }
    };
    init();
  }, []);

  // Fetch work items based on current filters
  const fetchWorkItems = async (showSpinner: boolean = true) => {
    try {
      if (showSpinner) setLoading(true);

      const params: Record<string, any> = {
        search: search.trim() || undefined,
        team_id: selectedTeam || undefined,
        priority: selectedPriority || undefined,
        category: selectedCategory || undefined,
        page: pagination.page,
        limit: pagination.limit
      };

      if (quickFilter === 'mine' && currentUser) {
        params.user_id = currentUser.id;
      } else if (quickFilter === 'my_team' && currentUser?.teams[0]) {
        params.team_id = currentUser.teams[0].team_id;
      } else if (quickFilter === 'approval') {
        params.requires_approval = true;
      } else if (quickFilter === 'sla_breached') {
        params.sla_breached = true;
      } else if (quickFilter === 'unassigned') {
        params.unassigned = true;
      }

      const res = await api.getWorkItems(params);
      setWorkItems(res.data);
      setPagination(res.pagination);
    } catch (err) {
      console.error('Failed to fetch work items:', err);
    } finally {
      if (showSpinner) setLoading(false);
    }
  };

  // Refetch when filters or page changes
  useEffect(() => {
    fetchWorkItems(true);
  }, [search, quickFilter, selectedTeam, selectedPriority, selectedCategory, pagination.page, currentUser?.id]);

  const handleSelectUser = (user: UserWithTeams) => {
    setCurrentUser(user);
    setActiveUser(user.id);
    showToast(`Switched active persona to ${user.name} (${user.teams[0]?.team_name || 'Admin'})`, 'info');
  };

  // Fast claim directly from table row
  const handleClaimFast = async (item: WorkItem, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.claimWorkItem(item.id, item.version);
      showToast(`Claimed responsibility for ${item.tracking_num}`, 'success');
      fetchWorkItems(false);
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 409) {
        setConflictAction('Claim Responsibility');
        setConflictData(err.data);
      } else {
        alert(err.message || 'Claim failed');
      }
    }
  };

  // Conflict modal resolution
  const handleResolveConflict = () => {
    setConflictData(null);
    fetchWorkItems(false);
    if (selectedItemId) {
      // Re-trigger drawer refresh
      setSelectedItemId(selectedItemId);
    }
  };

  // Demonstration helper: trigger concurrent collision
  const handleSimulateCollision = async () => {
    if (workItems.length === 0) return;
    const target = workItems[0];
    showToast(`Triggering simulated concurrent write collision on ${target.tracking_num}...`, 'warn');

    try {
      // Step 1: User A successfully claims/updates target, bumping version
      await api.claimWorkItem(target.id, target.version);
      
      // Step 2: User B tries to update using old stale target.version -> throws 409 Conflict!
      await api.claimWorkItem(target.id, target.version);
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 409) {
        setConflictAction('Simultaneous Claim Collision');
        setConflictData(err.data);
      } else {
        alert(err.message || 'Collision test error');
      }
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      
      {/* Toast Notification */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-xl text-xs font-semibold flex items-center gap-2 border animate-in slide-in-from-top-2 duration-200 ${
          toast.type === 'warn' ? 'bg-amber-950/90 text-amber-200 border-amber-500/50' :
          toast.type === 'success' ? 'bg-emerald-950/90 text-emerald-200 border-emerald-500/50' :
          'bg-indigo-950/90 text-indigo-200 border-indigo-500/50'
        }`}>
          {toast.type === 'warn' ? <AlertTriangle className="w-4 h-4 text-amber-400" /> :
           toast.type === 'success' ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> :
           <Zap className="w-4 h-4 text-indigo-400" />}
          <span>{toast.message}</span>
        </div>
      )}

      {/* Header */}
      <Header
        currentUser={currentUser}
        users={users}
        onSelectUser={handleSelectUser}
        isConnected={isConnected}
        onOpenCreateModal={() => setIsCreateOpen(true)}
        onOpenOutboxModal={() => setIsOutboxOpen(true)}
        activeItemCount={pagination.total}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col gap-5">
        
        {/* Filter & Search Bar */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm flex flex-col gap-3">
          
          {/* Top Filter Row: Search & View Modes */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            
            {/* Search Input */}
            <div className="relative flex-1 min-w-[280px]">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
              <input
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPagination(p => ({ ...p, page: 1 }));
                }}
                placeholder="Search by ID (OPS-1001), keywords, descriptions, or symptoms..."
                className="w-full bg-slate-950 border border-slate-700/80 rounded-lg pl-9 pr-4 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition"
              />
              {search && (
                <button 
                  onClick={() => setSearch('')}
                  className="absolute right-3 top-2.5 text-xs text-slate-500 hover:text-slate-300"
                >
                  ✕
                </button>
              )}
            </div>

            {/* View Mode & Collision Sim Helper */}
            <div className="flex items-center gap-2">
              <button
                onClick={handleSimulateCollision}
                className="flex items-center gap-1.5 px-3 py-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-lg text-xs font-mono transition"
                title="Test 409 Optimistic Concurrency Control by simulating simultaneous writes"
              >
                <Zap className="w-3.5 h-3.5" />
                Simulate Concurrency Conflict
              </button>

              <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg p-0.5">
                <button
                  onClick={() => setViewMode('table')}
                  className={`p-1.5 rounded text-xs flex items-center gap-1.5 transition ${
                    viewMode === 'table' ? 'bg-indigo-600 text-white font-medium shadow' : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title="Table View"
                >
                  <LayoutList className="w-4 h-4" />
                  <span className="hidden sm:inline">Table</span>
                </button>
                <button
                  onClick={() => setViewMode('kanban')}
                  className={`p-1.5 rounded text-xs flex items-center gap-1.5 transition ${
                    viewMode === 'kanban' ? 'bg-indigo-600 text-white font-medium shadow' : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title="Kanban Board View"
                >
                  <Kanban className="w-4 h-4" />
                  <span className="hidden sm:inline">Board</span>
                </button>
              </div>
            </div>

          </div>

          {/* Quick Filter Tabs & Dropdowns */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/80 text-xs">
            
            {/* Quick Filter Tabs */}
            <div className="flex flex-wrap items-center gap-1.5">
              {[
                { id: 'all', label: 'All Requests' },
                { id: 'mine', label: 'Assigned to Me' },
                { id: 'my_team', label: "My Team's Queue" },
                { id: 'approval', label: 'Awaiting Dual-Signoff' },
                { id: 'sla_breached', label: 'SLA Breached' },
                { id: 'unassigned', label: 'Unassigned Pool' }
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => {
                    setQuickFilter(tab.id as any);
                    setPagination(p => ({ ...p, page: 1 }));
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                    quickFilter === tab.id
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'bg-slate-950 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-slate-800'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Filter Dropdowns */}
            <div className="flex items-center gap-2">
              <select
                value={selectedTeam}
                onChange={(e) => {
                  setSelectedTeam(e.target.value);
                  setPagination(p => ({ ...p, page: 1 }));
                }}
                className="bg-slate-950 border border-slate-800 text-slate-300 text-xs rounded px-2.5 py-1.5 focus:outline-none focus:border-indigo-500"
              >
                <option value="">All Teams</option>
                {teams.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>

              <select
                value={selectedPriority}
                onChange={(e) => {
                  setSelectedPriority(e.target.value);
                  setPagination(p => ({ ...p, page: 1 }));
                }}
                className="bg-slate-950 border border-slate-800 text-slate-300 text-xs rounded px-2.5 py-1.5 focus:outline-none focus:border-indigo-500"
              >
                <option value="">All Priorities</option>
                <option value="P0_CRITICAL">P0 Critical</option>
                <option value="P1_HIGH">P1 High</option>
                <option value="P2_MEDIUM">P2 Medium</option>
                <option value="P3_LOW">P3 Low</option>
              </select>

              <select
                value={selectedCategory}
                onChange={(e) => {
                  setSelectedCategory(e.target.value);
                  setPagination(p => ({ ...p, page: 1 }));
                }}
                className="bg-slate-950 border border-slate-800 text-slate-300 text-xs rounded px-2.5 py-1.5 focus:outline-none focus:border-indigo-500"
              >
                <option value="">All Categories</option>
                <option value="ENGINEERING">Engineering</option>
                <option value="PAYMENTS">Payments</option>
                <option value="INCIDENT">Incident</option>
                <option value="COMPLIANCE">Compliance</option>
                <option value="CUSTOMER_OPS">Customer Ops</option>
              </select>
            </div>

          </div>

        </div>

        {/* View Component: Table or Kanban */}
        {viewMode === 'table' ? (
          <WorkItemList
            items={workItems}
            onSelectItem={(id) => setSelectedItemId(id)}
            currentUser={currentUser}
            onClaimFast={handleClaimFast}
            pagination={pagination}
            onPageChange={(page) => setPagination(p => ({ ...p, page }))}
          />
        ) : (
          <KanbanBoard
            items={workItems}
            onSelectItem={(id) => setSelectedItemId(id)}
            currentUser={currentUser}
          />
        )}

      </main>

      {/* Work Item Detail Drawer */}
      {selectedItemId && (
        <WorkItemDrawer
          itemId={selectedItemId}
          onClose={() => setSelectedItemId(null)}
          currentUser={currentUser}
          onWorkItemUpdated={() => fetchWorkItems(false)}
          onConflict={(errData, act) => {
            setConflictAction(act);
            setConflictData(errData);
          }}
        />
      )}

      {/* Create Modal */}
      <CreateItemModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onItemCreated={() => {
          fetchWorkItems(false);
          showToast('Work item created successfully!', 'success');
        }}
        teams={teams}
        users={users}
        currentUser={currentUser}
      />

      {/* Outbox & Queue Monitor Modal */}
      <OutboxMonitorModal
        isOpen={isOutboxOpen}
        onClose={() => setIsOutboxOpen(false)}
      />

      {/* Concurrency Conflict Resolution Dialog */}
      <ConflictModal
        isOpen={Boolean(conflictData)}
        onClose={() => setConflictData(null)}
        onResolve={handleResolveConflict}
        conflictData={conflictData}
        attemptedAction={conflictAction}
      />

    </div>
  );
}
