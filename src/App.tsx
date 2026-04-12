import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ChevronLeft, ChevronRight, Check, Video, ArrowRight, X,
  LogOut, Trash2, RefreshCw, TrendingUp, Info, Shield,
  Upload, Plus, FileDown, FileUp, Flame, StickyNote, Star,
  Sun, Moon, Eye, EyeOff, User, Lock, Calendar, History,
  Table, BarChart2
} from 'lucide-react';
import { ROUTINE_DATA, EXERCISES_SHEET_URL, ADMIN_PASSWORD } from './constants';
import { Day, Exercise, Routine, WorkoutSession, UserProfile, Theme } from './types';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import * as XLSX from 'xlsx';

// ─── STORAGE ───────────────────────────────────────────────────────────────
function lsGet<T>(key: string, def: T): T {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch { return def; }
}
function lsSet(key: string, val: unknown) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

// ─── HELPERS ───────────────────────────────────────────────────────────────
function getEmbedUrl(url: string): string {
  if (!url) return '';
  const yt = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|shorts\/|watch\?.+&v=))([\w-]{11})/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}?rel=0&modestbranding=1`;
  const tt = url.match(/video\/(\d+)/);
  if (tt) return `https://www.tiktok.com/embed/v2/${tt[1]}`;
  return url;
}

function calcVolume(session: WorkoutSession): number {
  return session.exercises.reduce((t, ex) => t + ex.sets.reduce((s, w) => s + (parseFloat(w) || 0), 0), 0);
}

function calcStreak(history: WorkoutSession[], userId: string): number {
  const dates = [...new Set(
    history.filter(s => s.userName === userId).map(s => new Date(s.date).toDateString())
  )].map(d => new Date(d)).sort((a, b) => b.getTime() - a.getTime());
  if (!dates.length) return 0;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const last = new Date(dates[0]); last.setHours(0, 0, 0, 0);
  if (Math.floor((today.getTime() - last.getTime()) / 86400000) > 1) return 0;
  let streak = 1;
  for (let i = 1; i < dates.length; i++) {
    const d1 = new Date(dates[i - 1]); d1.setHours(0, 0, 0, 0);
    const d2 = new Date(dates[i]); d2.setHours(0, 0, 0, 0);
    if (Math.floor((d1.getTime() - d2.getTime()) / 86400000) === 1) streak++;
    else break;
  }
  return streak;
}

function getExercisePR(history: WorkoutSession[], userId: string, exerciseId: string): number {
  const ws = history.filter(s => s.userName === userId)
    .flatMap(s => { const ex = s.exercises.find(e => e.id === exerciseId); return ex ? ex.sets.map(w => parseFloat(w) || 0) : []; });
  return ws.length ? Math.max(...ws) : 0;
}

function getExerciseChartData(history: WorkoutSession[], userId: string, exerciseId: string) {
  return history.filter(s => s.userName === userId)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .flatMap(s => {
      const ex = s.exercises.find(e => e.id === exerciseId);
      if (!ex) return [];
      const max = Math.max(...ex.sets.map(w => parseFloat(w) || 0));
      return max > 0 ? [{ date: format(new Date(s.date), 'dd/MM'), weight: max }] : [];
    });
}

async function parseExcelToRoutine(file: File): Promise<Routine> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const routine: Routine = { nombre: file.name.replace(/\.xlsx?$/i, ''), dias: [] };
        wb.SheetNames.forEach((sheetName, si) => {
          const ws = wb.Sheets[sheetName];
          const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '' });
          if (rows.length < 2) return;
          const hdr = (rows[0] as string[]).map(h => String(h).toLowerCase().trim());
          const col = (terms: string[]) => hdr.findIndex(h => terms.some(t => h.includes(t)));
          const cm = {
            nombre: col(['ejercicio', 'nombre', 'exercise', 'name']),
            series: col(['serie', 'sets']),
            reps: col(['rep']),
            rpe: col(['rpe', 'intensidad']),
            descanso: col(['descanso', 'rest', 'seg']),
            video: col(['video', 'url', 'link']),
            obs: col(['observ', 'nota', 'tip', 'comment']),
          };
          const ejercicios: Exercise[] = [];
          for (let i = 1; i < rows.length; i++) {
            const row = rows[i] as string[];
            const nombre = cm.nombre >= 0 ? String(row[cm.nombre] || '').trim() : '';
            if (!nombre) continue;
            const series = cm.series >= 0 ? (parseInt(String(row[cm.series])) || 3) : 3;
            const repeticiones = cm.reps >= 0 ? String(row[cm.reps] || '10-12') : '10-12';
            const rpeRaw = cm.rpe >= 0 ? String(row[cm.rpe] || '8') : '8';
            const descanso_segundos = cm.descanso >= 0 ? (parseInt(String(row[cm.descanso])) || 120) : 120;
            const video = cm.video >= 0 ? String(row[cm.video] || '') : '';
            const observaciones = cm.obs >= 0 ? String(row[cm.obs] || '') : '';
            let intensidad_rpe = rpeRaw.includes(',')
              ? rpeRaw.split(',').map(r => parseInt(r.trim()) || 8)
              : [parseInt(rpeRaw) || 8];
            while (intensidad_rpe.length < series) intensidad_rpe.push(intensidad_rpe[intensidad_rpe.length - 1]);
            ejercicios.push({ id: `xl_${si}_${i}_${Date.now()}`, nombre, series, repeticiones, intensidad_rpe, descanso_segundos, video, observaciones });
          }
          if (ejercicios.length > 0) routine.dias.push({ dia: si + 1, nombre: `Día ${si + 1} – ${sheetName}`, ejercicios });
        });
        if (routine.dias.length === 0) reject(new Error('No se encontraron ejercicios. Revisa las columnas.'));
        else resolve(routine);
      } catch (err: any) { reject(new Error('Error al leer el archivo: ' + err.message)); }
    };
    reader.readAsArrayBuffer(file);
  });
}

// ─── AVATAR ────────────────────────────────────────────────────────────────
function Avatar({ name, src, size = 'md' }: { name: string; src?: string; size?: 'sm' | 'md' | 'lg' }) {
  const [err, setErr] = useState(false);
  const sz = { sm: 'w-9 h-9', md: 'w-14 h-14', lg: 'w-20 h-20' }[size];
  const tx = { sm: 'text-sm', md: 'text-xl', lg: 'text-3xl' }[size];
  return (
    <div className={`${sz} rounded-full overflow-hidden flex-shrink-0`} style={{ border: '1px solid var(--border)' }}>
      {src && !err
        ? <img src={src} alt={name} className="w-full h-full object-cover" onError={() => setErr(true)} />
        : <div className={`w-full h-full flex items-center justify-center font-black ${tx}`} style={{ background: 'var(--surface2)', color: 'var(--ink-muted)' }}>{name[0].toUpperCase()}</div>
      }
    </div>
  );
}

// ─── THEME TOGGLE ──────────────────────────────────────────────────────────
function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  return (
    <button onClick={onToggle}
      className="w-9 h-9 rounded-xl flex items-center justify-center transition-all active:scale-90"
      style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--ink-muted)' }}>
      {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  );
}

// ─── FOOTER ────────────────────────────────────────────────────────────────
const Footer = () => (
  <div className="w-full py-8 text-center space-y-1 opacity-40">
    <div className="h-px w-10 mx-auto mb-4" style={{ background: 'var(--border)' }} />
    <p className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: 'var(--ink-muted)' }}>
      Desarrollada por <span style={{ color: 'var(--ink)' }}>Marcos Nieto</span>
    </p>
    <p className="text-[9px] font-bold uppercase tracking-[0.15em]" style={{ color: 'var(--ink-dim)' }}>
      Propuestos por <span style={{ color: 'var(--ink-muted)' }}>Roberto Bosqued</span>
    </p>
  </div>
);

// ─── TOAST ─────────────────────────────────────────────────────────────────
function Toast({ msg }: { msg: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }}
      className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[500] font-black text-[10px] tracking-widest uppercase px-5 py-3 rounded-full shadow-xl whitespace-nowrap"
      style={{ background: 'var(--accent)', color: '#fff' }}>
      {msg}
    </motion.div>
  );
}

// ─── MODAL SHELL ───────────────────────────────────────────────────────────
function Modal({ children, onClose }: { children: React.ReactNode; onClose?: () => void }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }}
      onClick={e => e.target === e.currentTarget && onClose?.()}>
      <motion.div initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}
        className="w-full max-w-sm rounded-[2rem] p-7 shadow-2xl"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        {children}
      </motion.div>
    </motion.div>
  );
}

// ─── MAIN APP ──────────────────────────────────────────────────────────────
type AppView = 'login' | 'home' | 'workout' | 'history' | 'progress';

