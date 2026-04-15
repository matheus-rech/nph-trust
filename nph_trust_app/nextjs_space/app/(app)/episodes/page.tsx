'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Brain, Search } from 'lucide-react';
import PathwayProgress from '@/components/pathway-progress';

export default function EpisodesPage() {
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProject, setSelectedProject] = useState('');
  const [episodes, setEpisodes] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    fetch('/api/projects').then(r => r.json()).then((d: any) => {
      const p = Array.isArray(d) ? d : [];
      setProjects(p);
      if (p.length > 0) setSelectedProject(p[0]?.id ?? '');
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedProject) return;
    setLoading(true);
    fetch(`/api/projects/${selectedProject}/episodes`).then(r => r.json()).then((d: any) => setEpisodes(Array.isArray(d) ? d : [])).catch(() => {}).finally(() => setLoading(false));
  }, [selectedProject]);

  const filtered = episodes.filter((ep: any) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return ep?.pseudoId?.toLowerCase()?.includes(s) || ep?.site?.name?.toLowerCase()?.includes(s);
  });

  return (
    <div className="max-w-[1200px] mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold tracking-tight flex items-center gap-2">
          <Brain className="w-6 h-6 text-[hsl(210,60%,45%)]" /> Patient Episodes
        </h1>
        <p className="text-sm text-[hsl(215,10%,50%)] mt-1">Track de-identified patient episodes through the iNPH pathway</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        {projects.length > 1 && (
          <select value={selectedProject} onChange={(e: any) => setSelectedProject(e.target.value)} className="px-3 py-2 rounded-lg border border-[hsl(210,15%,88%)] bg-white text-sm">
            {projects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[hsl(215,10%,50%)]" />
          <input value={search} onChange={(e: any) => setSearch(e.target.value)} placeholder="Search episodes..." className="w-full pl-10 pr-3 py-2 rounded-lg border border-[hsl(210,15%,88%)] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(210,60%,45%)]/30" />
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">{[1,2,3,4,5].map(i => <div key={i} className="h-14 bg-white rounded-lg animate-pulse" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center" style={{ boxShadow: 'var(--shadow-sm)' }}>
          <Brain className="w-10 h-10 text-[hsl(215,10%,50%)] mx-auto mb-3" />
          <p className="text-sm text-[hsl(215,10%,50%)]">No episodes found</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl overflow-hidden" style={{ boxShadow: 'var(--shadow-sm)' }}>
          <table className="w-full">
            <thead>
              <tr className="border-b border-[hsl(210,15%,88%)] bg-[hsl(210,20%,98%)]">
                <th className="text-left text-xs font-medium text-[hsl(215,10%,50%)] px-4 py-3">Pseudo ID</th>
                <th className="text-left text-xs font-medium text-[hsl(215,10%,50%)] px-4 py-3 hidden sm:table-cell">Site</th>
                <th className="text-left text-xs font-medium text-[hsl(215,10%,50%)] px-4 py-3 hidden md:table-cell">Demographics</th>
                <th className="text-left text-xs font-medium text-[hsl(215,10%,50%)] px-4 py-3">Pathway</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((ep: any) => (
                <tr key={ep.id} onClick={() => router.push(`/episodes/${ep.id}?projectId=${selectedProject}`)} className="border-b border-[hsl(210,15%,92%)] hover:bg-[hsl(210,20%,98%)] cursor-pointer transition-colors">
                  <td className="px-4 py-3 text-sm font-mono font-medium">{ep?.pseudoId}</td>
                  <td className="px-4 py-3 text-sm text-[hsl(215,10%,50%)] hidden sm:table-cell">{ep?.site?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-xs text-[hsl(215,10%,50%)] hidden md:table-cell">{(ep?.metadata as any)?.ageRange ?? ''} {(ep?.metadata as any)?.sex ?? ''}</td>
                  <td className="px-4 py-3"><PathwayProgress events={ep?.pathwayEvents ?? []} compact /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
