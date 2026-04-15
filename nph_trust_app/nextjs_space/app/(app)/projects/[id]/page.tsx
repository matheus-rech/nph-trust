'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { FolderOpen, Users, MapPin, Plus, Brain, Shield, Download, ArrowLeft, CheckSquare } from 'lucide-react';
import { toast } from 'sonner';
import PathwayProgress from '@/components/pathway-progress';

export default function ProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { data: session } = useSession() || {};
  const role = (session?.user as any)?.role;
  const [project, setProject] = useState<any>(null);
  const [episodes, setEpisodes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddSite, setShowAddSite] = useState(false);
  const [showAddEpisode, setShowAddEpisode] = useState(false);
  const [siteForm, setSiteForm] = useState({ name: '', identifier: '' });
  const [epForm, setEpForm] = useState({ pseudoId: '', siteId: '', ageRange: '', sex: '' });

  const loadData = () => {
    Promise.all([
      fetch(`/api/projects/${params?.id}`).then(r => r.json()),
      fetch(`/api/projects/${params?.id}/episodes`).then(r => r.json()),
    ]).then(([p, ep]: any[]) => {
      setProject(p);
      setEpisodes(Array.isArray(ep) ? ep : []);
    }).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { if (params?.id) loadData(); }, [params?.id]);

  const addSite = async () => {
    const res = await fetch(`/api/projects/${params?.id}/sites`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(siteForm) });
    if (res.ok) { toast.success('Site added'); setShowAddSite(false); setSiteForm({ name: '', identifier: '' }); loadData(); }
    else toast.error('Failed to add site');
  };

  const addEpisode = async () => {
    if (!epForm.pseudoId) return;
    const res = await fetch(`/api/projects/${params?.id}/episodes`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pseudoId: epForm.pseudoId, siteId: epForm.siteId || null, metadata: { ageRange: epForm.ageRange, sex: epForm.sex } }),
    });
    if (res.ok) { toast.success('Episode created'); setShowAddEpisode(false); setEpForm({ pseudoId: '', siteId: '', ageRange: '', sex: '' }); loadData(); }
    else { const d = await res.json().catch(() => ({})); toast.error(d?.error ?? 'Failed'); }
  };

  const exportCSV = () => {
    window.open(`/api/projects/${params?.id}/export?format=csv`, '_blank');
  };

  const createCheckpoint = async () => {
    const res = await fetch(`/api/projects/${params?.id}/checkpoints`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: `Checkpoint ${new Date().toLocaleDateString()}` }) });
    if (res.ok) toast.success('Checkpoint created');
    else toast.error('Failed');
  };

  if (loading) return <div className="max-w-[1200px] mx-auto"><div className="h-48 bg-white rounded-xl animate-pulse" /></div>;

  return (
    <div className="max-w-[1200px] mx-auto space-y-6">
      <button onClick={() => router.push('/projects')} className="flex items-center gap-1 text-sm text-[hsl(215,10%,50%)] hover:text-[hsl(215,25%,15%)]">
        <ArrowLeft className="w-4 h-4" /> Back to Projects
      </button>

      {/* Project header */}
      <div className="bg-white rounded-xl p-5" style={{ boxShadow: 'var(--shadow-sm)' }}>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-display font-bold tracking-tight flex items-center gap-2">
              <FolderOpen className="w-5 h-5 text-[hsl(210,60%,45%)]" />
              {project?.name}
            </h1>
            <p className="text-sm text-[hsl(215,10%,50%)] mt-1">{project?.description ?? 'No description'}</p>
            <div className="flex items-center gap-3 mt-3 text-xs text-[hsl(215,10%,50%)]">
              <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-medium">{project?.status}</span>
              <span><Users className="w-3 h-3 inline mr-1" />{episodes.length} episodes</span>
              <span><MapPin className="w-3 h-3 inline mr-1" />{project?.sites?.length ?? 0} sites</span>
            </div>
          </div>
          <div className="flex gap-2">
            {['ADMIN', 'RESEARCHER', 'COORDINATOR'].includes(role) && (
              <button onClick={exportCSV} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[hsl(210,15%,93%)] text-sm hover:bg-[hsl(210,15%,88%)] transition-colors">
                <Download className="w-3.5 h-3.5" /> Export
              </button>
            )}
            {['ADMIN', 'COORDINATOR'].includes(role) && (
              <button onClick={createCheckpoint} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[hsl(210,15%,93%)] text-sm hover:bg-[hsl(210,15%,88%)] transition-colors">
                <CheckSquare className="w-3.5 h-3.5" /> Checkpoint
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Sites */}
      <div className="bg-white rounded-xl p-5" style={{ boxShadow: 'var(--shadow-sm)' }}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold flex items-center gap-2"><MapPin className="w-4 h-4 text-[hsl(210,60%,45%)]" /> Sites</h2>
          {['ADMIN', 'COORDINATOR'].includes(role) && (
            <button onClick={() => setShowAddSite(!showAddSite)} className="text-xs px-2 py-1 rounded bg-[hsl(210,60%,45%)] text-white hover:bg-[hsl(210,60%,38%)]"><Plus className="w-3 h-3 inline" /> Add</button>
          )}
        </div>
        {showAddSite && (
          <div className="flex gap-2 mb-3">
            <input value={siteForm.name} onChange={(e: any) => setSiteForm({ ...siteForm, name: e.target.value })} placeholder="Site name" className="flex-1 px-2 py-1.5 rounded border border-[hsl(210,15%,88%)] text-sm" />
            <input value={siteForm.identifier} onChange={(e: any) => setSiteForm({ ...siteForm, identifier: e.target.value })} placeholder="Code (e.g. SITE-01)" className="w-32 px-2 py-1.5 rounded border border-[hsl(210,15%,88%)] text-sm" />
            <button onClick={addSite} className="px-3 py-1.5 rounded bg-[hsl(210,60%,45%)] text-white text-sm">Save</button>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {(project?.sites ?? []).map((s: any) => (
            <div key={s.id} className="px-3 py-1.5 rounded-lg bg-[hsl(210,20%,98%)] text-sm">
              <span className="font-medium">{s.name}</span>
              <span className="text-[hsl(215,10%,50%)] ml-1.5 text-xs font-mono">{s.identifier}</span>
            </div>
          ))}
          {(project?.sites ?? []).length === 0 && <p className="text-sm text-[hsl(215,10%,50%)]">No sites yet</p>}
        </div>
      </div>

      {/* Episodes */}
      <div className="bg-white rounded-xl p-5" style={{ boxShadow: 'var(--shadow-sm)' }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold flex items-center gap-2"><Brain className="w-4 h-4 text-[hsl(210,60%,45%)]" /> Patient Episodes</h2>
          {['ADMIN', 'RESEARCHER', 'COORDINATOR'].includes(role) && (
            <button onClick={() => setShowAddEpisode(!showAddEpisode)} className="text-xs px-2 py-1 rounded bg-[hsl(210,60%,45%)] text-white hover:bg-[hsl(210,60%,38%)]"><Plus className="w-3 h-3 inline" /> New Episode</button>
          )}
        </div>
        {showAddEpisode && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4 p-3 rounded-lg bg-[hsl(210,20%,98%)]">
            <input value={epForm.pseudoId} onChange={(e: any) => setEpForm({ ...epForm, pseudoId: e.target.value })} placeholder="Pseudo ID *" className="px-2 py-1.5 rounded border border-[hsl(210,15%,88%)] text-sm" />
            <select value={epForm.siteId} onChange={(e: any) => setEpForm({ ...epForm, siteId: e.target.value })} className="px-2 py-1.5 rounded border border-[hsl(210,15%,88%)] text-sm">
              <option value="">No site</option>
              {(project?.sites ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <input value={epForm.ageRange} onChange={(e: any) => setEpForm({ ...epForm, ageRange: e.target.value })} placeholder="Age range" className="px-2 py-1.5 rounded border border-[hsl(210,15%,88%)] text-sm" />
            <div className="flex gap-1">
              <select value={epForm.sex} onChange={(e: any) => setEpForm({ ...epForm, sex: e.target.value })} className="flex-1 px-2 py-1.5 rounded border border-[hsl(210,15%,88%)] text-sm">
                <option value="">Sex</option><option value="M">M</option><option value="F">F</option><option value="OTHER">Other</option>
              </select>
              <button onClick={addEpisode} className="px-3 py-1.5 rounded bg-[hsl(210,60%,45%)] text-white text-sm">Add</button>
            </div>
          </div>
        )}
        <div className="space-y-2">
          {episodes.length === 0 && <p className="text-sm text-[hsl(215,10%,50%)] text-center py-4">No episodes yet</p>}
          {episodes.map((ep: any) => (
            <button key={ep.id} onClick={() => router.push(`/episodes/${ep.id}?projectId=${params?.id}`)} className="w-full text-left p-3 rounded-lg bg-[hsl(210,20%,98%)] hover:bg-[hsl(210,15%,95%)] transition-colors">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-mono font-medium">{ep?.pseudoId}</span>
                  <span className="text-xs text-[hsl(215,10%,50%)] ml-2">{ep?.site?.name ?? ''}</span>
                  <span className="text-xs text-[hsl(215,10%,50%)] ml-2">{(ep?.metadata as any)?.ageRange ?? ''} {(ep?.metadata as any)?.sex ?? ''}</span>
                </div>
                <PathwayProgress events={ep?.pathwayEvents ?? []} compact />
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