export default function App() {
  // detect /admin route
  const isAdminRoute = window.location.pathname === '/admin';

  const [theme, setTheme] = useState<Theme>(() => lsGet('gym_theme', 'dark'));
  const [view, setView] = useState<AppView>('login');
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);

  // persisted state
  const [users, setUsers] = useState<UserProfile[]>(() => lsGet('gym_users', []));
  const [history, setHistory] = useState<WorkoutSession[]>(() => lsGet('gym_history', []));
  const [weights, setWeights] = useState<Record<string, string[]>>(() => lsGet('gym_weights', {}));
  const [routines, setRoutines] = useState<Record<string, Routine>>(() => lsGet('gym_routines', {}));
  const [toast, setToast] = useState<string | null>(null);

  // apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    lsSet('gym_theme', theme);
  }, [theme]);

  useEffect(() => { lsSet('gym_users', users); }, [users]);
  useEffect(() => { lsSet('gym_history', history); }, [history]);
  useEffect(() => { lsSet('gym_weights', weights); }, [weights]);
  useEffect(() => { lsSet('gym_routines', routines); }, [routines]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }, []);

  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark');

  const getRoutine = (userId: string) => routines[userId] || ROUTINE_DATA;

  const handleLogin = (user: UserProfile) => {
    setCurrentUser(user);
    setView('home');
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setView('login');
  };

  const handleFinishWorkout = (session: WorkoutSession) => {
    setHistory(prev => [session, ...prev]);
    showToast('¡Entrenamiento guardado! 💪');
    setView('home');
  };

  const handleSaveWeight = (exerciseId: string, setIndex: number, weight: string) => {
    setWeights(prev => {
      const sets = [...(prev[exerciseId] || [])];
      while (sets.length <= setIndex) sets.push('');
      sets[setIndex] = weight;
      return { ...prev, [exerciseId]: sets };
    });
  };

  // admin route renders AdminPanel
  if (isAdminRoute) {
    return (
      <div className="min-h-screen flex flex-col items-center overflow-x-hidden" style={{ background: 'var(--bg)', color: 'var(--ink)' }}>
        <div className="w-full max-w-md min-h-screen flex flex-col">
          <AdminPanel
            users={users}
            history={history}
            routines={routines}
            theme={theme}
            onToggleTheme={toggleTheme}
            showToast={showToast}
            onUpdateUsers={setUsers}
            onUpdateRoutines={setRoutines}
            onUpdateHistory={setHistory}
            onExportBackup={() => {
              const data = { gym_users: users, gym_history: history, gym_weights: weights, gym_routines: routines, exportedAt: new Date().toISOString() };
              const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a'); a.href = url;
              a.download = `gymtrainer-backup-${format(new Date(), 'yyyy-MM-dd')}.json`; a.click();
              URL.revokeObjectURL(url);
              showToast('Backup exportado ✓');
            }}
            onImportBackup={(file) => {
              const reader = new FileReader();
              reader.onload = (e) => {
                try {
                  const data = JSON.parse(e.target!.result as string);
                  if (data.gym_users) setUsers(data.gym_users);
                  if (data.gym_history) setHistory(data.gym_history);
                  if (data.gym_weights) setWeights(data.gym_weights);
                  if (data.gym_routines) setRoutines(data.gym_routines);
                  showToast('Backup importado ✓');
                } catch { showToast('Error al leer el archivo'); }
              };
              reader.readAsText(file);
            }}
          />
          <AnimatePresence>{toast && <Toast msg={toast} />}</AnimatePresence>
        </div>
      </div>
    );
  }

  // main user app
  return (
    <div className="min-h-screen flex flex-col items-center overflow-x-hidden" style={{ background: 'var(--bg)', color: 'var(--ink)' }}>
      <div className="w-full max-w-md min-h-screen flex flex-col relative">
        <AnimatePresence mode="wait">
          {view === 'login' && (
            <LoginView key="login" users={users} theme={theme} onToggleTheme={toggleTheme} onLogin={handleLogin} />
          )}
          {view === 'home' && currentUser && (
            <HomeView key="home" user={currentUser} history={history} routine={getRoutine(currentUser.id)}
              theme={theme} onToggleTheme={toggleTheme}
              onStartWorkout={() => setView('workout')} onNavigate={setView} onLogout={handleLogout} />
          )}
          {view === 'workout' && currentUser && (
            <WorkoutView key="workout" user={currentUser} history={history} routine={getRoutine(currentUser.id)}
              initialWeights={weights} onSaveWeight={handleSaveWeight} onFinish={handleFinishWorkout} onBack={() => setView('home')} />
          )}
          {view === 'history' && currentUser && (
            <HistoryView key="history" history={history.filter(s => s.userName === currentUser.id)}
              onBack={() => setView('home')} onDelete={id => setHistory(prev => prev.filter(s => s.id !== id))} />
          )}
          {view === 'progress' && currentUser && (
            <ProgressView key="progress" history={history} user={currentUser} routine={getRoutine(currentUser.id)} onBack={() => setView('home')} />
          )}
        </AnimatePresence>
        <AnimatePresence>{toast && <Toast msg={toast} />}</AnimatePresence>
      </div>
    </div>
  );
}

