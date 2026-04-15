'use client';
import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  FileSearch, Shield, Hash, Fingerprint, Calendar, CheckCircle2, AlertTriangle,
  Search, Download, GitBranch, ArrowRight, Box, Zap, FileOutput, FileInput,
  ChevronDown, ChevronRight, Activity, Link2, Target, BarChart3, X, ArrowUp,
} from 'lucide-react';
import { ATTESTATION_STATUS_COLORS } from '@/lib/constants';
import { toast } from 'sonner';

const NODE_TYPE_META: Record<string, { label: string; color: string; icon: any; bg: string }> = {
  INPUT:       { label: 'Input',       color: '#3b82f6', icon: FileInput,  bg: '#eff6ff' },
  TRANSFORM:   { label: 'Transform',   color: '#8b5cf6', icon: Zap,        bg: '#f5f3ff' },
  OUTPUT:      { label: 'Output',      color: '#10b981', icon: FileOutput, bg: '#ecfdf5' },
  ATTESTATION: { label: 'Attestation', color: '#f59e0b', icon: Shield,     bg: '#fffbeb' },
  EVENT:       { label: 'Event',       color: '#ef4444', icon: Activity,   bg: '#fef2f2' },
};

type TabId = 'attestations' | 'graph' | 'traceability';

export default function ProvenancePage() {
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProject, setSelectedProject] = useState('');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedAtt, setSelectedAtt] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<TabId>('graph');
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [nodeTypeFilter, setNodeTypeFilter] = useState<string>('ALL');

  // Lineage trace state
  const [lineageData, setLineageData] = useState<any>(null);
  const [lineageLoading, setLineageLoading] = useState(false);
  const [lineageTarget, setLineageTarget] = useState<{ entityType: string; entityId: string; label: string } | null>(null);
  const [highlightedNodeIds, setHighlightedNodeIds] = useState<Set<string>>(new Set());

  // Traceability report state
  const [traceReport, setTraceReport] = useState<any>(null);
  const [traceLoading, setTraceLoading] = useState(false);

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
    setLineageData(null);
    setLineageTarget(null);
    setHighlightedNodeIds(new Set());
    setTraceReport(null);
    fetch(`/api/projects/${selectedProject}/provenance`).then(r => r.json()).then((d: any) => setData(d)).catch(() => {}).finally(() => setLoading(false));
  }, [selectedProject]);

  // Fetch traceability report when tab is activated
  useEffect(() => {
    if (activeTab === 'traceability' && selectedProject && !traceReport) {
      setTraceLoading(true);
      fetch(`/api/projects/${selectedProject}/provenance/trace`)
        .then(r => r.json())
        .then(d => setTraceReport(d))
        .catch(() => toast.error('Failed to load traceability report'))
        .finally(() => setTraceLoading(false));
    }
  }, [activeTab, selectedProject, traceReport]);

  const fetchLineage = useCallback(async (entityType: string, entityId: string, label: string) => {
    if (!selectedProject) return;
    setLineageLoading(true);
    setLineageTarget({ entityType, entityId, label });
    try {
      const res = await fetch(`/api/projects/${selectedProject}/provenance/lineage?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}&maxDepth=10`);
      const d = await res.json();
      setLineageData(d);
      // Highlight all ancestor node IDs + the target nodes themselves
      const ids = new Set<string>();
      (d.nodes ?? []).forEach((n: any) => ids.add(n.id));
      setHighlightedNodeIds(ids);
    } catch {
      toast.error('Failed to fetch lineage');
    } finally {
      setLineageLoading(false);
    }
  }, [selectedProject]);

  const clearLineage = () => {
    setLineageData(null);
    setLineageTarget(null);
    setHighlightedNodeIds(new Set());
  };

  const verifyAttestation = async (attId: string) => {
    const res = await fetch(`/api/attestations/${attId}/verify`, { method: 'POST' });
    if (res.ok) { const d = await res.json(); toast.success(`Verification: ${d?.status}`); }
    else toast.error('Verification failed');
  };

  const exportAttestations = () => {
    window.open(`/api/projects/${selectedProject}/attestations/export`, '_blank');
  };

  const attestations = data?.attestations ?? [];
  const artifacts = data?.artifacts ?? [];
  const graphNodes = data?.provenanceGraph?.nodes ?? [];
  const graphEdges = data?.provenanceGraph?.edges ?? [];

  const { edgeMap, incomingMap, nodeMap } = useMemo(() => {
    const nm = new Map<string, any>();
    graphNodes.forEach((n: any) => nm.set(n.id, n));
    const em = new Map<string, any[]>();
    const im = new Map<string, any[]>();
    graphEdges.forEach((e: any) => {
      if (!em.has(e.sourceId)) em.set(e.sourceId, []);
      em.get(e.sourceId)!.push(e);
      if (!im.has(e.targetId)) im.set(e.targetId, []);
      im.get(e.targetId)!.push(e);
    });
    return { edgeMap: em, incomingMap: im, nodeMap: nm };
  }, [graphNodes, graphEdges]);

  const nodeTypeCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: graphNodes.length };
    graphNodes.forEach((n: any) => { counts[n.nodeType] = (counts[n.nodeType] || 0) + 1; });
    return counts;
  }, [graphNodes]);

  const filteredNodes = useMemo(() => {
    let nodes = graphNodes;
    if (nodeTypeFilter !== 'ALL') {
      nodes = nodes.filter((n: any) => n.nodeType === nodeTypeFilter);
    }
    if (search) {
      const s = search.toLowerCase();
      nodes = nodes.filter((n: any) =>
        n.label?.toLowerCase()?.includes(s) ||
        n.entityType?.toLowerCase()?.includes(s) ||
        n.entityId?.toLowerCase()?.includes(s) ||
        n.nodeType?.toLowerCase()?.includes(s)
      );
    }
    return nodes;
  }, [graphNodes, nodeTypeFilter, search]);

  const filteredAtts = attestations.filter((a: any) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return a?.payloadHash?.toLowerCase()?.includes(s) || a?.subjectType?.toLowerCase()?.includes(s) || a?.pathwayEvent?.patientEpisode?.pseudoId?.toLowerCase()?.includes(s) || a?.eventType?.toLowerCase()?.includes(s);
  });

  const toggleNode = (id: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const getNodeEdges = (nodeId: string) => {
    const outgoing = edgeMap.get(nodeId) ?? [];
    const incoming = incomingMap.get(nodeId) ?? [];
    return { outgoing, incoming };
  };

  return (
    <div className="max-w-[1200px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold tracking-tight flex items-center gap-2">
            <FileSearch className="w-6 h-6 text-[hsl(210,60%,45%)]" /> Provenance Inspector
          </h1>
          <p className="text-sm text-[hsl(215,10%,50%)] mt-1">Full pipeline provenance: artifacts, transformations, events, attestations, and chain status</p>
        </div>
        <button onClick={exportAttestations} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[hsl(210,15%,93%)] text-sm hover:bg-[hsl(210,15%,88%)]">
          <Download className="w-3.5 h-3.5" /> Export JSON
        </button>
      </div>

      {/* Project selector + search */}
      <div className="flex gap-3">
        {projects.length > 1 && (
          <select value={selectedProject} onChange={(e: any) => setSelectedProject(e.target.value)} className="px-3 py-2 rounded-lg border border-[hsl(210,15%,88%)] bg-white text-sm">
            {projects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[hsl(215,10%,50%)]" />
          <input value={search} onChange={(e: any) => setSearch(e.target.value)} placeholder="Search nodes, hashes, subjects..." className="w-full pl-10 pr-3 py-2 rounded-lg border border-[hsl(210,15%,88%)] bg-white text-sm" />
        </div>
      </div>

      {/* Tab selector */}
      <div className="flex gap-1 bg-[hsl(210,15%,95%)] p-1 rounded-lg w-fit">
        <button
          onClick={() => setActiveTab('graph')}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${activeTab === 'graph' ? 'bg-white shadow-sm text-[hsl(210,60%,45%)]' : 'text-[hsl(215,10%,50%)] hover:text-[hsl(215,10%,30%)]'}`}
        >
          <GitBranch className="w-3.5 h-3.5 inline mr-1.5" />Graph ({graphNodes.length})
        </button>
        <button
          onClick={() => setActiveTab('attestations')}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${activeTab === 'attestations' ? 'bg-white shadow-sm text-[hsl(210,60%,45%)]' : 'text-[hsl(215,10%,50%)] hover:text-[hsl(215,10%,30%)]'}`}
        >
          <Shield className="w-3.5 h-3.5 inline mr-1.5" />Attestations ({attestations.length})
        </button>
        <button
          onClick={() => setActiveTab('traceability')}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${activeTab === 'traceability' ? 'bg-white shadow-sm text-[hsl(210,60%,45%)]' : 'text-[hsl(215,10%,50%)] hover:text-[hsl(215,10%,30%)]'}`}
        >
          <BarChart3 className="w-3.5 h-3.5 inline mr-1.5" />Traceability
        </button>
      </div>

      {/* LINEAGE TRACE PANEL — shown when active across graph tab */}
      {lineageTarget && activeTab === 'graph' && (
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-4 border border-blue-100" style={{ boxShadow: 'var(--shadow-sm)' }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Target className="w-4 h-4 text-blue-600" />
              <span className="text-sm font-semibold text-blue-900">Lineage Trace</span>
              <span className="text-xs text-blue-600 font-mono bg-blue-100 px-2 py-0.5 rounded">{lineageTarget.label}</span>
            </div>
            <button onClick={clearLineage} className="p-1 rounded hover:bg-blue-100 transition-colors">
              <X className="w-4 h-4 text-blue-600" />
            </button>
          </div>
          {lineageLoading ? (
            <div className="flex items-center gap-2 text-sm text-blue-600">
              <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              Tracing ancestors...
            </div>
          ) : lineageData ? (
            <div className="space-y-3">
              <div className="flex gap-4 text-xs">
                <span className="text-blue-700"><strong>{lineageData.nodeCount ?? 0}</strong> nodes in lineage</span>
                <span className="text-blue-700"><strong>{lineageData.edgeCount ?? 0}</strong> edges traversed</span>
                <span className="text-blue-700"><strong>{lineageData.ancestorCount ?? 0}</strong> ancestors found</span>
              </div>
              {/* Ancestor chain visualization */}
              {(lineageData.ancestors ?? []).length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] font-semibold text-blue-700 uppercase tracking-wider">Ancestor Chain (oldest → newest)</p>
                  <div className="flex flex-wrap gap-1.5 items-center">
                    {(lineageData.ancestors ?? []).map((anc: any, idx: number) => {
                      const am = NODE_TYPE_META[anc.nodeType] ?? { label: anc.nodeType, color: '#94a3b8', bg: '#f8fafc' };
                      return (
                        <span key={anc.id || idx} className="inline-flex items-center gap-1">
                          {idx > 0 && <ArrowRight className="w-3 h-3 text-blue-300 flex-shrink-0" />}
                          <span
                            className="text-[10px] font-medium px-2 py-1 rounded-md border"
                            style={{ backgroundColor: am.bg, color: am.color, borderColor: am.color + '30' }}
                            title={`${anc.entityType}:${anc.entityId}`}
                          >
                            {am.label}: {anc.label || anc.entityType}
                          </span>
                        </span>
                      );
                    })}
                    <span className="inline-flex items-center gap-1">
                      <ArrowRight className="w-3 h-3 text-blue-300 flex-shrink-0" />
                      <span className="text-[10px] font-bold px-2 py-1 rounded-md bg-blue-600 text-white">
                        {lineageTarget.label}
                      </span>
                    </span>
                  </div>
                </div>
              )}
              {(lineageData.ancestors ?? []).length === 0 && (
                <p className="text-xs text-blue-600">This is a root node — no ancestors found.</p>
              )}
              <p className="text-[10px] text-blue-500">Nodes in the lineage are highlighted below with a blue border.</p>
            </div>
          ) : null}
        </div>
      )}

      {/* GRAPH TAB */}
      {activeTab === 'graph' && (
        <div className="space-y-4">
          {/* Node type filter pills */}
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setNodeTypeFilter('ALL')}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                nodeTypeFilter === 'ALL' ? 'bg-[hsl(210,60%,45%)] text-white' : 'bg-[hsl(210,15%,93%)] text-[hsl(215,10%,50%)] hover:bg-[hsl(210,15%,88%)]'
              }`}
            >
              All ({nodeTypeCounts['ALL'] ?? 0})
            </button>
            {Object.entries(NODE_TYPE_META).map(([type, meta]) => (
              <button
                key={type}
                onClick={() => setNodeTypeFilter(type)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-all flex items-center gap-1 ${
                  nodeTypeFilter === type
                    ? 'text-white'
                    : 'bg-[hsl(210,15%,93%)] text-[hsl(215,10%,50%)] hover:bg-[hsl(210,15%,88%)]'
                }`}
                style={nodeTypeFilter === type ? { backgroundColor: meta.color } : undefined}
              >
                <meta.icon className="w-3 h-3" />
                {meta.label} ({nodeTypeCounts[type] ?? 0})
              </button>
            ))}
          </div>

          {/* Graph summary stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white rounded-xl p-3" style={{ boxShadow: 'var(--shadow-sm)' }}>
              <p className="text-[10px] text-[hsl(215,10%,50%)] uppercase tracking-wider">Nodes</p>
              <p className="text-lg font-bold">{graphNodes.length}</p>
            </div>
            <div className="bg-white rounded-xl p-3" style={{ boxShadow: 'var(--shadow-sm)' }}>
              <p className="text-[10px] text-[hsl(215,10%,50%)] uppercase tracking-wider">Edges</p>
              <p className="text-lg font-bold">{graphEdges.length}</p>
            </div>
            <div className="bg-white rounded-xl p-3" style={{ boxShadow: 'var(--shadow-sm)' }}>
              <p className="text-[10px] text-[hsl(215,10%,50%)] uppercase tracking-wider">Artifacts</p>
              <p className="text-lg font-bold">{artifacts.length}</p>
            </div>
            <div className="bg-white rounded-xl p-3" style={{ boxShadow: 'var(--shadow-sm)' }}>
              <p className="text-[10px] text-[hsl(215,10%,50%)] uppercase tracking-wider">Attestations</p>
              <p className="text-lg font-bold">{attestations.length}</p>
            </div>
          </div>

          {/* Node list (DAG table) */}
          {loading ? (
            <div className="space-y-2">{[1,2,3,4].map(i => <div key={i} className="h-16 bg-white rounded-xl animate-pulse" />)}</div>
          ) : filteredNodes.length === 0 ? (
            <div className="bg-white rounded-xl p-8 text-center" style={{ boxShadow: 'var(--shadow-sm)' }}>
              <GitBranch className="w-10 h-10 text-[hsl(215,10%,50%)] mx-auto mb-3" />
              <p className="text-sm text-[hsl(215,10%,50%)]">{graphNodes.length === 0 ? 'No provenance data yet — execute pipeline actions to populate the graph' : 'No matching nodes'}</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {filteredNodes.map((node: any) => {
                const meta = NODE_TYPE_META[node.nodeType] ?? { label: node.nodeType, color: '#94a3b8', icon: Box, bg: '#f8fafc' };
                const Icon = meta.icon;
                const isExpanded = expandedNodes.has(node.id);
                const { outgoing, incoming } = getNodeEdges(node.id);
                const hasEdges = outgoing.length > 0 || incoming.length > 0;
                const isHighlighted = highlightedNodeIds.has(node.id);

                return (
                  <div
                    key={node.id}
                    className={`bg-white rounded-xl overflow-hidden transition-all ${
                      isHighlighted ? 'ring-2 ring-blue-400 ring-offset-1' : ''
                    }`}
                    style={{ boxShadow: 'var(--shadow-sm)' }}
                  >
                    <button
                      onClick={() => toggleNode(node.id)}
                      className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-[hsl(210,20%,98%)] transition-colors"
                    >
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: meta.bg }}>
                        <Icon className="w-4 h-4" style={{ color: meta.color }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ backgroundColor: meta.bg, color: meta.color }}>
                            {meta.label}
                          </span>
                          <span className="text-sm font-medium truncate">{node.label || node.entityType}</span>
                          {isHighlighted && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-medium">IN LINEAGE</span>
                          )}
                        </div>
                        <p className="text-[10px] font-mono text-[hsl(215,10%,50%)] truncate mt-0.5">
                          {node.entityType}:{node.entityId?.slice(0, 20)}{node.entityId?.length > 20 ? '...' : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        {node.attestation && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium" style={{ backgroundColor: `${ATTESTATION_STATUS_COLORS[node.attestation.status]}20`, color: ATTESTATION_STATUS_COLORS[node.attestation.status] }}>
                            {node.attestation.status}
                          </span>
                        )}
                        {hasEdges && (
                          <span className="text-[10px] text-[hsl(215,10%,50%)] flex items-center gap-0.5">
                            <Link2 className="w-3 h-3" />{incoming.length + outgoing.length}
                          </span>
                        )}
                        {node.metadata?.backfilled && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 font-medium">
                            BACKFILLED
                          </span>
                        )}
                        {node.runLog && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-[hsl(210,15%,95%)] text-[hsl(215,10%,50%)] font-mono">
                            {node.runLog.action?.split('.')?.pop()}
                          </span>
                        )}
                        <span className="text-[10px] text-[hsl(215,10%,50%)]">{new Date(node.timestamp).toLocaleString()}</span>
                        {isExpanded ? <ChevronDown className="w-4 h-4 text-[hsl(215,10%,50%)]" /> : <ChevronRight className="w-4 h-4 text-[hsl(215,10%,50%)]" />}
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="px-4 pb-3 border-t border-[hsl(210,15%,93%)] pt-3 space-y-3">
                        {/* Lineage trace button */}
                        <div className="flex gap-2">
                          <button
                            onClick={(e) => { e.stopPropagation(); fetchLineage(node.entityType, node.entityId, node.label || node.entityType); }}
                            disabled={lineageLoading}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 text-xs font-medium hover:bg-blue-100 transition-colors disabled:opacity-50"
                          >
                            <ArrowUp className="w-3 h-3" />
                            {lineageLoading && lineageTarget?.entityId === node.entityId ? 'Tracing...' : 'Trace Lineage'}
                          </button>
                        </div>

                        {/* Node details */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                          <div>
                            <p className="text-[10px] text-[hsl(215,10%,50%)] mb-0.5">Entity Type</p>
                            <p className="font-mono">{node.entityType}</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-[hsl(215,10%,50%)] mb-0.5">Entity ID</p>
                            <p className="font-mono break-all">{node.entityId}</p>
                          </div>
                          {node.attestation && (
                            <div>
                              <p className="text-[10px] text-[hsl(215,10%,50%)] mb-0.5">Attestation Hash</p>
                              <p className="font-mono break-all text-[10px]">{node.attestation.payloadHash}</p>
                            </div>
                          )}
                          {node.runLog && (
                            <div>
                              <p className="text-[10px] text-[hsl(215,10%,50%)] mb-0.5">Run Log</p>
                              <p className="font-mono">{node.runLog.action}</p>
                              <p className="text-[10px] text-[hsl(215,10%,50%)]">{node.runLog.status}</p>
                            </div>
                          )}
                          {node.metadata?.backfilled && (
                            <div className="col-span-2 bg-amber-50 rounded p-2 border border-amber-100">
                              <p className="text-[10px] font-semibold text-amber-700 mb-1">RETROSPECTIVE (Backfilled)</p>
                              <div className="grid grid-cols-2 gap-1 text-[10px]">
                                <span className="text-amber-600">Source:</span><span>{node.metadata.backfillSource}</span>
                                <span className="text-amber-600">Confidence:</span><span>{node.metadata.confidence}</span>
                                {node.metadata.originalTimestamp && (<><span className="text-amber-600">Original time:</span><span>{new Date(node.metadata.originalTimestamp as string).toLocaleString()}</span></>)}
                                {node.metadata.completenessNote && (<><span className="text-amber-600">Note:</span><span className="col-span-1">{node.metadata.completenessNote}</span></>)}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Edges */}
                        {(incoming.length > 0 || outgoing.length > 0) && (
                          <div className="space-y-2">
                            {incoming.length > 0 && (
                              <div>
                                <p className="text-[10px] font-semibold text-[hsl(215,10%,50%)] mb-1">&larr; Incoming ({incoming.length})</p>
                                <div className="space-y-1">
                                  {incoming.map((e: any) => {
                                    const srcNode = nodeMap.get(e.sourceId);
                                    const srcMeta = NODE_TYPE_META[srcNode?.nodeType] ?? { label: '?', color: '#94a3b8', icon: Box, bg: '#f8fafc' };
                                    return (
                                      <div key={e.id} className="flex items-center gap-2 text-xs bg-[hsl(210,20%,98%)] rounded px-2 py-1">
                                        <span className="text-[9px] font-semibold uppercase px-1 py-0.5 rounded" style={{ backgroundColor: srcMeta.bg, color: srcMeta.color }}>{srcMeta.label}</span>
                                        <span className="truncate font-mono text-[10px]">{srcNode?.label || srcNode?.entityType || e.sourceId?.slice(0, 12)}</span>
                                        <ArrowRight className="w-3 h-3 text-[hsl(215,10%,50%)] flex-shrink-0" />
                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[hsl(210,15%,90%)] text-[hsl(215,10%,50%)]">{e.edgeType}</span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                            {outgoing.length > 0 && (
                              <div>
                                <p className="text-[10px] font-semibold text-[hsl(215,10%,50%)] mb-1">&rarr; Outgoing ({outgoing.length})</p>
                                <div className="space-y-1">
                                  {outgoing.map((e: any) => {
                                    const tgtNode = nodeMap.get(e.targetId);
                                    const tgtMeta = NODE_TYPE_META[tgtNode?.nodeType] ?? { label: '?', color: '#94a3b8', icon: Box, bg: '#f8fafc' };
                                    return (
                                      <div key={e.id} className="flex items-center gap-2 text-xs bg-[hsl(210,20%,98%)] rounded px-2 py-1">
                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[hsl(210,15%,90%)] text-[hsl(215,10%,50%)]">{e.edgeType}</span>
                                        <ArrowRight className="w-3 h-3 text-[hsl(215,10%,50%)] flex-shrink-0" />
                                        <span className="text-[9px] font-semibold uppercase px-1 py-0.5 rounded" style={{ backgroundColor: tgtMeta.bg, color: tgtMeta.color }}>{tgtMeta.label}</span>
                                        <span className="truncate font-mono text-[10px]">{tgtNode?.label || tgtNode?.entityType || e.targetId?.slice(0, 12)}</span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ATTESTATIONS TAB */}
      {activeTab === 'attestations' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Attestation list */}
          <div className="lg:col-span-2 space-y-3">
            <h2 className="text-sm font-semibold flex items-center gap-2"><Shield className="w-4 h-4 text-[hsl(210,60%,45%)]" /> Attestation Records ({filteredAtts.length})</h2>
            {loading ? (
              <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-20 bg-white rounded-xl animate-pulse" />)}</div>
            ) : filteredAtts.length === 0 ? (
              <div className="bg-white rounded-xl p-8 text-center" style={{ boxShadow: 'var(--shadow-sm)' }}>
                <Shield className="w-10 h-10 text-[hsl(215,10%,50%)] mx-auto mb-3" />
                <p className="text-sm text-[hsl(215,10%,50%)]">No attestations found</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredAtts.map((att: any) => (
                  <button key={att.id} onClick={() => setSelectedAtt(att)} className={`w-full text-left bg-white rounded-xl p-4 transition-all hover:shadow-md ${selectedAtt?.id === att.id ? 'ring-2 ring-[hsl(210,60%,45%)]/30' : ''}`} style={{ boxShadow: 'var(--shadow-sm)' }}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: ATTESTATION_STATUS_COLORS[att.status] ?? '#94a3b8' }} />
                        <div>
                          <p className="text-sm font-medium">{att?.eventType ?? att?.subjectType}</p>
                          <p className="text-[10px] font-mono text-[hsl(215,10%,50%)] truncate max-w-[300px]">{att.payloadHash}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: `${ATTESTATION_STATUS_COLORS[att.status]}20`, color: ATTESTATION_STATUS_COLORS[att.status] }}>{att.status}</span>
                        {att?.pathwayEvent?.patientEpisode?.pseudoId && (
                          <span className="text-xs text-[hsl(215,10%,50%)] font-mono">{att.pathwayEvent.patientEpisode.pseudoId}</span>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Inspector panel */}
          <div className="space-y-4">
            <h2 className="text-sm font-semibold flex items-center gap-2"><Fingerprint className="w-4 h-4 text-[hsl(210,60%,45%)]" /> Inspector</h2>
            {selectedAtt ? (
              <div className="bg-white rounded-xl p-4 space-y-4" style={{ boxShadow: 'var(--shadow-sm)' }}>
                <div>
                  <p className="text-[10px] text-[hsl(215,10%,50%)] mb-1">STATUS</p>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: ATTESTATION_STATUS_COLORS[selectedAtt.status] }} />
                    <span className="text-sm font-semibold">{selectedAtt.status}</span>
                  </div>
                </div>
                <div>
                  <p className="text-[10px] text-[hsl(215,10%,50%)] mb-1">EVENT TYPE</p>
                  <p className="text-xs font-mono">{selectedAtt.eventType}</p>
                </div>
                <div>
                  <p className="text-[10px] text-[hsl(215,10%,50%)] mb-1 flex items-center gap-1"><Hash className="w-3 h-3" /> PAYLOAD HASH (SHA-256)</p>
                  <p className="text-[10px] font-mono bg-[hsl(210,20%,98%)] p-2 rounded break-all">{selectedAtt.payloadHash}</p>
                </div>
                <div>
                  <p className="text-[10px] text-[hsl(215,10%,50%)] mb-1 flex items-center gap-1"><Shield className="w-3 h-3" /> SIGNATURE ({selectedAtt.signatureAlgo})</p>
                  <p className="text-[10px] font-mono bg-[hsl(210,20%,98%)] p-2 rounded break-all">{selectedAtt.signature}</p>
                </div>
                <div>
                  <p className="text-[10px] text-[hsl(215,10%,50%)] mb-1">SIGNER</p>
                  <p className="text-xs">{selectedAtt.signerId}</p>
                </div>
                <div>
                  <p className="text-[10px] text-[hsl(215,10%,50%)] mb-1">SUBJECT</p>
                  <p className="text-xs">{selectedAtt.subjectType} &rarr; <span className="font-mono">{selectedAtt.subjectId?.slice(0, 20)}...</span></p>
                </div>
                {selectedAtt.sourceArtifactIds?.length > 0 && (
                  <div>
                    <p className="text-[10px] text-[hsl(215,10%,50%)] mb-1">SOURCE ARTIFACTS ({selectedAtt.sourceArtifactIds.length})</p>
                    <div className="space-y-1">
                      {selectedAtt.sourceArtifactIds.map((id: string, i: number) => (
                        <p key={i} className="text-[10px] font-mono bg-[hsl(210,20%,98%)] p-1.5 rounded break-all">{id}</p>
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  <p className="text-[10px] text-[hsl(215,10%,50%)] mb-1 flex items-center gap-1"><Calendar className="w-3 h-3" /> CREATED</p>
                  <p className="text-xs">{new Date(selectedAtt.createdAt).toLocaleString()}</p>
                </div>
                {selectedAtt.lastVerifiedAt && (
                  <div>
                    <p className="text-[10px] text-[hsl(215,10%,50%)] mb-1">LAST VERIFIED</p>
                    <p className="text-xs flex items-center gap-1">
                      {selectedAtt.verificationNote === 'VERIFIED' ? <CheckCircle2 className="w-3 h-3 text-[#72BF78]" /> : <AlertTriangle className="w-3 h-3 text-[#FF9149]" />}
                      {selectedAtt.verificationNote} &bull; {new Date(selectedAtt.lastVerifiedAt).toLocaleString()}
                    </p>
                  </div>
                )}
                <div>
                  <p className="text-[10px] text-[hsl(215,10%,50%)] mb-1">CANONICAL PAYLOAD</p>
                  <pre className="text-[9px] font-mono bg-[hsl(210,20%,98%)] p-2 rounded max-h-[200px] overflow-auto">{(() => { try { return JSON.stringify(JSON.parse(selectedAtt.payloadCanonical), null, 2); } catch { return selectedAtt.payloadCanonical; } })()}</pre>
                </div>
                <div>
                  <p className="text-[10px] text-[hsl(215,10%,50%)] mb-1">BLOCKCHAIN ANCHOR</p>
                  {selectedAtt.anchorTxHash ? (
                    <div className="space-y-1">
                      <p className="text-xs flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-[#72BF78]" /> Anchored</p>
                      <p className="text-[10px] font-mono bg-[hsl(210,20%,98%)] p-1.5 rounded break-all">Tx: {selectedAtt.anchorTxHash}</p>
                      {selectedAtt.anchorChainId && <p className="text-[10px] text-[hsl(215,10%,50%)]">Chain: {selectedAtt.anchorChainId}</p>}
                      {selectedAtt.anchorTimestamp && <p className="text-[10px] text-[hsl(215,10%,50%)]">At: {new Date(selectedAtt.anchorTimestamp).toLocaleString()}</p>}
                    </div>
                  ) : (
                    <p className="text-xs text-[hsl(215,10%,50%)] flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> Not anchored — local attestation valid
                    </p>
                  )}
                </div>
                <button onClick={() => verifyAttestation(selectedAtt.id)} className="w-full py-2 rounded-lg bg-[hsl(210,60%,45%)] text-white text-sm hover:bg-[hsl(210,60%,38%)]">
                  Verify Integrity
                </button>
              </div>
            ) : (
              <div className="bg-white rounded-xl p-6 text-center" style={{ boxShadow: 'var(--shadow-sm)' }}>
                <FileSearch className="w-8 h-8 text-[hsl(215,10%,50%)] mx-auto mb-2" />
                <p className="text-sm text-[hsl(215,10%,50%)]">Select an attestation to inspect</p>
              </div>
            )}

            {/* Input Artifacts */}
            <div className="bg-white rounded-xl p-4" style={{ boxShadow: 'var(--shadow-sm)' }}>
              <h3 className="text-xs font-semibold text-[hsl(215,10%,50%)] mb-2">Source Artifacts ({artifacts.length})</h3>
              {artifacts.length === 0 ? (
                <p className="text-xs text-[hsl(215,10%,50%)]">No artifacts</p>
              ) : (
                <div className="space-y-1">
                  {artifacts.slice(0, 5).map((a: any) => (
                    <div key={a.id} className="p-2 rounded bg-[hsl(210,20%,98%)] text-xs">
                      <p className="font-medium truncate">{a.filename}</p>
                      <p className="text-[10px] font-mono text-[hsl(215,10%,50%)] truncate">{a.sha256Hash}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TRACEABILITY TAB */}
      {activeTab === 'traceability' && (
        <div className="space-y-6">
          {traceLoading ? (
            <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-24 bg-white rounded-xl animate-pulse" />)}</div>
          ) : traceReport ? (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-white rounded-xl p-4" style={{ boxShadow: 'var(--shadow-sm)' }}>
                  <p className="text-[10px] text-[hsl(215,10%,50%)] uppercase tracking-wider mb-1">Total Nodes</p>
                  <p className="text-2xl font-bold">{traceReport.summary?.totalProvenanceNodes ?? 0}</p>
                  <div className="flex items-center gap-2 mt-1 text-[10px] text-[hsl(215,10%,50%)]">
                    <span>{traceReport.summary?.connectedNodes ?? 0} connected</span>
                    <span className="text-amber-600">{traceReport.summary?.isolatedNodes ?? 0} isolated</span>
                  </div>
                </div>
                <div className="bg-white rounded-xl p-4" style={{ boxShadow: 'var(--shadow-sm)' }}>
                  <p className="text-[10px] text-[hsl(215,10%,50%)] uppercase tracking-wider mb-1">Total Edges</p>
                  <p className="text-2xl font-bold">{traceReport.summary?.totalProvenanceEdges ?? 0}</p>
                </div>
                <div className="bg-white rounded-xl p-4" style={{ boxShadow: 'var(--shadow-sm)' }}>
                  <p className="text-[10px] text-[hsl(215,10%,50%)] uppercase tracking-wider mb-1">Attestation Coverage</p>
                  <p className="text-2xl font-bold">{traceReport.summary?.attestationCoverageRate ?? 'N/A'}</p>
                  <div className="flex items-center gap-2 mt-1 text-[10px]">
                    <span className="text-green-600">{traceReport.summary?.traceableAttestations ?? 0} traceable</span>
                    {(traceReport.summary?.orphanAttestations ?? 0) > 0 && (
                      <span className="text-red-500">{traceReport.summary.orphanAttestations} orphan</span>
                    )}
                  </div>
                </div>
                <div className="bg-white rounded-xl p-4" style={{ boxShadow: 'var(--shadow-sm)' }}>
                  <p className="text-[10px] text-[hsl(215,10%,50%)] uppercase tracking-wider mb-1">Checkpoint Coverage</p>
                  <p className="text-2xl font-bold">{traceReport.summary?.checkpointCoverageRate ?? 'N/A'}</p>
                  <div className="flex items-center gap-2 mt-1 text-[10px]">
                    <span className="text-green-600">{traceReport.summary?.traceableCheckpoints ?? 0} traceable</span>
                    {(traceReport.summary?.orphanCheckpoints ?? 0) > 0 && (
                      <span className="text-red-500">{traceReport.summary.orphanCheckpoints} orphan</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Distributions */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Node type distribution */}
                <div className="bg-white rounded-xl p-4" style={{ boxShadow: 'var(--shadow-sm)' }}>
                  <h3 className="text-xs font-semibold text-[hsl(215,10%,50%)] mb-3">Node Type Distribution</h3>
                  <div className="space-y-2">
                    {Object.entries(traceReport.nodeTypeDistribution ?? {}).map(([type, count]: [string, any]) => {
                      const meta = NODE_TYPE_META[type] ?? { label: type, color: '#94a3b8', bg: '#f8fafc' };
                      const total = traceReport.summary?.totalProvenanceNodes ?? 1;
                      const pct = ((count / total) * 100).toFixed(1);
                      return (
                        <div key={type} className="flex items-center gap-3">
                          <span className="text-[10px] font-semibold uppercase w-20 text-right" style={{ color: meta.color }}>{meta.label}</span>
                          <div className="flex-1 h-4 bg-[hsl(210,15%,95%)] rounded-full overflow-hidden">
                            <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: meta.color }} />
                          </div>
                          <span className="text-xs font-mono w-12 text-right">{count}</span>
                          <span className="text-[10px] text-[hsl(215,10%,50%)] w-12 text-right">{pct}%</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Edge type distribution */}
                <div className="bg-white rounded-xl p-4" style={{ boxShadow: 'var(--shadow-sm)' }}>
                  <h3 className="text-xs font-semibold text-[hsl(215,10%,50%)] mb-3">Edge Type Distribution</h3>
                  <div className="space-y-2">
                    {Object.entries(traceReport.edgeTypeDistribution ?? {}).map(([type, count]: [string, any]) => {
                      const total = traceReport.summary?.totalProvenanceEdges ?? 1;
                      const pct = ((count / total) * 100).toFixed(1);
                      return (
                        <div key={type} className="flex items-center gap-3">
                          <span className="text-[10px] font-mono w-28 text-right truncate" title={type}>{type}</span>
                          <div className="flex-1 h-4 bg-[hsl(210,15%,95%)] rounded-full overflow-hidden">
                            <div className="h-full rounded-full bg-[hsl(210,60%,45%)] transition-all" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs font-mono w-12 text-right">{count}</span>
                          <span className="text-[10px] text-[hsl(215,10%,50%)] w-12 text-right">{pct}%</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Attestation coverage detail */}
              {(traceReport.attestationCoverage ?? []).length > 0 && (
                <div className="bg-white rounded-xl p-4" style={{ boxShadow: 'var(--shadow-sm)' }}>
                  <h3 className="text-xs font-semibold text-[hsl(215,10%,50%)] mb-3">Attestation Traceability Detail</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-[hsl(210,15%,90%)]">
                          <th className="text-left py-2 pr-3 text-[10px] text-[hsl(215,10%,50%)] font-medium">Event Type</th>
                          <th className="text-left py-2 pr-3 text-[10px] text-[hsl(215,10%,50%)] font-medium">Subject</th>
                          <th className="text-left py-2 pr-3 text-[10px] text-[hsl(215,10%,50%)] font-medium">Status</th>
                          <th className="text-center py-2 pr-3 text-[10px] text-[hsl(215,10%,50%)] font-medium">Prov. Node</th>
                          <th className="text-center py-2 text-[10px] text-[hsl(215,10%,50%)] font-medium">Traceable</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(traceReport.attestationCoverage ?? []).map((ac: any) => (
                          <tr key={ac.attestationId} className="border-b border-[hsl(210,15%,95%)]">
                            <td className="py-2 pr-3 font-mono">{ac.eventType}</td>
                            <td className="py-2 pr-3">{ac.subjectType}</td>
                            <td className="py-2 pr-3">
                              <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium" style={{ backgroundColor: `${ATTESTATION_STATUS_COLORS[ac.status]}20`, color: ATTESTATION_STATUS_COLORS[ac.status] }}>
                                {ac.status}
                              </span>
                            </td>
                            <td className="py-2 pr-3 text-center">
                              {ac.hasProvenanceNodeId ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500 mx-auto" /> : <AlertTriangle className="w-3.5 h-3.5 text-amber-500 mx-auto" />}
                            </td>
                            <td className="py-2 text-center">
                              {ac.traceable ? (
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-50 text-green-700 font-medium">YES</span>
                              ) : (
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-50 text-red-600 font-medium">ORPHAN</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Checkpoint coverage detail */}
              {(traceReport.checkpointCoverage ?? []).length > 0 && (
                <div className="bg-white rounded-xl p-4" style={{ boxShadow: 'var(--shadow-sm)' }}>
                  <h3 className="text-xs font-semibold text-[hsl(215,10%,50%)] mb-3">Checkpoint Traceability Detail</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-[hsl(210,15%,90%)]">
                          <th className="text-left py-2 pr-3 text-[10px] text-[hsl(215,10%,50%)] font-medium">Version</th>
                          <th className="text-left py-2 pr-3 text-[10px] text-[hsl(215,10%,50%)] font-medium">ID</th>
                          <th className="text-center py-2 pr-3 text-[10px] text-[hsl(215,10%,50%)] font-medium">Graph Nodes</th>
                          <th className="text-center py-2 text-[10px] text-[hsl(215,10%,50%)] font-medium">Traceable</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(traceReport.checkpointCoverage ?? []).map((cc: any) => (
                          <tr key={cc.checkpointId} className="border-b border-[hsl(210,15%,95%)]">
                            <td className="py-2 pr-3 font-mono font-medium">v{cc.version}</td>
                            <td className="py-2 pr-3 font-mono text-[10px] text-[hsl(215,10%,50%)]">{cc.checkpointId?.slice(0, 16)}...</td>
                            <td className="py-2 pr-3 text-center">{cc.graphNodeCount}</td>
                            <td className="py-2 text-center">
                              {cc.traceable ? (
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-50 text-green-700 font-medium">YES</span>
                              ) : (
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-50 text-red-600 font-medium">ORPHAN</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="bg-white rounded-xl p-8 text-center" style={{ boxShadow: 'var(--shadow-sm)' }}>
              <BarChart3 className="w-10 h-10 text-[hsl(215,10%,50%)] mx-auto mb-3" />
              <p className="text-sm text-[hsl(215,10%,50%)]">Select a project to view traceability report</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
