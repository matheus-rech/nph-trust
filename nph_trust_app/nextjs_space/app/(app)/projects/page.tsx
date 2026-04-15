'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { FolderOpen, Plus, Users, Shield, Calendar, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';

export default function ProjectsPage() {
  const { data: session } = useSession() || {};
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', description: '' });
  const router = useRouter();
  const role = (session?.user as any)?.role;

  const loadProjects = () => {
    fetch('/api/projects').then(r => r.json()).then((d: any) => setProjects(Array.isArray(d) ? d : [])).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { loadProjects(); }, []);

  const createProject = async () => {
    if (!form.name.trim()) return;
    try {
      const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      if (res.ok) { toast.success('Project created'); setShowCreate(false); setForm({ name: '', description: '' }); loadProjects(); }
      else { const d = await res.json().catch(() => ({})); toast.error(d?.error ?? 'Failed'); }
    } catch { toast.error('Failed to create project'); }
  };

  const statusColors: Record<string, string> = { DRAFT: 'bg-gray-100 text-gray-700', ACTIVE: 'bg-blue-50 text-blue-700', PAUSED: 'bg-amber-50 text-amber-700', COMPLETED: 'bg-green-50 text-green-700', ARCHIVED: 'bg-gray-100 text-gray-500' };

  return (
    <div className="max-w-[1200px] mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold tracking-tight flex items-center gap-2">
            <FolderOpen className="w-6 h-6 text-[hsl(210,60%,45%)]" />
            Projects
          </h1>
          <p className="text-sm text-[hsl(215,10%,50%)] mt-1">Manage research projects and multi-site studies</p>
        </div>
        {['ADMIN', 'RESEARCHER'].includes(role) && (
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[hsl(210,60%,45%)] text-white text-sm font-medium hover:bg-[hsl(210,60%,38%)] transition-colors">
            <Plus className="w-4 h-4" /> New Project
          </button>
        )}
      </div>

      {showCreate && (
        <div className="bg-white rounded-xl p-5" style={{ boxShadow: 'var(--shadow-md)' }}>
          <h3 className="text-sm font-semibold mb-4">Create New Project</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Project Name</label>
              <input value={form.name} onChange={(e: any) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-[hsl(210,15%,88%)] text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(210,60%,45%)]/30" placeholder="e.g. iNPH Multicenter Registry" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Description</label>
              <input value={form.description} onChange={(e: any) => setForm({ ...form, description: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-[hsl(210,15%,88%)] text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(210,60%,45%)]/30" placeholder="Brief description" />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={createProject} className="px-4 py-2 rounded-lg bg-[hsl(210,60%,45%)] text-white text-sm font-medium hover:bg-[hsl(210,60%,38%)]">Create</button>
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-lg bg-[hsl(210,15%,93%)] text-sm hover:bg-[hsl(210,15%,88%)]">Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-24 bg-white rounded-xl animate-pulse" />)}</div>
      ) : projects.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center" style={{ boxShadow: 'var(--shadow-sm)' }}>
          <FolderOpen className="w-10 h-10 text-[hsl(215,10%,50%)] mx-auto mb-3" />
          <p className="text-sm text-[hsl(215,10%,50%)]">No projects yet. Create one to get started.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {projects.map((p: any) => (
            <button key={p.id} onClick={() => router.push(`/projects/${p.id}`)} className="w-full text-left bg-white rounded-xl p-4 hover:shadow-md transition-shadow group" style={{ boxShadow: 'var(--shadow-sm)' }}>
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-sm font-semibold truncate">{p?.name}</h3>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${statusColors[p?.status] ?? 'bg-gray-100 text-gray-700'}`}>{p?.status}</span>
                  </div>
                  <p className="text-xs text-[hsl(215,10%,50%)] truncate">{p?.description ?? 'No description'}</p>
                  <div className="flex items-center gap-4 mt-2 text-xs text-[hsl(215,10%,50%)]">
                    <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {p?._count?.patientEpisodes ?? 0} episodes</span>
                    <span className="flex items-center gap-1"><Shield className="w-3 h-3" /> {p?._count?.attestations ?? 0} attestations</span>
                    <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {p?.sites?.length ?? 0} sites</span>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-[hsl(215,10%,50%)] group-hover:text-[hsl(210,60%,45%)] transition-colors" />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