// ─── LOGIN VIEW ────────────────────────────────────────────────────────────
function LoginView({ users, theme, onToggleTheme, onLogin }: {
  users: UserProfile[];
  theme: Theme;
  onToggleTheme: () => void;
  onLogin: (u: UserProfile) => void;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = () => {
    setError('');
    const user = users.find(u => u.username.toLowerCase() === username.toLowerCase().trim());
    if (!user || user.password !== password) {
      setError('Usuario o contraseña incorrectos');
      return;
    }
    onLogin(user);
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="min-h-screen flex flex-col" style={{ background: 'var(--bg)' }}>

      {/* Top bar */}
      <div className="flex justify-end p-6">
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </div>

      {/* Hero */}
      <div className="flex-1 flex flex-col justify-center px-8 pb-8">
        <div className="mb-14">
          {/* Nike-style wordmark */}
          <div className="mb-3">
            <span className="text-[10px] font-black uppercase tracking-[0.4em]" style={{ color: 'var(--accent)' }}>
              Performance Tracking
            </span>
          </div>
          <h1 className="font-black italic uppercase leading-none tracking-tighter" style={{ fontSize: 'clamp(3.5rem,14vw,5rem)', color: 'var(--ink)' }}>
            Gym<br />Trainer<br /><span style={{ color: 'var(--accent)' }}>PRO</span>
          </h1>
          <div className="h-[3px] w-10 mt-5 rounded-full" style={{ background: 'var(--accent)' }} />
        </div>

        {/* Form */}
        <div className="space-y-3">
          {users.length === 0 && (
            <div className="rounded-xl p-4 text-sm mb-2" style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--ink-muted)' }}>
              No hay usuarios creados aún. Accede al panel de admin para crear usuarios.
            </div>
          )}

          <div className="relative">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--ink-dim)' }}>
              <User size={15} />
            </span>
            <input
              className="input pl-10"
              placeholder="Usuario"
              value={username}
              onChange={e => setUsername(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              autoCapitalize="none"
              autoComplete="username"
            />
          </div>

          <div className="relative">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--ink-dim)' }}>
              <Lock size={15} />
            </span>
            <input
              className="input pl-10 pr-12"
              placeholder="Contraseña"
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              autoComplete="current-password"
            />
            <button onClick={() => setShowPw(p => !p)}
              className="absolute right-3.5 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--ink-dim)', background: 'none', border: 'none', cursor: 'pointer' }}>
              {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>

          {error && (
            <p className="text-sm font-bold" style={{ color: 'var(--red)' }}>{error}</p>
          )}

          <button onClick={handleSubmit} className="btn-accent" style={{ marginTop: '0.5rem' }}>
            Entrar <ArrowRight size={16} />
          </button>
        </div>
      </div>

      <Footer />
    </motion.div>
  );
}

// ─── HOME VIEW ─────────────────────────────────────────────────────────────
function HomeView({ user, history, routine, theme, onToggleTheme, onStartWorkout, onNavigate, onLogout }: {
  user: UserProfile;
  history: WorkoutSession[];
  routine: Routine;
  theme: Theme;
  onToggleTheme: () => void;
  onStartWorkout: () => void;
  onNavigate: (v: AppView) => void;
  onLogout: () => void;
}) {
  const userHistory = history.filter(s => s.userName === user.id);
  const lastSession = userHistory[0];
  const streak = calcStreak(history, user.id);

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
      className="flex-1 flex flex-col p-6 pt-10">

      {/* Header */}
      <header className="flex justify-between items-center mb-8">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Avatar name={user.name} src={user.avatarUrl} size="md" />
            <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 flex items-center justify-center"
              style={{ background: 'var(--success)', borderColor: 'var(--bg)' }}>
              <Check size={8} style={{ color: '#000', strokeWidth: 4 }} />
            </div>
          </div>
          <div>
            <h1 className="text-2xl font-black italic uppercase tracking-tight leading-none" style={{ color: 'var(--ink)' }}>
              {user.name}
            </h1>
            <p className="text-[9px] font-black uppercase tracking-[0.2em] mt-0.5" style={{ color: 'var(--ink-muted)' }}>
              {routine.nombre}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          <button onClick={onLogout} className="w-9 h-9 rounded-xl flex items-center justify-center transition-all active:scale-90"
            style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--ink-muted)' }}>
            <LogOut size={15} />
          </button>
        </div>
      </header>

      {/* Streak */}
      {streak > 0 && (
        <div className="flex items-center gap-3 rounded-2xl px-4 py-3 mb-5"
          style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-mid)' }}>
          <Flame size={18} style={{ color: 'var(--accent)' }} />
          <div>
            <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: 'var(--ink-muted)' }}>Racha activa</p>
            <p className="text-sm font-black italic" style={{ color: 'var(--accent)' }}>{streak} día{streak !== 1 ? 's' : ''} seguidos</p>
          </div>
        </div>
      )}

      {/* Bento stats */}
      <div className="grid grid-cols-6 gap-2.5 mb-7" style={{ gridTemplateRows: 'auto auto' }}>
        {/* Last session */}
        <div className="col-span-3 rounded-2xl p-4 flex flex-col justify-between" style={{ background: 'var(--surface)', border: '1px solid var(--border)', minHeight: '7rem' }}>
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>
            <Calendar size={14} />
          </div>
          <div>
            <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: 'var(--ink-muted)' }}>Último</p>
            <p className="text-sm font-black italic" style={{ color: 'var(--ink)' }}>
              {lastSession ? format(new Date(lastSession.date), 'dd MMM', { locale: es }) : '--'}
            </p>
          </div>
        </div>
        {/* Sessions */}
        <div className="col-span-3 rounded-2xl p-4 flex flex-col justify-between" style={{ background: 'var(--surface)', border: '1px solid var(--border)', minHeight: '7rem' }}>
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>
            <TrendingUp size={14} />
          </div>
          <div>
            <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: 'var(--ink-muted)' }}>Sesiones</p>
            <p className="text-sm font-black italic" style={{ color: 'var(--ink)' }}>{userHistory.length}</p>
          </div>
        </div>
        {/* Stats btn */}
        <button onClick={() => onNavigate('progress')} className="col-span-2 rounded-2xl p-4 flex flex-col items-center justify-center gap-1.5 active:scale-95 transition-all"
          style={{ background: 'var(--accent)', minHeight: '6rem' }}>
          <BarChart2 size={18} style={{ color: '#fff' }} />
          <span className="text-[8px] font-black uppercase tracking-widest" style={{ color: '#fff' }}>Stats</span>
        </button>
        {/* History btn */}
        <button onClick={() => onNavigate('history')} className="col-span-2 rounded-2xl p-4 flex flex-col items-center justify-center gap-1.5 active:scale-95 transition-all"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)', minHeight: '6rem' }}>
          <History size={18} style={{ color: 'var(--ink-muted)' }} />
          <span className="text-[8px] font-black uppercase tracking-widest" style={{ color: 'var(--ink-muted)' }}>Log</span>
        </button>
        {/* Sheet link */}
        <a href={EXERCISES_SHEET_URL} target="_blank" rel="noopener noreferrer"
          className="col-span-2 rounded-2xl p-4 flex flex-col items-center justify-center gap-1.5 active:scale-95 transition-all no-underline"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)', minHeight: '6rem' }}>
          <Table size={18} style={{ color: 'var(--ink-muted)' }} />
          <span className="text-[8px] font-black uppercase tracking-widest" style={{ color: 'var(--ink-muted)' }}>Sheet</span>
        </a>
      </div>

      {/* Days list */}
      <div className="flex-1">
        <div className="flex items-center gap-3 mb-4">
          <p className="text-[9px] font-black uppercase tracking-[0.3em]" style={{ color: 'var(--ink-dim)' }}>Entrenamientos</p>
          <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
        </div>
        <div className="space-y-2.5">
          {routine.dias.map((day) => (
            <button key={day.dia} onClick={onStartWorkout}
              className="w-full rounded-[1.5rem] p-4 text-left flex items-center justify-between group active:scale-[0.98] transition-all"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
              onMouseOver={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
              onMouseOut={e => (e.currentTarget.style.borderColor = 'var(--border)')}>
              <div className="flex items-center gap-4">
                <div className="w-11 h-11 rounded-xl flex items-center justify-center font-black italic text-lg transition-all"
                  style={{ background: 'var(--surface2)', color: 'var(--ink-muted)', border: '1px solid var(--border)' }}>
                  {day.dia}
                </div>
                <div>
                  <h3 className="text-base font-black italic tracking-tight" style={{ color: 'var(--ink)' }}>
                    {day.nombre.split('–')[1]?.trim() || day.nombre}
                  </h3>
                  <p className="text-[8px] font-bold uppercase tracking-widest" style={{ color: 'var(--ink-dim)' }}>
                    {day.ejercicios.length} ejercicios · {day.ejercicios.reduce((a, e) => a + e.series, 0)} series
                  </p>
                </div>
              </div>
              <ChevronRight size={18} style={{ color: 'var(--ink-dim)' }} />
            </button>
          ))}
        </div>
      </div>

      <Footer />
    </motion.div>
  );
}

