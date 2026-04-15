'use client';
import { useState } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard, FolderOpen, Users as UsersIcon, FileSearch, Upload, CheckSquare,
  Settings, LogOut, Activity, ChevronLeft, ChevronRight, Menu, Shield, Brain
} from 'lucide-react';

const NAV_ITEMS = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, roles: ['ADMIN', 'RESEARCHER', 'COORDINATOR', 'AUDITOR'] },
  { label: 'Projects', href: '/projects', icon: FolderOpen, roles: ['ADMIN', 'RESEARCHER', 'COORDINATOR', 'AUDITOR'] },
  { label: 'Episodes', href: '/episodes', icon: Brain, roles: ['ADMIN', 'RESEARCHER', 'COORDINATOR', 'AUDITOR'] },
  { label: 'Provenance', href: '/provenance', icon: FileSearch, roles: ['ADMIN', 'RESEARCHER', 'COORDINATOR', 'AUDITOR'] },
  { label: 'Import', href: '/import', icon: Upload, roles: ['ADMIN', 'RESEARCHER', 'COORDINATOR'] },
  { label: 'Approvals', href: '/approvals', icon: CheckSquare, roles: ['ADMIN', 'RESEARCHER', 'COORDINATOR', 'AUDITOR'] },
  { label: 'Users', href: '/users', icon: UsersIcon, roles: ['ADMIN'] },
  { label: 'Settings', href: '/settings', icon: Settings, roles: ['ADMIN', 'COORDINATOR'] },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession() || {};
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const user = session?.user as any;
  const role = user?.role ?? 'RESEARCHER';

  const filteredNav = NAV_ITEMS.filter((item: any) => item.roles.includes(role));

  return (
    <div className="flex h-screen overflow-hidden bg-[hsl(210,20%,98%)]">
      {/* Mobile overlay */}
      {mobileOpen && <div className="fixed inset-0 bg-black/20 z-40 lg:hidden" onClick={() => setMobileOpen(false)} />}

      {/* Sidebar */}
      <aside className={`fixed lg:relative z-50 h-full flex flex-col bg-white border-r border-[hsl(210,15%,88%)] transition-all duration-200
        ${collapsed ? 'w-[68px]' : 'w-[240px]'}
        ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `} style={{ boxShadow: 'var(--shadow-sm)' }}>
        {/* Logo */}
        <div className={`flex items-center h-[60px] px-4 border-b border-[hsl(210,15%,88%)] ${collapsed ? 'justify-center' : 'gap-3'}`}>
          <div className="w-8 h-8 rounded-lg bg-[hsl(210,60%,45%)] flex items-center justify-center flex-shrink-0">
            <Activity className="w-4.5 h-4.5 text-white" />
          </div>
          {!collapsed && <span className="font-display font-bold text-sm tracking-tight">NPH-Trust</span>}
        </div>

        {/* Nav */}
        <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto scrollbar-thin">
          {filteredNav.map((item: any) => {
            const active = pathname?.startsWith(item.href);
            const Icon = item.icon;
            return (
              <button
                key={item.href}
                onClick={() => { router.push(item.href); setMobileOpen(false); }}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors
                  ${active ? 'bg-[hsl(210,60%,45%)]/10 text-[hsl(210,60%,45%)] font-medium' : 'text-[hsl(215,10%,50%)] hover:bg-[hsl(210,15%,95%)] hover:text-[hsl(215,25%,15%)]'}
                  ${collapsed ? 'justify-center' : ''}
                `}
                title={collapsed ? item.label : undefined}
              >
                <Icon className="w-[18px] h-[18px] flex-shrink-0" />
                {!collapsed && <span>{item.label}</span>}
              </button>
            );
          })}
        </nav>

        {/* User + collapse */}
        <div className="border-t border-[hsl(210,15%,88%)] p-3 space-y-2">
          {!collapsed && user && (
            <div className="px-2 py-1">
              <p className="text-sm font-medium truncate">{user?.name ?? 'User'}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <Shield className="w-3 h-3 text-[hsl(210,60%,45%)]" />
                <span className="text-xs text-[hsl(215,10%,50%)]">{role}</span>
              </div>
            </div>
          )}
          <div className="flex items-center gap-1">
            <button onClick={() => setCollapsed(!collapsed)} className="p-2 rounded-lg hover:bg-[hsl(210,15%,95%)] text-[hsl(215,10%,50%)] hidden lg:flex">
              {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </button>
            <button onClick={() => signOut({ callbackUrl: '/login' })} className={`p-2 rounded-lg hover:bg-red-50 text-[hsl(215,10%,50%)] hover:text-red-600 ${collapsed ? 'mx-auto' : 'ml-auto'}`} title="Sign out">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar (mobile) */}
        <header className="lg:hidden flex items-center h-[52px] px-4 border-b border-[hsl(210,15%,88%)] bg-white">
          <button onClick={() => setMobileOpen(true)} className="p-1.5 rounded-lg hover:bg-[hsl(210,15%,95%)]">
            <Menu className="w-5 h-5" />
          </button>
          <span className="ml-3 font-display font-bold text-sm">NPH-Trust</span>
        </header>
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
