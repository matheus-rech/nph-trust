'use client';
import { Settings, Shield, Activity } from 'lucide-react';

export default function SettingsPage() {
  return (
    <div className="max-w-[1200px] mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold tracking-tight flex items-center gap-2">
          <Settings className="w-6 h-6 text-[hsl(210,60%,45%)]" /> Settings
        </h1>
        <p className="text-sm text-[hsl(215,10%,50%)] mt-1">System configuration and preferences</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl p-5" style={{ boxShadow: 'var(--shadow-sm)' }}>
          <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
            <Shield className="w-4 h-4 text-[hsl(210,60%,45%)]" /> Attestation Configuration
          </h3>
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-[hsl(210,20%,98%)]">
              <span className="text-[hsl(215,10%,50%)]">Signature Algorithm</span>
              <span className="font-mono text-xs">HMAC_SHA256_v1</span>
            </div>
            <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-[hsl(210,20%,98%)]">
              <span className="text-[hsl(215,10%,50%)]">Hash Algorithm</span>
              <span className="font-mono text-xs">SHA-256</span>
            </div>
            <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-[hsl(210,20%,98%)]">
              <span className="text-[hsl(215,10%,50%)]">Blockchain Anchoring</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">Not configured</span>
            </div>
            <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-[hsl(210,20%,98%)]">
              <span className="text-[hsl(215,10%,50%)]">Signer ID</span>
              <span className="font-mono text-xs">nph-trust-institutional-signer</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl p-5" style={{ boxShadow: 'var(--shadow-sm)' }}>
          <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
            <Activity className="w-4 h-4 text-[hsl(210,60%,45%)]" /> System Information
          </h3>
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-[hsl(210,20%,98%)]">
              <span className="text-[hsl(215,10%,50%)]">Version</span>
              <span className="font-mono text-xs">1.0.0</span>
            </div>
            <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-[hsl(210,20%,98%)]">
              <span className="text-[hsl(215,10%,50%)]">FHIR Alignment</span>
              <span className="text-xs">Pragmatic R4</span>
            </div>
            <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-[hsl(210,20%,98%)]">
              <span className="text-[hsl(215,10%,50%)]">Database</span>
              <span className="text-xs">PostgreSQL + Prisma</span>
            </div>
            <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-[hsl(210,20%,98%)]">
              <span className="text-[hsl(215,10%,50%)]">Framework</span>
              <span className="text-xs">Next.js 14 (App Router)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