// ─── WORKOUT VIEW ──────────────────────────────────────────────────────────
function WorkoutView({ user, history, routine, initialWeights, onSaveWeight, onFinish, onBack }: {
  user: UserProfile;
  history: WorkoutSession[];
  routine: Routine;
  initialWeights: Record<string, string[]>;
  onSaveWeight: (id: string, idx: number, w: string) => void;
  onFinish: (s: WorkoutSession) => void;
  onBack: () => void;
}) {
  const [dayIdx, setDayIdx] = useState(0);
  const [exerciseIdx, setExerciseIdx] = useState(0);
  const [currentSet, setCurrentSet] = useState(1);
  const [isResting, setIsResting] = useState(false);
  const [restTime, setRestTime] = useState(0);
  const [sessionData, setSessionData] = useState<Record<string, string[]>>(initialWeights);
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [showVideo, setShowVideo] = useState(false);
  const [showFinish, setShowFinish] = useState(false);
  const [showConfirmBack, setShowConfirmBack] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const [workoutNote, setWorkoutNote] = useState('');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const day = routine.dias[dayIdx];
  const exercise = day?.ejercicios[exerciseIdx];
  const isLastEx = exerciseIdx === (day?.ejercicios.length ?? 0) - 1;
  const isLastSet = currentSet === exercise?.series;

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  const startRest = (secs: number) => {
    if (timerRef.current) clearInterval(timerRef.current);
    setIsResting(true); setRestTime(secs);
    timerRef.current = setInterval(() => {
      setRestTime(p => { if (p <= 1) { clearInterval(timerRef.current!); setIsResting(false); return 0; } return p - 1; });
    }, 1000);
  };

  const skipRest = () => { if (timerRef.current) clearInterval(timerRef.current); setIsResting(false); setRestTime(0); };

  const saveWeight = (val: string) => {
    setSessionData(prev => {
      const sets = [...(prev[exercise.id] || Array(exercise.series).fill(''))];
      while (sets.length <= currentSet - 1) sets.push('');
      sets[currentSet - 1] = val;
      return { ...prev, [exercise.id]: sets };
    });
    onSaveWeight(exercise.id, currentSet - 1, val);
  };

  const toggleComplete = (id: string) => {
    setCompleted(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };

  const handleNext = () => {
    if (!isLastSet) { startRest(exercise.descanso_segundos); setCurrentSet(p => p + 1); }
    else {
      const nc = new Set(completed); nc.add(exercise.id); setCompleted(nc);
      if (!isLastEx) { setExerciseIdx(p => p + 1); setCurrentSet(1); startRest(exercise.descanso_segundos); }
      else { if (timerRef.current) clearInterval(timerRef.current); setShowFinish(true); }
    }
  };

  const confirmFinish = () => {
    const session: WorkoutSession = {
      id: crypto.randomUUID(),
      dayName: day.nombre,
      userName: user.id,
      date: new Date().toISOString(),
      note: workoutNote || undefined,
      exercises: day.ejercicios
        .filter(ex => completed.has(ex.id) || sessionData[ex.id]?.some(s => s !== ''))
        .map(ex => ({ id: ex.id, nombre: ex.nombre, sets: sessionData[ex.id] || [] }))
    };
    onFinish(session);
  };

  if (!day || !exercise) return null;

  const pr = getExercisePR(history, user.id, exercise.id);
  const curW = parseFloat((sessionData[exercise.id] || [])[currentSet - 1] || '');
  const isPR = curW > 0 && curW > pr;
  const prevWeights = initialWeights[exercise.id] || [];
  const rpe = exercise.intensidad_rpe[currentSet - 1] ?? exercise.intensidad_rpe[0];
  const circ = 2 * Math.PI * 45;
  const dashOffset = circ - (circ * restTime) / exercise.descanso_segundos;

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
      className="flex-1 flex flex-col h-screen" style={{ background: 'var(--bg)' }}>

      {/* Sticky header */}
      <header className="px-4 pt-8 pb-3 sticky top-0 z-30 backdrop-blur-xl" style={{ background: 'rgba(5,5,5,0.9)', borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between mb-5">
          <button onClick={() => setShowConfirmBack(true)}
            className="w-9 h-9 rounded-full flex items-center justify-center"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink-muted)' }}>
            <ChevronLeft size={16} />
          </button>
          <div className="text-center">
            <p className="text-[9px] font-black uppercase tracking-[0.2em]" style={{ color: 'var(--accent)' }}>Entrenando</p>
            <h2 className="text-xs font-black uppercase italic truncate max-w-[160px]" style={{ color: 'var(--ink)' }}>
              {day.nombre.split('–')[1]?.trim() || day.nombre}
            </h2>
          </div>
          <button onClick={() => setShowFinish(true)}
            className="px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest"
            style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-mid)', color: 'var(--accent)' }}>
            Terminar
          </button>
        </div>

        {/* Day tabs (if multiple days) */}
        {routine.dias.length > 1 && (
          <div className="flex gap-1.5 mb-3 overflow-x-auto no-scrollbar">
            {routine.dias.map((d, i) => (
              <button key={d.dia} onClick={() => { setDayIdx(i); setExerciseIdx(0); setCurrentSet(1); skipRest(); }}
                className="flex-shrink-0 px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider"
                style={{ background: i === dayIdx ? 'var(--accent-dim)' : 'var(--surface)', border: `1px solid ${i === dayIdx ? 'var(--accent-mid)' : 'var(--border)'}`, color: i === dayIdx ? 'var(--accent)' : 'var(--ink-muted)' }}>
                {d.nombre.split('–')[1]?.trim() || `Día ${d.dia}`}
              </button>
            ))}
          </div>
        )}

        {/* Exercise nav rail */}
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
          {day.ejercicios.map((ex, i) => (
            <button key={ex.id} onClick={() => { setExerciseIdx(i); setCurrentSet(1); skipRest(); }}
              className="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center relative text-xs font-black italic transition-all"
              style={{
                background: i === exerciseIdx ? 'var(--accent)' : completed.has(ex.id) ? 'var(--accent-dim)' : 'var(--surface)',
                border: `1px solid ${i === exerciseIdx ? 'var(--accent)' : completed.has(ex.id) ? 'var(--accent-mid)' : 'var(--border)'}`,
                color: i === exerciseIdx ? '#fff' : completed.has(ex.id) ? 'var(--accent)' : 'var(--ink-muted)',
              }}>
              {i + 1}
              {completed.has(ex.id) && i !== exerciseIdx && (
                <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full border-2 flex items-center justify-center"
                  style={{ background: 'var(--success)', borderColor: 'var(--bg)' }}>
                  <Check size={6} style={{ color: '#000', strokeWidth: 5 }} />
                </div>
              )}
            </button>
          ))}
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-5 no-scrollbar pb-32">
        <AnimatePresence mode="wait">
          {isResting ? (
            <motion.div key="rest" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-10">
              <div className="relative w-48 h-48 flex items-center justify-center mb-8">
                <svg className="absolute inset-0 w-full h-full" style={{ transform: 'rotate(-90deg)' }}>
                  <circle cx="50%" cy="50%" r="45%" strokeWidth="4" fill="transparent" style={{ stroke: 'var(--surface2)' }} />
                  <circle cx="50%" cy="50%" r="45%" strokeWidth="4" fill="transparent"
                    strokeDasharray={`${circ}px`} strokeDashoffset={`${dashOffset}px`}
                    style={{ stroke: 'var(--accent)', strokeLinecap: 'round', transition: 'stroke-dashoffset 1s linear' }} />
                </svg>
                <div className="text-center">
                  <p className="text-5xl font-black italic tabular-nums" style={{ color: 'var(--ink)' }}>
                    {Math.floor(restTime / 60)}:{String(restTime % 60).padStart(2, '0')}
                  </p>
                  <p className="text-[9px] font-black uppercase tracking-[0.3em] mt-1" style={{ color: 'var(--ink-muted)' }}>Descanso</p>
                </div>
              </div>
              <button onClick={skipRest} className="btn-secondary w-36 py-2.5">Saltar</button>
            </motion.div>
          ) : (
            <motion.div key="ex" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
              {/* Title */}
              <div className="flex justify-between items-start gap-3">
                <div className="flex-1">
                  <span className="text-[9px] font-black uppercase tracking-[0.3em] block mb-1" style={{ color: 'var(--accent)' }}>
                    Ejercicio {exerciseIdx + 1} de {day.ejercicios.length}
                  </span>
                  <h3 className="text-3xl font-black italic tracking-tight leading-tight" style={{ color: 'var(--ink)' }}>
                    {exercise.nombre}
                  </h3>
                </div>
                <button onClick={() => toggleComplete(exercise.id)}
                  className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 transition-all"
                  style={{ background: completed.has(exercise.id) ? 'var(--success)' : 'var(--surface)', border: `1px solid ${completed.has(exercise.id) ? 'var(--success)' : 'var(--border)'}`, color: completed.has(exercise.id) ? '#000' : 'var(--ink-dim)' }}>
                  <Check size={20} style={{ strokeWidth: completed.has(exercise.id) ? 4 : 2 }} />
                </button>
              </div>

              {/* Stats chips */}
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Serie', val: <>{currentSet}<span style={{ color: 'var(--ink-dim)', fontSize: '0.7rem' }}>/{exercise.series}</span></> },
                  { label: 'Reps', val: exercise.repeticiones },
                  { label: 'RPE', val: <span style={{ color: 'var(--accent)' }}>@{rpe}</span> },
                ].map(({ label, val }) => (
                  <div key={label} className="rounded-xl p-3 text-center" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                    <p className="text-[8px] font-black uppercase tracking-widest mb-0.5" style={{ color: 'var(--ink-muted)' }}>{label}</p>
                    <p className="text-xl font-black italic" style={{ color: 'var(--ink)' }}>{val}</p>
                  </div>
                ))}
              </div>

              {/* Weight input */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[9px] font-black uppercase tracking-[0.3em]" style={{ color: 'var(--ink-muted)' }}>Registrar Carga</p>
                  {isPR
                    ? <span className="flex items-center gap-1 text-[8px] font-black uppercase tracking-wider px-2 py-1 rounded-lg" style={{ background: 'rgba(234,179,8,0.15)', border: '1px solid rgba(234,179,8,0.3)', color: '#eab308' }}>
                        <Star size={9} style={{ fill: '#eab308' }} /> Nuevo PR
                      </span>
                    : pr > 0 ? <span className="text-[9px] font-black uppercase tracking-wider" style={{ color: 'var(--ink-dim)' }}>PR: {pr}kg</span> : null}
                </div>
                <WeightInput exerciseId={exercise.id} setIndex={currentSet - 1}
                  value={(sessionData[exercise.id] || [])[currentSet - 1] || ''}
                  onSave={saveWeight} />
                {prevWeights.some(w => w) && (
                  <div>
                    <p className="text-[8px] font-black uppercase tracking-widest mb-1.5" style={{ color: 'var(--ink-dim)' }}>Cargas anteriores</p>
                    <div className="flex gap-1.5 flex-wrap">
                      {prevWeights.map((w, i) => (
                        <div key={i} className="px-2 py-1 rounded-lg text-[10px] font-black text-center min-w-[2.5rem]"
                          style={{ background: i === currentSet - 1 ? 'var(--accent-dim)' : 'var(--surface2)', border: `1px solid ${i === currentSet - 1 ? 'var(--accent-mid)' : 'var(--border)'}`, color: i === currentSet - 1 ? 'var(--accent)' : 'var(--ink-muted)' }}>
                          {w || '--'}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Observations */}
              <div className="rounded-2xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <div className="flex items-center gap-2 mb-2" style={{ color: 'var(--ink-muted)' }}>
                  <Info size={11} />
                  <span className="text-[9px] font-black uppercase tracking-widest">Observaciones</span>
                </div>
                <p className="text-xs leading-relaxed italic" style={{ color: 'var(--ink-muted)' }}>"{exercise.observaciones}"</p>
              </div>

              {/* Buttons */}
              <div className="flex gap-2">
                <button onClick={() => setShowVideo(true)} className="flex-1 py-3 flex items-center justify-center gap-2 text-[9px] font-black uppercase tracking-[0.15em] rounded-xl transition-colors"
                  style={{ border: '1px solid var(--border)', background: 'transparent', color: 'var(--ink-muted)' }}>
                  <Video size={13} /> Ver Técnica
                </button>
                <button onClick={() => setShowNote(true)} className="flex-1 py-3 flex items-center justify-center gap-2 text-[9px] font-black uppercase tracking-[0.15em] rounded-xl transition-all"
                  style={{ border: `1px solid ${workoutNote ? 'var(--accent-mid)' : 'var(--border)'}`, background: workoutNote ? 'var(--accent-dim)' : 'transparent', color: workoutNote ? 'var(--accent)' : 'var(--ink-muted)' }}>
                  <StickyNote size={13} /> {workoutNote ? 'Nota ✓' : 'Nota'}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Bottom CTA */}
      {!isResting && (
        <div className="fixed bottom-0 left-0 right-0 max-w-md mx-auto p-4 pt-8 z-40"
          style={{ background: `linear-gradient(to top, var(--bg) 60%, transparent)` }}>
          <button onClick={handleNext} className="btn-accent py-4 text-sm">
            {isLastSet && isLastEx ? 'Finalizar Entrenamiento' : isLastSet ? 'Siguiente Ejercicio' : `Completar Serie ${currentSet}`}
            <ArrowRight size={16} />
          </button>
        </div>
      )}

      {/* Finish modal */}
      <AnimatePresence>
        {showFinish && (
          <Modal onClose={() => setShowFinish(false)}>
            <h3 className="text-xl font-black italic mb-1" style={{ color: 'var(--ink)' }}>¿Finalizar sesión?</h3>
            <p className="text-[10px] font-black uppercase tracking-widest mb-6" style={{ color: 'var(--ink-muted)' }}>
              Se guardará en tu perfil — <span style={{ color: 'var(--accent)' }}>{user.name}</span>
            </p>
            <button onClick={confirmFinish} className="btn-accent mb-3">
              Guardar entrenamiento <Check size={15} />
            </button>
            <button onClick={() => setShowFinish(false)} className="btn-secondary">Continuar entrenando</button>
          </Modal>
        )}
      </AnimatePresence>

      {/* Confirm back */}
      <AnimatePresence>
        {showConfirmBack && (
          <Modal onClose={() => setShowConfirmBack(false)}>
            <h3 className="text-xl font-black italic mb-2" style={{ color: 'var(--ink)' }}>¿Salir del entrenamiento?</h3>
            <p className="text-sm mb-6" style={{ color: 'var(--ink-muted)' }}>Perderás el progreso no guardado.</p>
            <button onClick={() => { if (timerRef.current) clearInterval(timerRef.current); onBack(); }}
              className="py-4 w-full rounded-xl font-black text-xs uppercase tracking-widest mb-3"
              style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: 'var(--red)' }}>
              Sí, salir
            </button>
            <button onClick={() => setShowConfirmBack(false)} className="btn-secondary">Continuar</button>
          </Modal>
        )}
      </AnimatePresence>

      {/* Note modal */}
      <AnimatePresence>
        {showNote && (
          <Modal onClose={() => setShowNote(false)}>
            <h3 className="text-xl font-black italic mb-4" style={{ color: 'var(--ink)' }}>Nota de sesión</h3>
            <textarea rows={4} defaultValue={workoutNote} id="noteTA"
              placeholder="Ej: Me noté cargado, nuevo PR en hack squat…"
              className="w-full rounded-xl px-4 py-3 text-sm resize-none outline-none transition-all"
              style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--ink)' }} />
            <button onClick={() => { const el = document.getElementById('noteTA') as HTMLTextAreaElement; setWorkoutNote(el?.value || ''); setShowNote(false); }}
              className="btn-accent mt-4">Guardar</button>
          </Modal>
        )}
      </AnimatePresence>

      {/* Video modal */}
      {showVideo && (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center p-6" style={{ background: 'rgba(0,0,0,0.97)' }}>
          <button onClick={() => setShowVideo(false)} className="absolute top-10 right-6 w-11 h-11 rounded-full flex items-center justify-center"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink)' }}>
            <X size={20} />
          </button>
          <div className="w-full max-w-sm aspect-[9/16] rounded-[2rem] overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <iframe src={getEmbedUrl(exercise.video)} className="w-full h-full" frameBorder="0" allowFullScreen />
          </div>
        </div>
      )}
    </motion.div>
  );
}

