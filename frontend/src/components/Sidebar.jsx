import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Play,
  FileText,
  Settings as SettingsIcon,
  LogOut,
  Zap,
  Activity,
  Terminal,
  Calendar,
  Database,
  CreditCard,
  Download,
} from 'lucide-react';
import useStore from '../store/useStore';

export default function Sidebar() {
  const location = useLocation();
  const { user, logout } = useStore();

  const links = [
    { name: 'Dashboard',       path: '/',                icon: LayoutDashboard },
    { name: 'Operations',      path: '/jobs',            icon: Play },
    { name: 'Job Scheduler',   path: '/scheduler',       icon: Calendar },
    { name: 'Scraped Threads', path: '/threads',         icon: FileText },
    { name: 'Post Content',    path: '/posts',           icon: Database },
    { name: 'Card Validator',  path: '/card-validator',  icon: CreditCard },
    { name: 'Topic CC Scraper', path: '/topic-scraper',   icon: Download },
    { name: 'Health Check',    path: '/health',          icon: Activity },
    { name: 'Admin Logs',      path: '/logs',            icon: Terminal },
    { name: 'Settings',        path: '/settings',        icon: SettingsIcon },
  ];

  return (
    <div style={{ width: '100%', height: '100%', background: '#ffffff', display: 'flex', flexDirection: 'column', borderRight: '1px solid #e2e8f0', boxShadow: '2px 0 8px rgba(0,0,0,0.04)', overflowY: 'auto' }}>

      {/* ── Brand ── */}
      <div className="px-6 py-5" style={{ borderBottom: '1px solid #e2e8f0' }}>
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl" style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)', boxShadow: '0 4px 12px rgba(79,70,229,0.35)' }}>
            <Zap className="h-5 w-5 text-white" />
          </div>
          <div>
            <p className="font-extrabold text-slate-900 text-base leading-tight">Altenen</p>
            <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-widest">Scraper Engine</p>
          </div>
        </div>
      </div>

      {/* ── Nav ── */}
      <nav className="flex-1 px-3 py-5 space-y-1">
        {links.map((link) => {
          const Icon = link.icon;
          const isActive = location.pathname === link.path ||
            (link.path !== '/' && location.pathname.startsWith(link.path));
          return (
            <Link
              key={link.path}
              to={link.path}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150"
              style={isActive ? {
                background: 'linear-gradient(135deg, #4f46e5, #6366f1)',
                color: '#fff',
                boxShadow: '0 4px 14px rgba(79,70,229,0.30)',
                fontWeight: 700,
              } : {
                color: '#64748b',
              }}
              onMouseEnter={e => { if (!isActive) { e.currentTarget.style.background = '#f8fafc'; e.currentTarget.style.color = '#1e293b'; } }}
              onMouseLeave={e => { if (!isActive) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#64748b'; } }}
            >
              <div className="flex items-center justify-center w-7 h-7 rounded-lg" style={isActive ? { background: 'rgba(255,255,255,0.18)' } : { background: '#f1f5f9' }}>
                <Icon className="h-4 w-4" />
              </div>
              <span>{link.name}</span>
            </Link>
          );
        })}
      </nav>

      {/* ── User Footer ── */}
      <div className="px-4 pb-4" style={{ borderTop: '1px solid #e2e8f0', paddingTop: '1rem' }}>
        {user && (
          <div className="flex items-center gap-3 p-3 rounded-xl mb-3" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
            <div className="h-8 w-8 rounded-lg flex items-center justify-center text-sm font-extrabold text-white flex-shrink-0" style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)' }}>
              {user.username[0].toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-slate-800 truncate">{user.username}</p>
              <p className="text-[10px] text-slate-400 truncate">{user.email}</p>
            </div>
          </div>
        )}
        <button
          onClick={logout}
          className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-150 cursor-pointer"
          style={{ background: '#fff1f2', color: '#e11d48', border: '1px solid #fecdd3' }}
          onMouseEnter={e => { e.currentTarget.style.background = '#ffe4e6'; }}
          onMouseLeave={e => { e.currentTarget.style.background = '#fff1f2'; }}
        >
          <LogOut className="h-4 w-4" />
          <span>Sign Out</span>
        </button>
      </div>
    </div>
  );
}
