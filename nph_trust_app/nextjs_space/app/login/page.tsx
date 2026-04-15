'use client';
import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Activity, Lock, Mail, Eye, EyeOff } from 'lucide-react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [isSignup, setIsSignup] = useState(false);
  const [name, setName] = useState('');
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (isSignup) {
        const res = await fetch('/api/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, name }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          setError(d?.error ?? 'Signup failed');
          setLoading(false);
          return;
        }
      }
      const result = await signIn('credentials', { email, password, redirect: false });
      if (result?.error) {
        setError('Invalid credentials');
        setLoading(false);
      } else {
        router.replace('/dashboard');
      }
    } catch {
      setError('Something went wrong');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-100">
      <div className="w-full max-w-md mx-4">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-[hsl(210,60%,45%)] text-white mb-4" style={{ boxShadow: 'var(--shadow-md)' }}>
            <Activity className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-display font-bold tracking-tight text-[hsl(215,25%,15%)]">
            NPH-Trust Registry
          </h1>
          <p className="text-sm text-[hsl(215,10%,50%)] mt-1">iNPH Patient Pathway Registry & Provenance Engine</p>
        </div>
        <div className="bg-white rounded-xl p-8" style={{ boxShadow: 'var(--shadow-lg)' }}>
          <h2 className="text-lg font-semibold mb-6">{isSignup ? 'Create Account' : 'Sign In'}</h2>
          {error && <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>}
          <form onSubmit={handleLogin} className="space-y-4">
            {isSignup && (
              <div>
                <label className="block text-sm font-medium mb-1.5">Full Name</label>
                <input type="text" value={name} onChange={(e: any) => setName(e.target.value)} className="w-full px-3 py-2.5 rounded-lg border border-[hsl(210,15%,88%)] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(210,60%,45%)]/30 focus:border-[hsl(210,60%,45%)]" placeholder="Your name" required />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium mb-1.5">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[hsl(215,10%,50%)]" />
                <input type="email" value={email} onChange={(e: any) => setEmail(e.target.value)} className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-[hsl(210,15%,88%)] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(210,60%,45%)]/30 focus:border-[hsl(210,60%,45%)]" placeholder="email@example.com" required />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[hsl(215,10%,50%)]" />
                <input type={showPw ? 'text' : 'password'} value={password} onChange={(e: any) => setPassword(e.target.value)} className="w-full pl-10 pr-10 py-2.5 rounded-lg border border-[hsl(210,15%,88%)] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(210,60%,45%)]/30 focus:border-[hsl(210,60%,45%)]" placeholder="••••••••" required />
                <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(215,10%,50%)] hover:text-[hsl(215,25%,15%)]">
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <button type="submit" disabled={loading} className="w-full py-2.5 rounded-lg bg-[hsl(210,60%,45%)] text-white text-sm font-medium hover:bg-[hsl(210,60%,38%)] disabled:opacity-60 transition-colors">
              {loading ? 'Please wait...' : isSignup ? 'Create Account' : 'Sign In'}
            </button>
          </form>
          <div className="mt-4 text-center">
            <button onClick={() => { setIsSignup(!isSignup); setError(''); }} className="text-sm text-[hsl(210,60%,45%)] hover:underline">
              {isSignup ? 'Already have an account? Sign in' : 'Need an account? Sign up'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
