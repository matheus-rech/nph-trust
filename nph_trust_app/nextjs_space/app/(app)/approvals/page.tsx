'use client';
import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { CheckSquare, CheckCircle2, XCircle, Clock, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';

export default function ApprovalsPage() {
  const { data: session } = useSession() || {};
  const role = (session?.user as any)?.role;
  const [approvals, setApprovals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('ALL');

  const load = () => {
    fetch('/api/approvals').then(r => r.json()).then((d: any) => setApprovals(Array.isArray(d) ? d : [])).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const review = async (id: string, status: string) => {
    const comment = prompt(`Comment for ${status.toLowerCase()}:`) ?? '';
    const res = await fetch(`/api/approvals/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status, comment }) });
    if (res.ok) { toast.success(`${status}`); load(); }
    else toast.error('Failed');
  };

  const filtered = filter === 'ALL' ? approvals : approvals.filter((a: any) => a.status === filter);

  return (
    <div className="max-w-[1200px] mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold tracking-tight flex items-center gap-2">
          <CheckSquare className="w-6 h-6 text-[hsl(210,60%,45%)]" /> Approvals
        </h1>
        <p className="text-sm text-[hsl(215,10%,50%)] mt-1">Review and manage data approval requests</p>
      </div>

      <div className="flex gap-2">
        {['ALL', 'PENDING', 'APPROVED', 'REJECTED'].map((f: string) => (
          <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${filter === f ? 'bg-[hsl(210,60%,45%)] text-white' : 'bg-[hsl(210,15%,93%)] text-[hsl(215,10%,50%)] hover:bg-[hsl(210,15%,88%)]'}`}>
            {f} {f !== 'ALL' ? `(${approvals.filter((a: any) => a.status === f).length})` : `(${approvals.length})`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-16 bg-white rounded-xl animate-pulse" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center" style={{ boxShadow: 'var(--shadow-sm)' }}>
          <CheckSquare className="w-10 h-10 text-[hsl(215,10%,50%)] mx-auto mb-3" />
          <p className="text-sm text-[hsl(215,10%,50%)]">No approvals found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((a: any) => (
            <div key={a.id} className="bg-white rounded-xl p-4" style={{ boxShadow: 'var(--shadow-sm)' }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {a.status === 'PENDING' ? <Clock className="w-5 h-5 text-amber-500" /> : a.status === 'APPROVED' ? <CheckCircle2 className="w-5 h-5 text-[#72BF78]" /> : <XCircle className="w-5 h-5 text-red-500" />}
                  <div>
                    <p className="text-sm font-medium">{a.targetType}: {a?.pathwayEvent?.stageDefinition?.name ?? a.targetId?.slice(0, 12)}</p>
                    <p className="text-xs text-[hsl(215,10%,50%)]">{a?.pathwayEvent?.patientEpisode?.pseudoId ?? ''} • {new Date(a.requestedAt).toLocaleDateString()}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${a.status === 'PENDING' ? 'bg-amber-50 text-amber-700' : a.status === 'APPROVED' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{a.status}</span>
                  {a.status === 'PENDING' && ['ADMIN', 'COORDINATOR'].includes(role) && (
                    <div className="flex gap-1">
                      <button onClick={() => review(a.id, 'APPROVED')} className="px-2 py-1 rounded bg-[#72BF78]/10 text-[#72BF78] text-xs hover:bg-[#72BF78]/20">Approve</button>
                      <button onClick={() => review(a.id, 'REJECTED')} className="px-2 py-1 rounded bg-red-50 text-red-600 text-xs hover:bg-red-100">Reject</button>
                    </div>
                  )}
                </div>
              </div>
              {a.comment && <p className="text-xs text-[hsl(215,10%,50%)] mt-2 flex items-center gap-1"><MessageSquare className="w-3 h-3" /> {a.comment}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
