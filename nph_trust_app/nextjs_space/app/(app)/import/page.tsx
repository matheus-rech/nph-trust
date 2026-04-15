'use client';
import { useEffect, useState, useRef } from 'react';
import { Upload, FileText, AlertCircle, CheckCircle2, Loader2, Shield } from 'lucide-react';
import { toast } from 'sonner';

export default function ImportPage() {
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProject, setSelectedProject] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploadResult, setUploadResult] = useState<any>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/projects').then(r => r.json()).then((d: any) => {
      const p = Array.isArray(d) ? d : [];
      setProjects(p);
      if (p.length > 0) setSelectedProject(p[0]?.id ?? '');
    }).catch(() => {});
  }, []);

  const uploadFile = async () => {
    if (!file || !selectedProject) return;
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch(`/api/projects/${selectedProject}/import`, { method: 'POST', body: formData });
      const d = await res.json();
      if (res.ok) { setUploadResult(d); toast.success('File validated'); }
      else toast.error(d?.error ?? 'Upload failed');
    } catch { toast.error('Upload failed'); }
  };

  const executeImport = async () => {
    if (!uploadResult?.job?.id) return;
    setImporting(true);
    try {
      const res = await fetch(`/api/import/${uploadResult.job.id}/execute`, { method: 'POST' });
      const d = await res.json();
      if (res.ok) { setImportResult(d); toast.success('Import completed'); }
      else toast.error(d?.error ?? 'Import failed');
    } catch { toast.error('Import failed'); }
    finally { setImporting(false); }
  };

  return (
    <div className="max-w-[1200px] mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold tracking-tight flex items-center gap-2">
          <Upload className="w-6 h-6 text-[hsl(210,60%,45%)]" /> Data Import
        </h1>
        <p className="text-sm text-[hsl(215,10%,50%)] mt-1">Upload CSV screening data with validation and attestation</p>
      </div>

      <div className="bg-white rounded-xl p-5" style={{ boxShadow: 'var(--shadow-sm)' }}>
        <h3 className="text-sm font-semibold mb-4">Upload File</h3>
        <div className="flex flex-col sm:flex-row gap-3">
          {projects.length > 0 && (
            <select value={selectedProject} onChange={(e: any) => setSelectedProject(e.target.value)} className="px-3 py-2 rounded-lg border border-[hsl(210,15%,88%)] text-sm">
              {projects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <div className="flex-1">
            <input ref={fileRef} type="file" accept=".csv" onChange={(e: any) => { setFile(e?.target?.files?.[0] ?? null); setUploadResult(null); setImportResult(null); }} className="hidden" />
            <button onClick={() => fileRef?.current?.click?.()} className="w-full p-6 rounded-lg border-2 border-dashed border-[hsl(210,15%,88%)] hover:border-[hsl(210,60%,45%)] transition-colors text-center">
              <FileText className="w-8 h-8 text-[hsl(215,10%,50%)] mx-auto mb-2" />
              <p className="text-sm">{file ? file.name : 'Click to select a CSV file'}</p>
              <p className="text-xs text-[hsl(215,10%,50%)] mt-1">Expected columns: pseudo_id, age_range, sex, gait_score, cognition_score, urinary_score</p>
            </button>
          </div>
          <button onClick={uploadFile} disabled={!file} className="px-4 py-2 rounded-lg bg-[hsl(210,60%,45%)] text-white text-sm font-medium hover:bg-[hsl(210,60%,38%)] disabled:opacity-50 self-start">
            Validate
          </button>
        </div>
      </div>

      {/* Preview */}
      {uploadResult && (
        <div className="bg-white rounded-xl p-5" style={{ boxShadow: 'var(--shadow-sm)' }}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold">Preview ({uploadResult.totalRows} rows)</h3>
            <div className="flex items-center gap-2">
              {(uploadResult?.errors ?? []).length > 0 && (
                <span className="flex items-center gap-1 text-xs text-amber-600"><AlertCircle className="w-3.5 h-3.5" /> {uploadResult.errors.length} warnings</span>
              )}
              <button onClick={executeImport} disabled={importing} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[hsl(210,60%,45%)] text-white text-sm font-medium hover:bg-[hsl(210,60%,38%)] disabled:opacity-50">
                {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                {importing ? 'Importing...' : 'Import & Attest'}
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[hsl(210,15%,88%)]">
                  {(uploadResult?.headers ?? []).map((h: string) => <th key={h} className="text-left px-3 py-2 font-medium text-[hsl(215,10%,50%)]">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {(uploadResult?.preview ?? []).map((row: any, i: number) => (
                  <tr key={i} className="border-b border-[hsl(210,15%,92%)]">
                    {(uploadResult?.headers ?? []).map((h: string) => <td key={h} className="px-3 py-2">{row?.[h] ?? ''}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Import result */}
      {importResult && (
        <div className="bg-white rounded-xl p-5" style={{ boxShadow: 'var(--shadow-sm)' }}>
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 className="w-5 h-5 text-[#72BF78]" />
            <h3 className="text-sm font-semibold">Import {importResult?.status}</h3>
          </div>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div className="p-3 rounded-lg bg-[hsl(210,20%,98%)]">
              <p className="text-xs text-[hsl(215,10%,50%)]">Processed</p>
              <p className="text-lg font-bold">{importResult?.processedRows ?? 0}</p>
            </div>
            <div className="p-3 rounded-lg bg-[hsl(210,20%,98%)]">
              <p className="text-xs text-[hsl(215,10%,50%)]">Errors</p>
              <p className="text-lg font-bold">{importResult?.errorRows ?? 0}</p>
            </div>
            <div className="p-3 rounded-lg bg-[hsl(210,20%,98%)]">
              <p className="text-xs text-[hsl(215,10%,50%)]">Status</p>
              <p className="text-sm font-medium">{importResult?.status}</p>
            </div>
          </div>
          <p className="text-xs text-[hsl(215,10%,50%)] mt-3 flex items-center gap-1">
            <Shield className="w-3 h-3" /> Attestation record created for this import
          </p>
        </div>
      )}
    </div>
  );
}