// Weight input component
function WeightInput({ exerciseId, setIndex, value, onSave }: {
  exerciseId: string; setIndex: number; value: string; onSave: (v: string) => void;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  return (
    <div className="flex gap-2.5 w-full items-center">
      <div className="relative flex-1">
        <input type="number" step="0.5" inputMode="decimal" value={local}
          onChange={e => setLocal(e.target.value)} onBlur={() => onSave(local)}
          className="w-full rounded-xl px-4 py-3 text-2xl font-black outline-none transition-all placeholder:opacity-20"
          style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--ink)' }}
          placeholder="0.0" />
        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[9px] font-black uppercase tracking-widest" style={{ color: 'var(--ink-dim)' }}>kg</span>
      </div>
      <button onClick={() => onSave(local)}
        className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 transition-all"
        style={{ background: local && local === value ? 'var(--success)' : 'var(--surface2)', border: `1px solid ${local && local === value ? 'var(--success)' : 'var(--border)'}`, color: local && local === value ? '#000' : 'var(--ink-dim)' }}>
        <Check size={17} style={{ strokeWidth: local && local === value ? 4 : 2 }} />
      </button>
    </div>
  );
}

// ─── HISTORY VIEW ──────────────────────────────────────────────────────────
function HistoryView({ history, onBack, onDelete }: {
  history: WorkoutSession[];
  onBack: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
      className="flex-1 flex flex-col p-6 pt-10">
      <header className="flex items-center gap-4 mb-8">
        <button onClick={onBack} className="w-9 h-9 rounded-full flex items-center justify-center"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink-muted)' }}>
          <ChevronLeft size={16} />
        </button>
        <h2 className="text-3xl font-black italic uppercase tracking-tight" style={{ color: 'var(--ink)' }}>Historial</h2>
      </header>

      <div className="space-y-5 flex-1 overflow-y-auto no-scrollbar pb-10">
        {history.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24" style={{ color: 'var(--ink-dim)' }}>
            <History size={56} className="mb-5 opacity-20" />
            <p className="text-[10px] font-black uppercase tracking-[0.3em]">Sin registros aún</p>
          </div>
        ) : history.map(session => (
          <div key={session.id} className="card-xl overflow-hidden">
            <div className="p-5 flex justify-between items-start" style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface2)' }}>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: 'var(--accent)' }}>
                    {format(new Date(session.date), 'dd MMMM yyyy', { locale: es })}
                  </span>
                </div>
                <h3 className="text-lg font-black italic tracking-tight" style={{ color: 'var(--ink)' }}>{session.dayName}</h3>
                {session.note && <p className="text-xs mt-1 italic" style={{ color: 'var(--ink-muted)' }}>"{session.note}"</p>}
                <p className="text-[9px] font-black uppercase tracking-widest mt-1" style={{ color: 'var(--ink-dim)' }}>
                  Vol: <span style={{ color: 'var(--ink-muted)' }}>{calcVolume(session).toFixed(0)} kg</span>
                </p>
              </div>
              <button onClick={() => onDelete(session.id)} className="p-2 transition-colors"
                style={{ color: 'var(--ink-dim)', background: 'none', border: 'none', cursor: 'pointer' }}
                onMouseOver={e => (e.currentTarget.style.color = 'var(--red)')}
                onMouseOut={e => (e.currentTarget.style.color = 'var(--ink-dim)')}>
                <Trash2 size={16} />
              </button>
            </div>
            <div className="p-5 space-y-3">
              {session.exercises.map((ex, i) => (
                <div key={i} className="flex justify-between items-center gap-3">
                  <p className="text-sm italic flex-1 min-w-0 truncate" style={{ color: 'var(--ink-muted)' }}>{ex.nombre}</p>
                  <div className="flex gap-1.5 flex-shrink-0 flex-wrap justify-end">
                    {ex.sets.map((w, j) => (
                      <span key={j} className="chip">{w || '--'}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <Footer />
    </motion.div>
  );
}

// ─── PROGRESS VIEW ─────────────────────────────────────────────────────────
function ProgressView({ history, user, routine, onBack }: {
  history: WorkoutSession[];
  user: UserProfile;
  routine: Routine;
  onBack: () => void;
}) {
  const allEx = routine.dias.flatMap(d => d.ejercicios);
  const [selEx, setSelEx] = useState(allEx[0]?.id || '');
  const [aiTip, setAiTip] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const uHistory = history.filter(s => s.userName === user.id).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const streak = calcStreak(history, user.id);
  const totalVol = uHistory.reduce((t, s) => t + calcVolume(s), 0);

  const overallChart = uHistory.map(s => ({
    date: format(new Date(s.date), 'dd/MM'),
    weight: Math.max(0, ...s.exercises.flatMap(e => e.sets.map(w => parseFloat(w) || 0)))
  })).filter(d => d.weight > 0);

  const exChart = getExerciseChartData(history, user.id, selEx);
  const exPR = getExercisePR(history, user.id, selEx);
  const bestOverall = overallChart.length ? Math.max(...overallChart.map(d => d.weight)) : 0;

  const tooltipStyle = { backgroundColor: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', color: 'var(--ink)' };

  const loadAITip = async () => {
    setAiLoading(true);
    const summary = {
      nombre: user.name, sesiones: uHistory.length, racha: streak, rutina: routine.nombre,
      mejoresPesos: allEx.map(ex => { const pr = getExercisePR(history, user.id, ex.id); return pr > 0 ? `${ex.nombre}: ${pr}kg` : null; }).filter(Boolean).slice(0, 6),
      ultimaSesion: uHistory[uHistory.length - 1] ? { dia: uHistory[uHistory.length - 1].dayName, ejercicios: uHistory[uHistory.length - 1].exercises.map(e => ({ nombre: e.nombre, cargas: e.sets.filter(w => parseFloat(w) > 0) })) } : null,
    };
    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514', max_tokens: 1000,
          messages: [{ role: 'user', content: `Eres un coach de fitness experto. Basándote en los datos del atleta, da UN consejo motivador y específico en español (máx 80 palabras). Habla directamente usando "tú". No uses asteriscos ni markdown. Solo el consejo.\n\nDatos: ${JSON.stringify(summary)}` }]
        })
      });
      const data = await resp.json();
      setAiTip(data.content?.[0]?.text || 'Sigue con consistencia. ¡Cada sesión cuenta!');
    } catch { setAiTip('Sigue entrenando con consistencia. ¡Cada sesión te acerca más a tus objetivos!'); }
    setAiLoading(false);
  };

  return (
    <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
      className="flex-1 flex flex-col p-6 pt-10">
      <header className="flex items-center gap-4 mb-8">
        <button onClick={onBack} className="w-9 h-9 rounded-full flex items-center justify-center"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink-muted)' }}>
          <ChevronLeft size={16} />
        </button>
        <h2 className="text-3xl font-black italic uppercase tracking-tight" style={{ color: 'var(--ink)' }}>Progreso</h2>
      </header>

      <div className="space-y-5 flex-1 overflow-y-auto no-scrollbar pb-10">
        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Sesiones', val: uHistory.length, unit: '', col: 'var(--ink)' },
            { label: 'Mejor carga', val: bestOverall, unit: 'kg', col: 'var(--accent)' },
            { label: 'Volumen total', val: Math.round(totalVol).toLocaleString('es'), unit: 'kg', col: 'var(--ink)' },
            { label: 'Racha', val: streak, unit: ` día${streak !== 1 ? 's' : ''}`, col: streak > 0 ? 'var(--accent)' : 'var(--ink)' },
          ].map(s => (
            <div key={s.label} className="card rounded-2xl p-4">
              <p className="text-[9px] font-black uppercase tracking-widest mb-1" style={{ color: 'var(--ink-muted)' }}>{s.label}</p>
              <p className="text-2xl font-black italic" style={{ color: s.col }}>
                {s.val}<span className="text-base font-bold" style={{ color: 'var(--ink-dim)' }}>{s.unit}</span>
              </p>
            </div>
          ))}
        </div>

        {/* Overall chart */}
        <div className="card-xl p-5">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] mb-5" style={{ color: 'var(--ink-muted)' }}>Carga máxima por sesión</p>
          <div style={{ height: '13rem' }}>
            {overallChart.length >= 2
              ? <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={overallChart}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="date" stroke="var(--ink-dim)" fontSize={10} tickLine={false} axisLine={false} dy={10} />
                    <YAxis stroke="var(--ink-dim)" fontSize={10} tickLine={false} axisLine={false} dx={-10} />
                    <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: 'var(--accent)', fontWeight: 'bold' }} />
                    <Line type="monotone" dataKey="weight" stroke="var(--accent)" strokeWidth={3}
                      dot={{ fill: 'var(--accent)', r: 4, strokeWidth: 0 }} activeDot={{ r: 6, strokeWidth: 0 }} />
                  </LineChart>
                </ResponsiveContainer>
              : <div className="h-full flex items-center justify-center text-[10px] font-black uppercase tracking-widest" style={{ color: 'var(--ink-dim)' }}>Necesitas al menos 2 sesiones</div>
            }
          </div>
        </div>

        {/* Per-exercise chart */}
        <div className="card-xl p-5">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] mb-4" style={{ color: 'var(--ink-muted)' }}>Progreso por ejercicio</p>
          <select value={selEx} onChange={e => setSelEx(e.target.value)}
            className="w-full rounded-xl px-4 py-3 text-sm font-bold outline-none mb-4 cursor-pointer"
            style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--ink)' }}>
            {routine.dias.map(d => (
              <optgroup key={d.dia} label={d.nombre}>
                {d.ejercicios.map(ex => <option key={ex.id} value={ex.id}>{ex.nombre}</option>)}
              </optgroup>
            ))}
          </select>
          {exPR > 0 && (
            <div className="flex items-center justify-between mb-3">
              <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: 'var(--ink-muted)' }}>
                PR: <span style={{ color: 'var(--accent)' }}>{exPR}kg</span>
              </span>
              <span className="text-[9px] font-black" style={{ color: 'var(--ink-dim)' }}>{exChart.length} registro{exChart.length !== 1 ? 's' : ''}</span>
            </div>
          )}
          <div style={{ height: '13rem' }}>
            {exChart.length >= 2
              ? <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={exChart}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="date" stroke="var(--ink-dim)" fontSize={10} tickLine={false} axisLine={false} dy={10} />
                    <YAxis stroke="var(--ink-dim)" fontSize={10} tickLine={false} axisLine={false} dx={-10} />
                    <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: 'var(--accent)', fontWeight: 'bold' }} />
                    <Line type="monotone" dataKey="weight" stroke="var(--accent)" strokeWidth={3}
                      dot={{ fill: 'var(--accent)', r: 4, strokeWidth: 0 }} activeDot={{ r: 6, strokeWidth: 0 }} />
                  </LineChart>
                </ResponsiveContainer>
              : <div className="h-full flex items-center justify-center text-[10px] font-black uppercase tracking-widest" style={{ color: 'var(--ink-dim)' }}>Sin datos suficientes para este ejercicio</div>
            }
          </div>
        </div>

        {/* AI Coach */}
        <div className="card-xl p-6" style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-mid)' }}>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-black" style={{ background: 'var(--accent)', color: '#fff' }}>
              <RefreshCw size={13} className={aiLoading ? 'animate-spin' : ''} />
            </div>
            <span className="text-xs font-black uppercase tracking-widest" style={{ color: 'var(--accent)' }}>AI Coach</span>
            <button onClick={loadAITip} disabled={aiLoading}
              className="ml-auto text-[9px] font-black uppercase tracking-widest disabled:opacity-40"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-muted)' }}>
              {aiLoading ? 'Cargando…' : '↻ Actualizar'}
            </button>
          </div>
          <p className="text-sm leading-relaxed italic" style={{ color: 'var(--ink-muted)' }}>
            "{aiTip || `Llevas ${uHistory.length} sesiones. Pulsa "Actualizar" para un consejo personalizado.`}"
          </p>
        </div>
      </div>
      <Footer />
    </motion.div>
  );
}

