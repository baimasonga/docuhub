/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { 
  Folder, 
  Clock, 
  Star, 
  CheckSquare, 
  Archive, 
  Trash2, 
  Plus, 
  Building2,
  ShieldCheck,
  History,
  FileHeart,
  Vault,
  LayoutDashboard,
  Settings,
  UserCog
} from 'lucide-react';
import { User } from '../types';

interface SidebarProps {
  currentView: string;
  onViewChange: (view: string) => void;
  onOpenUpload: () => void;
  onOpenCreateFolder: () => void;
  pendingWithMeCount: number;
  currentUser: User;
}

export default function Sidebar({
  currentView,
  onViewChange,
  onOpenUpload,
  onOpenCreateFolder,
  pendingWithMeCount,
  currentUser
}: SidebarProps) {
  
  const mainNavItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'my-drive', label: 'Folder Cabinets', icon: Folder },
    { id: 'shared-with-me', label: 'Shares', icon: Clock },
    { id: 'starred', label: 'Starred Files', icon: Star },
  ];

  const workflowNavItems = [
    { id: 'pending-approval', label: 'Pending Approval', icon: CheckSquare, badge: pendingWithMeCount },
    { id: 'approved-files', label: 'Approved Documents', icon: ShieldCheck },
    { id: 'archive', label: 'Archive', icon: Archive },
    { id: 'trash', label: 'Trash', icon: Trash2 },
  ];

  // Specific admin tools
  const adminNavItems = [
    { id: 'user-management', label: 'User Management', icon: UserCog },
    { id: 'departments', label: 'Departments Map', icon: Building2 },
    { id: 'settings', label: 'Settings', icon: Settings },
    { id: 'activity-log', label: 'Audit Trail Logs', icon: History },
  ];

  return (
    <aside className="w-68 bg-white border-r border-slate-100 flex flex-col h-full shrink-0">
      {/* Brand area */}
      <div className="p-6 border-b border-slate-50 flex items-center space-x-2.5">
        <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-100">
          <Vault className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="font-display font-semibold text-slate-800 text-sm tracking-tight">AVDP DMS</h1>
          <p className="text-[10px] text-slate-400 font-mono">SECURE WORKSPACE</p>
        </div>
      </div>

      {/* Primary Action Button */}
      {currentUser.role !== 'Viewer' && (
        <div className="px-4 py-4 flex flex-col space-y-2">
          <button
            onClick={onOpenUpload}
            className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium text-xs flex items-center justify-center space-x-1.5 transition-all shadow-md shadow-indigo-100 hover:shadow-indigo-200"
          >
            <Plus className="w-4 h-4 text-white shrink-0" />
            <span>Upload Files</span>
          </button>
          
          <button
            onClick={onOpenCreateFolder}
            className="w-full py-2 px-4 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl font-medium text-xs flex items-center justify-center space-x-1.5 transition-all"
          >
            <Folder className="w-4 h-4 text-slate-500 shrink-0" />
            <span>Create Cabinet / Folder</span>
          </button>
        </div>
      )}

      {/* Nav groups */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-6">
        <div>
          <span className="px-3 text-[10px] font-mono font-semibold tracking-wider text-slate-400 uppercase">File Storage</span>
          <nav className="mt-1 space-y-0.5">
            {mainNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentView === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onViewChange(item.id)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left text-xs transition-all font-medium ${
                    isActive 
                      ? 'bg-indigo-50/70 text-indigo-700' 
                      : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center space-x-2.5">
                    <Icon className={`w-4 h-4 ${isActive ? 'text-indigo-600' : 'text-slate-400'}`} />
                    <span>{item.label}</span>
                  </div>
                </button>
              );
            })}
          </nav>
        </div>

        <div>
          <span className="px-3 text-[10px] font-mono font-semibold tracking-wider text-slate-400 uppercase">Approvals & State</span>
          <nav className="mt-1 space-y-0.5">
            {workflowNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentView === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onViewChange(item.id)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left text-xs transition-all font-medium ${
                    isActive 
                      ? 'bg-indigo-50/70 text-indigo-700' 
                      : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center space-x-2.5">
                    <Icon className={`w-4 h-4 ${isActive ? 'text-indigo-600' : 'text-slate-400'}`} />
                    <span>{item.label}</span>
                  </div>
                  {item.badge !== undefined && item.badge > 0 && (
                    <span className="bg-rose-500 text-white font-mono font-semibold text-[9px] px-2 py-0.5 rounded-full scale-95 animate-pulse">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Admin and Audit tools */}
        {(currentUser.role === 'Admin' || currentUser.role === 'Auditor') && (
          <div>
            <span className="px-3 text-[10px] font-mono font-semibold tracking-wider text-slate-400 uppercase">Administration</span>
            <nav className="mt-1 space-y-0.5">
              {adminNavItems.map((item) => {
                const Icon = item.icon;
                const isActive = currentView === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => onViewChange(item.id)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left text-xs transition-all font-medium ${
                      isActive 
                        ? 'bg-indigo-50/70 text-indigo-700' 
                        : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center space-x-2.5">
                      <Icon className={`w-4 h-4 ${isActive ? 'text-indigo-600' : 'text-slate-400'}`} />
                      <span>{item.label}</span>
                    </div>
                  </button>
                );
              })}
            </nav>
          </div>
        )}
      </div>

      {/* User profile card & credentials */}
      <div className="p-4 border-t border-slate-50 bg-slate-50/70 m-3 rounded-2xl">
        <div className="flex items-center space-x-2.5">
          <div className="w-8 h-8 rounded-full bg-slate-200 uppercase flex items-center justify-center font-mono font-bold text-slate-600 text-xs text-[10px]">
            {currentUser.fullName.split(' ').map(n => n[0]).join('')}
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-xs font-semibold text-slate-700 truncate">{currentUser.fullName}</h4>
            <div className="flex items-center space-x-1.5">
              <span className="text-[9px] font-mono px-1.5 py-0.2 bg-slate-200 text-slate-600 rounded">
                {currentUser.role}
              </span>
              <span className="text-[9px] font-mono text-slate-400 truncate">
                {currentUser.department}
              </span>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
