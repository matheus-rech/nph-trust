'use client';
import { useEffect, useState } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { ArrowLeft, Brain, Shield, FileSearch, Plus, CheckCircle2, Clock, Circle, Hash, Fingerprint, Calendar, User, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import PathwayProgress from '@/components/pathway-progress';
import { PATHWAY_STAGES, STAGE_COLORS, ATTESTATION_STATUS_COLORS } from '@/lib/constants';

export default function EpisodeDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { data: session } = useSession() || {};
  const role = (session?.user as any)?.role;
  const [episode, setEpisode] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [eventForm, setEventForm] = useState({ stageType: '', status: 'COMPLETED', notes: '', data: '{}' });
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null);
  const [provenanceOpen, setProvenanceOpen] = useState(true);

  const projectId = searchParams?.get('projectId') ?? '';

  const loadEpisode = () => {
    if (!params?.id || !projectId) return;
    setLoading(true);
    fetch(`/api/projects/${projectId}/episodes/${params.id}`).then(r => r.json()).then((d: any) => setEpisode(d)).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { loadEpisode(); }, [params?.id, projectId]);

  const addEvent = async () => {
    if (!eventForm.stageType) return;
    let data = {};
    try { data = JSON.parse(eventForm.data || '{}'); } catch { data = {}; }
    const res = await fetch(`/api/projects/${projectId}/episodes/${params?.id}/events`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stageType: eventForm.stageType, status: eventForm.status, notes: eventForm.notes, data, occurredAt: new Date().toISOString(), completedAt: eventForm.status === 'COMPLETED' ? new Date().toISOString() : null, createAttestation: true }),
    });
    if (res.ok) { toast.success('Event created with attestation'); setShowAddEvent(false); setEventForm({ stageType: '', status: 'COMPLETED', notes: '', data: '{}' }); loadEpisode(); }
    else toast.error('Failed');
  };

  const requestApproval = async (eventId: string) => {
    const res = await fetch('/api/approvals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetType: 'PATHWAY_EVENT', targetId: eventId }) });
    if (res.ok) toast.success('Approval requested');
    else toast.error('Failed');
  };

  const verifyAttestation = async (attId: string) => {
    const res = await fetch(`/api/attestations/${attId}/verify`, { method: 'POST' });
    if (res.ok) { const d = await res.json(); toast.success(`Verification: ${d?.status ?? 'OK'}`); }
    else toast.error('Verification failed');
  };

  if (loading) return <div className="max-w-[1200px] mx-auto"><div className="h-48 bg-white rounded-xl animate-pulse" /></div>;

  const events = episode?.pathwayEvents ?? [];
  const usedStages = new Set(events.map((e: any) => e?.stageDefinition?.stageType));
  const availableStages = PATHWAY_STAGES.filter((s: any) => !usedStages.has(s.type));

  return (
    <div className="max-w-[1200px] mx-auto space-y-4">
      <button onClick={() => router.back()} className="flex items-center gap-1 text-sm text-[hsl(215,10%,50%)] hover:text-[hsl(215,25%,15%)]">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      {/* Episode Header */}
      <div className="bg-white rounded-xl p-5" style={{ boxShadow: 'var(--shadow-sm)' }}>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-display font-bold tracking-tight flex items-center gap-2">
              <Brain className="w-5 h-5 text-[hsl(210,60%,45%)]" />
              Episode: <span className="font-mono">{episode?.pseudoId}</span>
            </h1>
            <div className="flex items-center gap-3 mt-2 text-xs text-[hsl(215,10%,50%)]">
              {episode?.site && <span className="px-2 py-0.5 rounded bg-[hsl(210,20%,98%)]">{episode.site.name}</span>}
              <span>{(episode?.metadata as any)?.ageRange ?? ''}</span>
              <span>{(episode?.metadata as any)?.sex ?? ''}</span>
            </div>
          </div>
          {['ADMIN', 'RESEARCHER', 'COORDINATOR'].includes(role) && availableStages.length > 0 && (
            <button onClick={() => setShowAddEvent(!showAddEvent)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[hsl(210,60%,45%)] text-white text-sm hover:bg-[hsl(210,60%,38%)]">
              <Plus className="w-3.5 h-3.5" /> Add Stage
            </button>
          )}
        </div>
        <div className="mt-4">
          <PathwayProgress events={events} />
        </div>
      </div>

      {/* Add event form */}
      {showAddEvent && (
        <div className="bg-white rounded-xl p-5" style={{ boxShadow: 'var(--shadow-md)' }}>
          <h3 className="text-sm font-semibold mb-3">Record Pathway Stage</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <select value={eventForm.stageType} onChange={(e: any) => setEventForm({ ...eventForm, stageType: e.target.value })} className="px-3 py-2 rounded-lg border border-[hsl(210,15%,88%)] text-sm">
              <option value="">Select stage...</option>
              {availableStages.map((s: any) => <option key={s.type} value={s.type}>{s.name}</option>)}
            </select>
            <select value={eventForm.status} onChange={(e: any) => setEventForm({ ...eventForm, status: e.target.value })} className="px-3 py-2 rounded-lg border border-[hsl(210,15%,88%)] text-sm">
              <option value="COMPLETED">Completed</option><option value="IN_PROGRESS">In Progress</option><option value="PENDING">Pending</option><option value="SKIPPED">Skipped</option>
            </select>
            <input value={eventForm.notes} onChange={(e: any) => setEventForm({ ...eventForm, notes: e.target.value })} placeholder="Notes" className="px-3 py-2 rounded-lg border border-[hsl(210,15%,88%)] text-sm" />
            <input value={eventForm.data} onChange={(e: any) => setEventForm({ ...eventForm, data: e.target.value })} placeholder='JSON data e.g. {"gaitScore": 3}' className="px-3 py-2 rounded-lg border border-[hsl(210,15%,88%)] text-sm font-mono" />
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={addEvent} className="px-4 py-2 rounded-lg bg-[hsl(210,60%,45%)] text-white text-sm font-medium">Record & Attest</button>
            <button onClick={() => setShowAddEvent(false)} className="px-4 py-2 rounded-lg bg-[hsl(210,15%,93%)] text-sm">Cancel</button>
          </div>
        </div>
      )}

      {/* Split pane: events + provenance */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Events timeline */}
        <div className="lg:col-span-2 space-y-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Clock className="w-4 h-4 text-[hsl(210,60%,45%)]" /> Pathway Timeline
          </h2>
          {events.length === 0 && <p className="text-sm text-[hsl(215,10%,50%)] bg-white rounded-xl p-6 text-center" style={{ boxShadow: 'var(--shadow-sm)' }}>No events recorded yet</p>}
          {events.map((ev: any) => {
            const stColor = STAGE_COLORS[ev?.stageDefinition?.stageType] ?? '#94a3b8';
            const isExpanded = expandedEvent === ev.id;
            return (
              <div key={ev.id} className="bg-white rounded-xl overflow-hidden transition-shadow hover:shadow-md" style={{ boxShadow: 'var(--shadow-sm)', borderLeft: `3px solid ${stColor}` }}>
                <button onClick={() => setExpandedEvent(isExpanded ? null : ev.id)} className="w-full text-left p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${stColor}15` }}>
                        {ev.status === 'COMPLETED' ? <CheckCircle2 className="w-4 h-4" style={{ color: stColor }} /> : <Clock className="w-4 h-4" style={{ color: stColor }} />}
                      </div>
                      <div>
                        <p className="text-sm font-semibold">{ev?.stageDefinition?.name}</p>
                        <p className="text-xs text-[hsl(215,10%,50%)]">{ev.status} {ev.completedAt ? `• ${new Date(ev.completedAt).toLocaleDateString()}` : ''}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {(ev?.attestations?.length ?? 0) > 0 && <Shield className="w-4 h-4 text-[#72BF78]" />}
                      {(ev?.approvals ?? []).some((a: any) => a.status === 'APPROVED') && <div className="w-2 h-2 rounded-full bg-[#72BF78]" title="Approved" />}
                      {isExpanded ? <ChevronUp className="w-4 h-4 text-[hsl(215,10%,50%)]" /> : <ChevronDown className="w-4 h-4 text-[hsl(215,10%,50%)]" />}
                    </div>
                  </div>
                </button>
                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-[hsl(210,15%,92%)] pt-3 space-y-3">
                    {ev.notes && <p className="text-sm text-[hsl(215,10%,50%)]">{ev.notes}</p>}
                    {ev.data && (
                      <div className="p-3 rounded-lg bg-[hsl(210,20%,98%)]">
                        <p className="text-xs font-medium mb-1">Stage Data</p>
                        <pre className="text-xs font-mono text-[hsl(215,10%,50%)] overflow-x-auto">{JSON.stringify(ev.data, null, 2)}</pre>
                      </div>
                    )}
                    {/* Attestations for this event */}
                    {(ev?.attestations ?? []).map((att: any) => (
                      <div key={att.id} className="p-3 rounded-lg bg-[hsl(210,20%,98%)] space-y-1">
                        <div className="flex items-center gap-2">
                          <Shield className="w-3.5 h-3.5" style={{ color: ATTESTATION_STATUS_COLORS[att.status] ?? '#94a3b8' }} />
                          <span className="text-xs font-medium">Attestation: {att.status}</span>
                          <button onClick={() => verifyAttestation(att.id)} className="ml-auto text-xs px-2 py-0.5 rounded bg-[hsl(210,60%,45%)] text-white hover:bg-[hsl(210,60%,38%)]">Verify</button>
                        </div>
                        <p className="text-[10px] font-mono text-[hsl(215,10%,50%)] truncate">{att.payloadHash}</p>
                      </div>
                    ))}
                    <div className="flex gap-2">
                      {['ADMIN', 'RESEARCHER', 'COORDINATOR'].includes(role) && (
                        <button onClick={() => requestApproval(ev.id)} className="text-xs px-3 py-1 rounded-lg bg-[hsl(210,15%,93%)] hover:bg-[hsl(210,15%,88%)]">
                          Request Approval
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Provenance sidebar */}
        <div className="space-y-3">
          <button onClick={() => setProvenanceOpen(!provenanceOpen)} className="text-sm font-semibold flex items-center gap-2 w-full">
            <FileSearch className="w-4 h-4 text-[hsl(210,60%,45%)]" /> Provenance Inspector
            {provenanceOpen ? <ChevronUp className="w-3 h-3 ml-auto" /> : <ChevronDown className="w-3 h-3 ml-auto" />}
          </button>
          {provenanceOpen && (
            <div className="bg-white rounded-xl p-4 space-y-4" style={{ boxShadow: 'var(--shadow-sm)' }}>
              <div>
                <p className="text-xs font-medium text-[hsl(215,10%,50%)] mb-2 flex items-center gap-1"><Fingerprint className="w-3 h-3" /> Episode ID</p>
                <p className="text-xs font-mono bg-[hsl(210,20%,98%)] p-2 rounded">{episode?.id}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-[hsl(215,10%,50%)] mb-2 flex items-center gap-1"><Hash className="w-3 h-3" /> Attestations ({events.flatMap((e: any) => e?.attestations ?? []).length})</p>
                {events.flatMap((e: any) => (e?.attestations ?? []).map((a: any) => ({ ...a, stageName: e?.stageDefinition?.name }))).map((att: any) => (
                  <div key={att.id} className="p-2 rounded-lg bg-[hsl(210,20%,98%)] mb-1.5">
                    <div className="flex items-center gap-1.5 mb-1">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: ATTESTATION_STATUS_COLORS[att.status] ?? '#94a3b8' }} />
                      <span className="text-[10px] font-medium">{att.stageName}</span>
                      <span className="text-[10px] text-[hsl(215,10%,50%)] ml-auto">{att.status}</span>
                    </div>
                    <p className="text-[9px] font-mono text-[hsl(215,10%,50%)] truncate" title={att.payloadHash}>{att.payloadHash}</p>
                  </div>
                ))}
              </div>
              <div>
                <p className="text-xs font-medium text-[hsl(215,10%,50%)] mb-2">FHIR Resources ({episode?.fhirResources?.length ?? 0})</p>
                {(episode?.fhirResources ?? []).slice(0, 5).map((r: any) => (
                  <div key={r.id} className="text-[10px] font-mono p-1.5 rounded bg-[hsl(210,20%,98%)] mb-1">
                    {r.resourceType} v{r.version}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