// ─── ADMIN PANEL (/admin) ──────────────────────────────────────────────────
type AdminSubview = 'dashboard' | 'upload' | 'profiles' | 'backup';

function AdminPanel({ users, history, routines, theme, onToggleTheme, showToast, onUpdateUsers, onUpdateRoutines, onUpdateHistory, onExportBackup, onImportBackup }: {
  users: UserProfile[];
  history: WorkoutSession[];
  routines: Record<string, Routine>;
  theme: Theme;
  onToggleTheme: () => void;
  showToast: (msg: string) => void;
  onUpdateUsers: (u: UserProfile[]) => void;
  onUpdateRoutines: (r: Record<string, Routine>) => void;
  onUpdateHistory: (h: WorkoutSession[]) => void;
  onExportBackup: () => void;
  onImportBackup: (f: File) => void;
}) {
  const [authed, setAuthed] = useState(false);
  const [pw, setPw] = useState('');
  const [pwErr, setPwErr] = useState(false);
  const [subview, setSubview] = useState<AdminSubview>('dashboard');
  const [uploadedRoutine, setUploadedRoutine] = useState<Routine | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [addForm, setAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newImg, setNewImg] = useState('');
  const [editUser, setEditUser] = useState<UserProfile | null>(null);
  const [editPw, setEditPw] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const submitLogin = () => {
    if (pw === ADMIN_PASSWORD) { setAuthed(true); setPwErr(false); }
    else { setPwErr(true); setTimeout(() => setPwErr(false), 800); }
  };

  if (!authed) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-8" style={{ background: 'var(--bg)' }}>
        <div className="flex justify-end w-full max-w-sm mb-8 absolute top-6 right-6">
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        </div>
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-3 mb-10">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(124,58,237,0.15)', color: '#a78bfa' }}>
              <Shield size={16} />
            </div>
            <div>
              <h2 className="text-xl font-black italic uppercase" style={{ color: 'var(--ink)' }}>Panel Admin</h2>
              <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: 'var(--ink-muted)' }}>Acceso restringido</p>
            </div>
          </div>
          <input autoFocus type="password" value={pw} onChange={e => setPw(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submitLogin()} placeholder="Contraseña de administrador"
            className="input mb-3" style={{ borderColor: pwErr ? 'var(--red)' : undefined }} />
          <button onClick={submitLogin}
            className="w-full py-4 rounded-xl font-black text-xs uppercase tracking-widest text-white"
            style={{ background: '#7c3aed' }}>
            Entrar
          </button>
        </div>
      </div>
    );
  }

  const handleFile = async (file: File) => {
    if (!file.name.match(/\.xlsx?$/i)) { setUploadError('Solo se admiten archivos .xlsx'); return; }
    setUploadError(null); setUploadedRoutine(null);
    try { setUploadedRoutine(await parseExcelToRoutine(file)); }
    catch (err: any) { setUploadError(err.message); }
  };

  const assignRoutine = (userId: string) => {
    if (!uploadedRoutine) return;
    onUpdateRoutines({ ...routines, [userId]: uploadedRoutine });
    setUploadedRoutine(null);
    showToast(`Rutina asignada ✓`);
    setSubview('dashboard');
  };

  const resetRoutine = (userId: string) => {
    const n = { ...routines }; delete n[userId]; onUpdateRoutines(n);
    showToast('Rutina restaurada');
  };

  const addUser = () => {
    if (!newName.trim() || !newUsername.trim() || !newPassword.trim()) { showToast('Rellena nombre, usuario y contraseña'); return; }
    if (users.find(u => u.username.toLowerCase() === newUsername.toLowerCase().trim())) { showToast('Ese nombre de usuario ya existe'); return; }
    const newUser: UserProfile = { id: crypto.randomUUID(), name: newName.trim(), username: newUsername.trim(), password: newPassword, avatarUrl: newImg.trim() || undefined };
    onUpdateUsers([...users, newUser]);
    setNewName(''); setNewUsername(''); setNewPassword(''); setNewImg(''); setAddForm(false);
    showToast(`Usuario ${newName} creado ✓`);
  };

  const removeUser = (id: string) => {
    if (!confirm('¿Eliminar este usuario? Su historial también se borrará.')) return;
    onUpdateUsers(users.filter(u => u.id !== id));
    onUpdateHistory(history.filter(s => s.userName !== id));
    const n = { ...routines }; delete n[id]; onUpdateRoutines(n);
    showToast('Usuario eliminado');
  };

  const saveEditUser = () => {
    if (!editUser) return;
    const updated = users.map(u => u.id === editUser.id ? { ...editUser, password: editPw || editUser.password } : u);
    onUpdateUsers(updated);
    setEditUser(null); setEditPw('');
    showToast('Usuario actualizado ✓');
  };

  const subviews: { key: AdminSubview; label: string }[] = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'upload', label: 'Rutinas' },
    { key: 'profiles', label: 'Usuarios' },
    { key: 'backup', label: 'Backup' },
  ];

  return (
    <div className="flex-1 flex flex-col p-6 pt-10" style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      {/* Header */}
      <header className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-black italic uppercase tracking-tight" style={{ color: 'var(--ink)' }}>Admin</h2>
          <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded" style={{ background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.25)', color: '#a78bfa' }}>
            Panel de control
          </span>
        </div>
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </header>

      {/* Sub-nav */}
      <div className="flex gap-1 rounded-xl p-1 mb-6" style={{ background: 'var(--surface2)', border: '1px solid var(--border)' }}>
        {subviews.map(({ key, label }) => (
          <button key={key} onClick={() => setSubview(key)}
            className="flex-1 py-2 rounded-lg text-[8px] font-black uppercase tracking-wider transition-all"
            style={{ background: subview === key ? 'var(--surface)' : 'transparent', border: subview === key ? '1px solid var(--border)' : '1px solid transparent', color: subview === key ? 'var(--ink)' : 'var(--ink-muted)' }}>
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar pb-10 space-y-4">

        {/* DASHBOARD */}
        {subview === 'dashboard' && users.map(u => {
          const uHistory = history.filter(s => s.userName === u.id);
          const routine = routines[u.id] || ROUTINE_DATA;
          const isCustom = !!routines[u.id];
          const last = uHistory[0];
          return (
            <div key={u.id} className="card-xl overflow-hidden">
              <div className="p-5 flex items-center gap-3" style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface2)' }}>
                <Avatar name={u.name} src={u.avatarUrl} size="sm" />
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-black" style={{ color: 'var(--ink)' }}>{u.name}</h3>
                    <span className="text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded"
                      style={{ background: isCustom ? 'var(--accent-dim)' : 'var(--surface)', border: `1px solid ${isCustom ? 'var(--accent-mid)' : 'var(--border)'}`, color: isCustom ? 'var(--accent)' : 'var(--ink-muted)' }}>
                      {isCustom ? 'Personalizada' : 'Por defecto'}
                    </span>
                  </div>
                  <p className="text-[9px] mt-0.5" style={{ color: 'var(--ink-muted)' }}>@{u.username} · {routine.nombre}</p>
                </div>
              </div>
              <div className="p-4 grid grid-cols-3 gap-2">
                {[{ l: 'Sesiones', v: uHistory.length }, { l: 'Días rutina', v: routine.dias.length }, { l: 'Último', v: last ? format(new Date(last.date), 'dd/MM') : '--' }].map(s => (
                  <div key={s.l} className="rounded-xl p-3 text-center" style={{ background: 'var(--surface2)' }}>
                    <p className="text-[8px] font-black uppercase tracking-widest mb-0.5" style={{ color: 'var(--ink-dim)' }}>{s.l}</p>
                    <p className="text-sm font-black italic" style={{ color: 'var(--ink)' }}>{s.v}</p>
                  </div>
                ))}
              </div>
              {isCustom && (
                <div className="px-4 pb-4">
                  <button onClick={() => resetRoutine(u.id)}
                    className="w-full py-2.5 text-[9px] font-black uppercase tracking-widest rounded-xl transition-all"
                    style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--ink-muted)', cursor: 'pointer' }}
                    onMouseOver={e => { e.currentTarget.style.borderColor = 'var(--red)'; e.currentTarget.style.color = 'var(--red)'; }}
                    onMouseOut={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--ink-muted)'; }}>
                    ↺ Restaurar por defecto
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {subview === 'dashboard' && users.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16" style={{ color: 'var(--ink-dim)' }}>
            <User size={48} className="mb-4 opacity-20" />
            <p className="text-[10px] font-black uppercase tracking-widest">Sin usuarios aún. Ve a "Usuarios".</p>
          </div>
        )}

        {/* UPLOAD / RUTINAS */}
        {subview === 'upload' && <>
          <div>
            <h3 className="font-black mb-1" style={{ color: 'var(--ink)' }}>Subir Excel de Rutina</h3>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
              Cada hoja del Excel es un día. Columnas: <span style={{ color: 'var(--ink)' }}>Ejercicio, Series, Repeticiones, RPE, Descanso, Video, Observaciones</span>.
            </p>
          </div>

          <div ref={dropRef} onClick={() => fileRef.current?.click()}
            className="rounded-[1.5rem] p-10 text-center cursor-pointer transition-all"
            style={{ border: '2px dashed var(--border)' }}
            onDragOver={e => { e.preventDefault(); if (dropRef.current) { dropRef.current.style.borderColor = 'var(--accent)'; dropRef.current.style.background = 'var(--accent-dim)'; }}}
            onDragLeave={() => { if (dropRef.current) { dropRef.current.style.borderColor = 'var(--border)'; dropRef.current.style.background = ''; }}}
            onDrop={e => { e.preventDefault(); if (dropRef.current) { dropRef.current.style.borderColor = 'var(--border)'; dropRef.current.style.background = ''; } const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}>
            <Upload size={26} style={{ color: 'var(--accent)', margin: '0 auto 0.75rem' }} />
            <p className="font-black mb-1" style={{ color: 'var(--ink)' }}>Arrastra tu Excel aquí</p>
            <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: 'var(--ink-muted)' }}>o haz click · .xlsx</p>
          </div>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />

          {uploadError && <div className="rounded-xl p-4 text-sm" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: 'var(--red)' }}>{uploadError}</div>}

          {uploadedRoutine && <>
            <div className="card-xl p-5" style={{ border: '1px solid var(--accent-mid)', background: 'var(--accent-dim)' }}>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ background: 'var(--accent)', color: '#fff' }}>
                  <Check size={12} style={{ strokeWidth: 4 }} />
                </div>
                <span className="font-black" style={{ color: 'var(--accent)' }}>{uploadedRoutine.nombre}</span>
              </div>
              <p className="text-[9px] font-black uppercase tracking-widest mb-3" style={{ color: 'var(--ink-muted)' }}>
                {uploadedRoutine.dias.length} días · {uploadedRoutine.dias.reduce((t, d) => t + d.ejercicios.length, 0)} ejercicios
              </p>
              {uploadedRoutine.dias.map(d => (
                <div key={d.dia} className="rounded-xl p-3 mb-2" style={{ background: 'rgba(0,0,0,0.2)' }}>
                  <p className="font-black text-xs mb-0.5" style={{ color: 'var(--ink)' }}>{d.nombre}</p>
                  <p className="text-[9px]" style={{ color: 'var(--ink-muted)' }}>{d.ejercicios.map(e => e.nombre).join(' · ')}</p>
                </div>
              ))}
            </div>

            <div>
              <p className="text-[9px] font-black uppercase tracking-widest mb-3" style={{ color: 'var(--ink-muted)' }}>Asignar a:</p>
              {users.length === 0
                ? <p className="text-sm" style={{ color: 'var(--ink-dim)' }}>No hay usuarios. Créalos primero en "Usuarios".</p>
                : users.map(u => (
                  <button key={u.id} onClick={() => assignRoutine(u.id)}
                    className="w-full rounded-2xl px-4 py-4 flex items-center justify-between mb-2 transition-all active:scale-[0.98]"
                    style={{ background: 'var(--surface)', border: '1px solid var(--border)', cursor: 'pointer' }}
                    onMouseOver={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                    onMouseOut={e => e.currentTarget.style.borderColor = 'var(--border)'}>
                    <div className="flex items-center gap-3">
                      <Avatar name={u.name} src={u.avatarUrl} size="sm" />
                      <div className="text-left">
                        <p className="font-black" style={{ color: 'var(--ink)' }}>{u.name}</p>
                        <p className="text-[9px]" style={{ color: 'var(--ink-muted)' }}>@{u.username}</p>
                      </div>
                    </div>
                    <ArrowRight size={16} style={{ color: 'var(--ink-dim)' }} />
                  </button>
                ))
              }
            </div>
          </>}

          {/* Format table */}
          <div className="card rounded-xl p-4">
            <p className="text-[9px] font-black uppercase tracking-widest mb-3" style={{ color: 'var(--ink-muted)' }}>Formato de columnas</p>
            <div className="overflow-x-auto">
              <table className="text-[9px] border-collapse w-full">
                <thead>
                  <tr>{['Ejercicio', 'Series', 'Reps', 'RPE', 'Descanso', 'Video', 'Observaciones'].map(h => (
                    <th key={h} className="px-2 py-1.5 font-black uppercase tracking-wide whitespace-nowrap text-left"
                      style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--ink-muted)' }}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  <tr>{['Sentadilla', '3', '8-12', '8,9,10', '240', 'https://...', 'Baja lento'].map((v, i) => (
                    <td key={i} className="px-2 py-1.5" style={{ border: '1px solid var(--border)', color: 'var(--ink-muted)' }}>{v}</td>
                  ))}</tr>
                </tbody>
              </table>
            </div>
          </div>
        </>}

        {/* PROFILES / USUARIOS */}
        {subview === 'profiles' && <>
          <div className="flex items-center justify-between">
            <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: 'var(--ink-muted)' }}>Usuarios ({users.length})</p>
            <button onClick={() => setAddForm(true)}
              className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg"
              style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-mid)', color: 'var(--accent)', cursor: 'pointer' }}>
              <Plus size={11} /> Añadir
            </button>
          </div>

          {users.map(u => (
            <div key={u.id} className="card rounded-2xl p-4 flex items-center gap-3">
              <Avatar name={u.name} src={u.avatarUrl} size="sm" />
              <div className="flex-1">
                <p className="font-black" style={{ color: 'var(--ink)' }}>{u.name}</p>
                <p className="text-[9px]" style={{ color: 'var(--ink-muted)' }}>@{u.username} · {history.filter(s => s.userName === u.id).length} sesiones</p>
              </div>
              <button onClick={() => { setEditUser(u); setEditPw(''); }}
                className="p-2 mr-1 rounded-lg transition-colors"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-dim)' }}
                onMouseOver={e => e.currentTarget.style.color = 'var(--accent)'}
                onMouseOut={e => e.currentTarget.style.color = 'var(--ink-dim)'}>
                ✎
              </button>
              <button onClick={() => removeUser(u.id)}
                className="p-2 rounded-lg transition-colors"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-dim)' }}
                onMouseOver={e => e.currentTarget.style.color = 'var(--red)'}
                onMouseOut={e => e.currentTarget.style.color = 'var(--ink-dim)'}>
                <Trash2 size={15} />
              </button>
            </div>
          ))}

          {addForm && (
            <div className="card rounded-2xl p-5 space-y-3">
              <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: 'var(--ink-muted)' }}>Nuevo usuario</p>
              <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Nombre completo" className="input" />
              <input value={newUsername} onChange={e => setNewUsername(e.target.value)} placeholder="Nombre de usuario (login)" className="input" autoCapitalize="none" />
              <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Contraseña" className="input" />
              <input value={newImg} onChange={e => setNewImg(e.target.value)} placeholder="URL de foto (opcional)" className="input" />
              <div className="flex gap-2">
                <button onClick={addUser} className="btn-accent flex-1">Crear</button>
                <button onClick={() => { setAddForm(false); setNewName(''); setNewUsername(''); setNewPassword(''); setNewImg(''); }} className="btn-secondary flex-1">Cancelar</button>
              </div>
            </div>
          )}

          {/* Edit user modal */}
          <AnimatePresence>
            {editUser && (
              <Modal onClose={() => setEditUser(null)}>
                <h3 className="text-lg font-black italic mb-4" style={{ color: 'var(--ink)' }}>Editar usuario</h3>
                <div className="space-y-3 mb-4">
                  <input value={editUser.name} onChange={e => setEditUser({ ...editUser, name: e.target.value })} placeholder="Nombre" className="input" />
                  <input value={editUser.username} onChange={e => setEditUser({ ...editUser, username: e.target.value })} placeholder="Usuario" className="input" autoCapitalize="none" />
                  <input type="password" value={editPw} onChange={e => setEditPw(e.target.value)} placeholder="Nueva contraseña (dejar vacío para no cambiar)" className="input" />
                  <input value={editUser.avatarUrl || ''} onChange={e => setEditUser({ ...editUser, avatarUrl: e.target.value })} placeholder="URL de foto" className="input" />
                </div>
                <button onClick={saveEditUser} className="btn-accent mb-2">Guardar cambios</button>
                <button onClick={() => setEditUser(null)} className="btn-secondary">Cancelar</button>
              </Modal>
            )}
          </AnimatePresence>
        </>}

        {/* BACKUP */}
        {subview === 'backup' && <>
          <div>
            <h3 className="font-black mb-1" style={{ color: 'var(--ink)' }}>Exportar e importar datos</h3>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
              Usa esto para hacer copias de seguridad o migrar datos entre dispositivos.
            </p>
          </div>

          <button onClick={onExportBackup}
            className="w-full card rounded-2xl p-5 flex items-center gap-4 transition-all active:scale-[0.98] cursor-pointer"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', textAlign: 'left' }}>
            <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>
              <FileDown size={18} />
            </div>
            <div>
              <p className="font-black" style={{ color: 'var(--ink)' }}>Exportar backup</p>
              <p className="text-[10px]" style={{ color: 'var(--ink-muted)' }}>Descarga un .json con todos los datos</p>
            </div>
          </button>

          <div onClick={() => importRef.current?.click()}
            className="w-full card rounded-2xl p-5 flex items-center gap-4 transition-all active:scale-[0.98] cursor-pointer"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: 'var(--surface2)', color: 'var(--ink-muted)' }}>
              <FileUp size={18} />
            </div>
            <div>
              <p className="font-black" style={{ color: 'var(--ink)' }}>Importar backup</p>
              <p className="text-[10px]" style={{ color: 'var(--ink-muted)' }}>Carga un .json exportado previamente</p>
            </div>
          </div>
          <input ref={importRef} type="file" accept=".json" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onImportBackup(f); }} />

          <div className="rounded-xl p-4" style={{ background: 'rgba(234,179,8,0.06)', border: '1px solid rgba(234,179,8,0.2)' }}>
            <p className="text-[9px] font-black uppercase tracking-widest mb-1" style={{ color: '#eab308' }}>⚠ Atención</p>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
              Al importar, los datos actuales serán reemplazados. Exporta primero si quieres conservarlos.
            </p>
          </div>
        </>}
      </div>
    </div>
  );
}
