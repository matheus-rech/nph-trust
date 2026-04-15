'use client';
import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { LayoutDashboard, Users, FileCheck, Shield, Clock, ArrowRight, Activity, TrendingUp, CheckCircle2, AlertCircle } from 'lucide-react';
import dynamic from 'next/dynamic';

const FunnelChart = dynamic(() => import('@/components/funnel-chart'), { ssr: false, loading: () => <div className="h-64 bg-[hsl(210,15%,95%)] rounded-lg animate-pulse" /> });
const StageDistChart = dynamic(() => import('@/components/stage-dist-chart'), { ssr: false, loading: () => <div className="h-64 bg-[hsl(210,15%,95%)] rounded-lg animate-pulse" /> });

export default function DashboardPage() {
  const { data: session } = useSession() || {};
  const [projects, setProjects] = useState<any[]>([]);
  const [dashData, setDashData] = useState<any>(null);
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/projects').then(r => r.json()).then((d: any) => {
      const projs = Array.isArray(d) ? d : [];
      setProjects(projs);
      if (projs.length > 0) setSelectedProject(projs[0]?.id ?? '');
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedProject) return;
    setLoading(true);
    fetch(`/api/projects/${selectedProject}/dashboard`).then(r => r.json()).then((d: any) => setDashData(d)).catch(() => {}).finally(() => setLoading(false));
  }, [selectedProject]);

  const user = (session?.user as any);
  const stats = [
    { label: 'Total Episodes', value: dashData?.totalEpisodes ?? 0, icon: Users, color: '#60B5FF' },
    { label: 'Attestations', value: Object.values(dashData?.attestationSummary ?? {}).reduce((a: number, b: any) => a + (Number(b) || 0), 0) as number, icon: Shield, color: '#72BF78' },
    { label: 'Pending Approvals', value: dashData?.approvalSummary?.PENDING ?? 0, icon: Clock, color: '#FF9149' },
    { label: 'Sites', value: dashData?.project?.sites?.length ?? 0, icon: Activity, color: '#A19AD3' },
  ];

  return (
    <div className="max-w-[1200px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold tracking-tight flex items-center gap-2">
            <LayoutDashboard className="w-6 h-6 text-[hsl(210,60%,45%)]" />
            Dashboard
          </h1>
          <p className="text-sm text-[hsl(215,10%,50%)] mt-1">Overview of registry activity and pathway progress</p>
        </div>
        {projects.length > 1 && (
          <select
            value={selectedProject}
            onChange={(e: any) => setSelectedProject(e.target.value)}
            className="px-3 py-2 rounded-lg border border-[hsl(210,15%,88%)] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(210,60%,45%)]/30"
          >
            {projects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
      </div>

      {loading && !dashData ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <div key={i} className="h-24 bg-white rounded-xl animate-pulse" />)}
        </div>
      ) : (
        <>
          {/* Stats cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {stats.map((s: any, i: number) => {
              const Icon = s.icon;
              return (
                <div key={i} className="bg-white rounded-xl p-4 transition-shadow hover:shadow-md" style={{ boxShadow: 'var(--shadow-sm)' }}>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${s.color}15` }}>
                      <Icon className="w-5 h-5" style={{ color: s.color }} />
                    </div>
                    <div>
                      <p className="text-2xl font-display font-bold">{s.value}</p>
                      <p className="text-xs text-[hsl(215,10%,50%)]">{s.label}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Pathway Funnel */}
            <div className="bg-white rounded-xl p-5" style={{ boxShadow: 'var(--shadow-sm)' }}>
              <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-[hsl(210,60%,45%)]" />
                Pathway Funnel
              </h2>
              <div className="h-[300px]">
                <FunnelChart data={dashData?.stageDistribution ?? {}} />
              </div>
            </div>

            {/* Stage Distribution */}
            <div className="bg-white rounded-xl p-5" style={{ boxShadow: 'var(--shadow-sm)' }}>
              <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
                <Activity className="w-4 h-4 text-[hsl(210,60%,45%)]" />
                Stage Distribution
              </h2>
              <div className="h-[300px]">
                <StageDistChart data={dashData?.stageDistribution ?? {}} />
              </div>
            </div>
          </div>

          {/* Attestation Summary + Recent Activity */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl p-5" style={{ boxShadow: 'var(--shadow-sm)' }}>
              <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
                <Shield className="w-4 h-4 text-[hsl(210,60%,45%)]" />
                Attestation Status
              </h2>
              <div className="space-y-2">
                {Object.entries(dashData?.attestationSummary ?? {}).length === 0 && (
                  <p className="text-sm text-[hsl(215,10%,50%)] py-4 text-center">No attestations yet</p>
                )}
                {Object.entries(dashData?.attestationSummary ?? {}).map(([status, count]: [string, any]) => (
                  <div key={status} className="flex items-center justify-between py-2 px-3 rounded-lg bg-[hsl(210,20%,98%)]">
                    <div className="flex items-center gap-2">
                      {status === 'SIGNED' ? <CheckCircle2 className="w-4 h-4 text-[#3B82F6]" /> : status === 'ANCHORED' ? <CheckCircle2 className="w-4 h-4 text-[#72BF78]" /> : status === 'ANCHOR_PENDING' ? <AlertCircle className="w-4 h-4 text-[#FF9149]" /> : status === 'REVERIFIED' ? <CheckCircle2 className="w-4 h-4 text-[#A19AD3]" /> : <AlertCircle className="w-4 h-4 text-[#94a3b8]" />}
                      <span className="text-sm">{status}</span>
                    </div>
                    <span className="text-sm font-mono font-semibold">{count}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-xl p-5" style={{ boxShadow: 'var(--shadow-sm)' }}>
              <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
                <Clock className="w-4 h-4 text-[hsl(210,60%,45%)]" />
                Recent Activity
              </h2>
              <div className="space-y-2 max-h-[260px] overflow-y-auto scrollbar-thin">
                {(dashData?.recentActivity ?? []).length === 0 && (
                  <p className="text-sm text-[hsl(215,10%,50%)] py-4 text-center">No recent activity</p>
                )}
                {(dashData?.recentActivity ?? []).slice(0, 10).map((a: any) => (
                  <div key={a.id} className="flex items-start gap-3 py-2 px-3 rounded-lg bg-[hsl(210,20%,98%)] text-sm">
                    <div className="w-1.5 h-1.5 rounded-full bg-[hsl(210,60%,45%)] mt-1.5 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="truncate">{a?.action ?? 'Activity'}</p>
                      <p className="text-xs text-[hsl(215,10%,50%)]">{a?.actor?.displayName ?? 'System'}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
