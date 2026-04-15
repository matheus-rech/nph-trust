'use client';
import { useEffect, useState } from 'react';
import { Users, Plus, Shield, UserCheck, UserX } from 'lucide-react';
import { toast } from 'sonner';

export default function UsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ email: '', password: '', name: '', role: 'RESEARCHER' });

  const load = () => {
    fetch('/api/users').then(r => r.json()).then((d: any) => setUsers(Array.isArray(d) ? d : [])).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const createUser = async () => {
    const res = await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    if (res.ok) { toast.success('User created'); setShowCreate(false); setForm({ email: '', password: '', name: '', role: 'RESEARCHER' }); load(); }
    else { const d = await res.json().catch(() => ({})); toast.error(d?.error ?? 'Failed'); }
  };

  const updateRole = async (id: string, role: string) => {
    const res = await fetch(`/api/users/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }) });
    if (res.ok) { toast.success('Role updated'); load(); }
    else toast.error('Failed');
  };

  const toggleActive = async (id: string, isActive: boolean) => {
    const res = await fetch(`/api/users/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: !isActive }) });
    if (res.ok) { toast.success('Updated'); load(); }
    else toast.error('Failed');
  };

  const roleColors: Record<string, string> = { ADMIN: 'bg-red-50 text-red-700', RESEARCHER: 'bg-blue-50 text-blue-700', COORDINATOR: 'bg-purple-50 text-purple-700', AUDITOR: 'bg-gray-100 text-gray-700' };

  return (
    <div className="max-w-[1200px] mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold tracking-tight flex items-center gap-2">
            <Users className="w-6 h-6 text-[hsl(210,60%,45%)]" /> User Management
          </h1>
          <p className="text-sm text-[hsl(215,10%,50%)] mt-1">Manage accounts and assign roles</p>
        </div>
        <button onClick={() => setShowCreate(!showCreate)} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[hsl(210,60%,45%)] text-white text-sm font-medium hover:bg-[hsl(210,60%,38%)]">
          <Plus className="w-4 h-4" /> Add User
        </button>
      </div>

      {showCreate && (
        <div className="bg-white rounded-xl p-5" style={{ boxShadow: 'var(--shadow-md)' }}>
          <h3 className="text-sm font-semibold mb-3">Create New User</h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <input value={form.name} onChange={(e: any) => setForm({ ...form, name: e.target.value })} placeholder="Name" className="px-3 py-2 rounded-lg border border-[hsl(210,15%,88%)] text-sm" />
            <input value={form.email} onChange={(e: any) => setForm({ ...form, email: e.target.value })} placeholder="Email" type="email" className="px-3 py-2 rounded-lg border border-[hsl(210,15%,88%)] text-sm" />
            <input value={form.password} onChange={(e: any) => setForm({ ...form, password: e.target.value })} placeholder="Password" type="password" className="px-3 py-2 rounded-lg border border-[hsl(210,15%,88%)] text-sm" />
            <select value={form.role} onChange={(e: any) => setForm({ ...form, role: e.target.value })} className="px-3 py-2 rounded-lg border border-[hsl(210,15%,88%)] text-sm">
              <option value="RESEARCHER">Researcher</option><option value="COORDINATOR">Coordinator</option><option value="AUDITOR">Auditor</option><option value="ADMIN">Admin</option>
            </select>
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={createUser} className="px-4 py-2 rounded-lg bg-[hsl(210,60%,45%)] text-white text-sm">Create</button>
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-lg bg-[hsl(210,15%,93%)] text-sm">Cancel</button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl overflow-hidden" style={{ boxShadow: 'var(--shadow-sm)' }}>
        <table className="w-full">
          <thead>
            <tr className="border-b border-[hsl(210,15%,88%)] bg-[hsl(210,20%,98%)]">
              <th className="text-left text-xs font-medium text-[hsl(215,10%,50%)] px-4 py-3">Name</th>
              <th className="text-left text-xs font-medium text-[hsl(215,10%,50%)] px-4 py-3">Email</th>
              <th className="text-left text-xs font-medium text-[hsl(215,10%,50%)] px-4 py-3">Role</th>
              <th className="text-left text-xs font-medium text-[hsl(215,10%,50%)] px-4 py-3">Status</th>
              <th className="text-right text-xs font-medium text-[hsl(215,10%,50%)] px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u: any) => (
              <tr key={u.id} className="border-b border-[hsl(210,15%,92%)]">
                <td className="px-4 py-3 text-sm font-medium">{u.displayName}</td>
                <td className="px-4 py-3 text-sm text-[hsl(215,10%,50%)]">{u.email}</td>
                <td className="px-4 py-3">
                  <select value={u.role} onChange={(e: any) => updateRole(u.id, e.target.value)} className={`text-[10px] px-2 py-0.5 rounded-full font-medium border-0 ${roleColors[u.role] ?? 'bg-gray-100'}`}>
                    <option value="ADMIN">ADMIN</option><option value="RESEARCHER">RESEARCHER</option><option value="COORDINATOR">COORDINATOR</option><option value="AUDITOR">AUDITOR</option>
                  </select>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${u.isActive ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{u.isActive ? 'Active' : 'Inactive'}</span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => toggleActive(u.id, u.isActive)} className="text-xs px-2 py-1 rounded hover:bg-[hsl(210,15%,93%)]">
                    {u.isActive ? <UserX className="w-3.5 h-3.5 inline" /> : <UserCheck className="w-3.5 h-3.5 inline" />}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
