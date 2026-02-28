import { useEffect, useRef, useState } from 'react';

interface ServiceStatus {
  qdrant: 'ok' | 'offline' | 'unknown';
  groq_configured: boolean;
}

interface TauriStartupStatus {
  phase: string;
  message: string;
  elapsed_ms: number;
  logs: string[];
}

interface LoadingScreenProps {
  onReady: (status: ServiceStatus) => void;
}

// Gracefully call Tauri invoke — works when running inside the Tauri webview.
// Returns null when running in a plain browser (dev preview without Tauri shell).
async function tauriInvoke<T>(cmd: string): Promise<T | null> {
  try {
    // Dynamic import so we don't crash when @tauri-apps/api isn't resolved
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<T>(cmd);
  } catch {
    return null;
  }
}

const PHASE_ICONS: Record<string, string> = {
  initializing:    '⚙️',
  qdrant:          '🐳',
  qdrant_wait:     '⏳',
  unpacking:       '📦',
  backend_starting:'🚀',
  backend_wait:    '⏳',
  ready:           '✅',
  timeout:         '⚠️',
};

const PHASE_LABELS: Record<string, string> = {
  initializing:    'Initializing',
  qdrant:          'Starting Qdrant',
  qdrant_wait:     'Waiting for Qdrant',
  unpacking:       'Extracting dependencies',
  backend_starting:'Starting backend',
  backend_wait:    'Waiting for backend',
  ready:           'Ready',
  timeout:         'Startup timeout',
};

export function LoadingScreen({ onReady }: LoadingScreenProps) {
  const [tauriStatus, setTauriStatus] = useState<TauriStartupStatus | null>(null);
  const [dots, setDots] = useState('');
  const [error, setError] = useState<string | null>(null);
  const startTimeRef = useRef(Date.now());
  const stoppedRef = useRef(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // ── Animate dots ─────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setDots(d => d.length >= 3 ? '' : d + '.'), 500);
    return () => clearInterval(t);
  }, []);

  // ── Poll Tauri startup status every 400ms ─────────────────────────────────
  useEffect(() => {
    stoppedRef.current = false;
    let rafId = 0;

    const poll = async () => {
      if (stoppedRef.current) return;
      const status = await tauriInvoke<TauriStartupStatus>('get_startup_status');
      if (status && !stoppedRef.current) {
        setTauriStatus(status);
      }
      if (!stoppedRef.current) {
        rafId = window.setTimeout(poll, 400);
      }
    };

    void poll();
    return () => {
      stoppedRef.current = true;
      clearTimeout(rafId);
    };
  }, []);

  // ── Auto-scroll logs to bottom ────────────────────────────────────────────
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [tauriStatus?.logs?.length]);

  // ── Poll /health until backend is up ─────────────────────────────────────
  useEffect(() => {
    stoppedRef.current = false;
    let timeoutId = 0;

    const poll = async () => {
      if (stoppedRef.current) return;
      try {
        const res = await fetch('http://127.0.0.1:3001/health');
        if (res.ok) {
          const json = await res.json() as {
            status: string;
            qdrant?: string;
            groq_configured?: boolean;
          };
          if (!stoppedRef.current) {
            onReady({
              qdrant: (json.qdrant as ServiceStatus['qdrant']) ?? 'unknown',
              groq_configured: json.groq_configured ?? false,
            });
          }
          return;
        }
      } catch {
        // backend not up yet
      }

      const elapsed = Date.now() - startTimeRef.current;
      if (elapsed > 180_000) {
        setError('Backend did not start within 3 minutes. Check that Docker Desktop is running and try restarting the app.');
        return;
      }

      if (!stoppedRef.current) {
        timeoutId = window.setTimeout(poll, 1200);
      }
    };

    void poll();
    return () => {
      stoppedRef.current = true;
      clearTimeout(timeoutId);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const phase = tauriStatus?.phase ?? 'initializing';
  const message = tauriStatus?.message ?? 'Starting up...';
  const elapsedSec = tauriStatus ? Math.floor(tauriStatus.elapsed_ms / 1000) : 0;
  const logs = tauriStatus?.logs ?? [];
  const phaseIcon = PHASE_ICONS[phase] ?? '⚙️';
  const isStuck = elapsedSec > 25;
  const isFirstLaunch = phase === 'unpacking';

  return (
    <div style={s.overlay}>
      <div style={s.card}>

        {/* ── Logo ── */}
        <div style={s.logoRow}>
          <div style={s.logoIcon}><CanvaIntelIcon /></div>
          <span style={s.logoText}>CanvaIntel</span>
        </div>

        {error ? (
          <ErrorBox message={error} />
        ) : (
          <>
            {/* ── Phase badge + spinner ── */}
            <div style={s.statusRow}>
              <span style={s.phaseIcon}>{phaseIcon}</span>
              <div style={s.statusText}>
                <div style={s.phaseLabel}>
                  {PHASE_LABELS[phase] ?? 'Starting'}{dots}
                </div>
                <div style={s.phaseMessage}>{message}</div>
              </div>
              {phase !== 'ready' && <Spinner />}
            </div>

            {/* ── Progress steps ── */}
            <StepBar phase={phase} />

            {/* ── Live log tail ── */}
            {logs.length > 0 && (
              <div style={s.logBox}>
                {logs.slice(-12).map((line, i) => (
                  <div key={i} style={{
                    ...s.logLine,
                    opacity: i < logs.slice(-12).length - 3 ? 0.55 : 1,
                    color: line.includes('⚠') ? '#E07B39' : line.includes('✓') ? '#3AA05C' : '#A8A29E',
                  }}>
                    {line}
                  </div>
                ))}
                <div ref={logsEndRef} />
              </div>
            )}

            {/* ── Elapsed / hints ── */}
            {elapsedSec > 5 && (
              <div style={s.hint}>
                {isFirstLaunch
                  ? `First launch — extracting node_modules... (${elapsedSec}s)`
                  : elapsedSec < 20
                  ? `Hang tight — usually takes 10–20s`
                  : `${elapsedSec}s elapsed`}
              </div>
            )}

            {isStuck && !isFirstLaunch && (
              <div style={s.hintBox}>
                <HintRow icon="🐳" text="Ensure Docker Desktop is running for Qdrant" />
                <HintRow icon="📁" text="Node.js must be installed and in PATH" />
              </div>
            )}
          </>
        )}
      </div>
      <div style={s.footer}>v0.1.0</div>
    </div>
  );
}

// ── Step bar ──────────────────────────────────────────────────────────────────

const STEPS = [
  { key: 'qdrant',          label: 'Qdrant' },
  { key: 'unpacking',       label: 'Dependencies' },
  { key: 'backend_starting',label: 'Backend' },
  { key: 'ready',           label: 'Ready' },
] as const;

const PHASE_STEP: Record<string, number> = {
  initializing:    0,
  qdrant:          0,
  qdrant_wait:     1,
  unpacking:       1,
  backend_starting:2,
  backend_wait:    2,
  ready:           3,
  timeout:         2,
};

function StepBar({ phase }: { phase: string }) {
  const activeIdx = PHASE_STEP[phase] ?? 0;
  return (
    <div style={s.stepBar}>
      {STEPS.map((step, idx) => {
        const done    = idx < activeIdx;
        const current = idx === activeIdx;
        return (
          <div key={step.key} style={s.stepItem}>
            <div style={{
              ...s.stepDot,
              background: done ? '#3AA05C' : current ? '#5B5BD6' : 'var(--border)',
              boxShadow: current ? '0 0 0 3px rgba(91,91,214,0.18)' : 'none',
            }}>
              {done ? '✓' : idx + 1}
            </div>
            <div style={{
              ...s.stepLabel,
              color: done ? '#3AA05C' : current ? '#5B5BD6' : 'var(--text-4, #A8A29E)',
              fontWeight: current ? 600 : 400,
            }}>
              {step.label}
            </div>
            {idx < STEPS.length - 1 && (
              <div style={{
                ...s.stepLine,
                background: done ? '#3AA05C' : 'var(--border)',
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ErrorBox({ message }: { message: string }) {
  return (
    <div style={s.errorBox}>
      <div style={s.errorTitle}>⚠ Startup failed</div>
      <div style={s.errorMsg}>{message}</div>
      <button style={s.retryBtn} onClick={() => window.location.reload()}>
        Retry
      </button>
    </div>
  );
}

function HintRow({ icon, text }: { icon: string; text: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5 }}>
      <span>{icon}</span>
      <span style={{ color: '#78716C', lineHeight: 1.4 }}>{text}</span>
    </div>
  );
}

function Spinner() {
  return (
    <svg width="28" height="28" viewBox="0 0 36 36" fill="none" style={{ flexShrink: 0 }}>
      <style>{`@keyframes ls-spin { to { transform: rotate(360deg); } } .ls-ring { animation: ls-spin 0.85s linear infinite; transform-origin: 18px 18px; }`}</style>
      <circle cx="18" cy="18" r="14" stroke="#E8E5DF" strokeWidth="3" />
      <path className="ls-ring" d="M18 4 A14 14 0 0 1 32 18" stroke="#5B5BD6" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function CanvaIntelIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 28 28" fill="none">
      <rect x="2"  y="2"  width="11" height="11" rx="2.5" fill="#5B5BD6" />
      <rect x="15" y="2"  width="11" height="11" rx="2.5" fill="#5B5BD6" opacity="0.6" />
      <rect x="2"  y="15" width="11" height="11" rx="2.5" fill="#5B5BD6" opacity="0.6" />
      <rect x="15" y="15" width="11" height="11" rx="2.5" fill="#5B5BD6" opacity="0.3" />
    </svg>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 9999,
    background: '#F5F3EE',
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    fontFamily: "'Inter', system-ui, sans-serif",
  },
  card: {
    display: 'flex', flexDirection: 'column', alignItems: 'stretch',
    gap: 18, padding: '32px 36px',
    background: '#FEFCF9',
    border: '1px solid rgba(28,25,23,0.08)',
    borderRadius: 20,
    boxShadow: '0 8px 32px rgba(28,25,23,0.08), 0 2px 8px rgba(28,25,23,0.04)',
    width: 400, maxWidth: '92vw',
  },

  // Logo
  logoRow: {
    display: 'flex', alignItems: 'center', gap: 10,
    paddingBottom: 4,
  },
  logoIcon: {
    width: 48, height: 48, borderRadius: 14,
    background: '#EEEEFF',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  logoText: {
    fontSize: 20, fontWeight: 700, color: '#1C1917', letterSpacing: '-0.03em',
  },

  // Status row
  statusRow: {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '12px 14px',
    background: '#F5F3EE', borderRadius: 12,
    border: '1px solid rgba(28,25,23,0.06)',
  },
  phaseIcon: { fontSize: 20, lineHeight: 1, flexShrink: 0 },
  statusText: { flex: 1, minWidth: 0 },
  phaseLabel: {
    fontSize: 13, fontWeight: 600, color: '#1C1917', letterSpacing: '-0.01em',
  },
  phaseMessage: {
    fontSize: 11.5, color: '#78716C', marginTop: 2, lineHeight: 1.4,
  },

  // Step bar
  stepBar: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '0 4px',
  },
  stepItem: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    gap: 4, flex: 1, position: 'relative',
  },
  stepDot: {
    width: 22, height: 22, borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 9, fontWeight: 700, color: '#fff',
    transition: 'all 300ms ease', zIndex: 1,
  },
  stepLabel: { fontSize: 10, letterSpacing: '0.01em', textAlign: 'center' as const },
  stepLine: {
    position: 'absolute', top: 11, left: '55%', right: '-55%',
    height: 2, borderRadius: 1,
    transition: 'background 300ms ease',
  },

  // Live log
  logBox: {
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    fontSize: 10.5, lineHeight: 1.55,
    background: '#1C1917', borderRadius: 10,
    padding: '10px 12px',
    maxHeight: 140, overflowY: 'auto' as const,
    display: 'flex', flexDirection: 'column', gap: 1,
  },
  logLine: {
    whiteSpace: 'pre-wrap' as const, wordBreak: 'break-all' as const,
    transition: 'opacity 200ms ease',
  },

  // Hints
  hint: {
    fontSize: 11, color: '#A8A29E', textAlign: 'center' as const, lineHeight: 1.5,
  },
  hintBox: {
    display: 'flex', flexDirection: 'column', gap: 6,
    padding: '10px 14px',
    background: '#FEF4E8', borderRadius: 10,
    border: '1px solid rgba(194,120,50,0.18)',
  },

  // Error
  errorBox: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
    padding: '16px', background: '#FEECEB',
    border: '1px solid rgba(201,64,60,0.18)', borderRadius: 12,
  },
  errorTitle: { fontSize: 13, fontWeight: 600, color: '#C9403C' },
  errorMsg: { fontSize: 11.5, color: '#57534E', textAlign: 'center' as const, lineHeight: 1.6 },
  retryBtn: {
    padding: '6px 18px', borderRadius: 8,
    background: '#5B5BD6', color: '#fff', border: 'none',
    fontSize: 12, fontWeight: 600, cursor: 'pointer', marginTop: 4,
  },

  footer: {
    position: 'fixed' as const, bottom: 20,
    fontSize: 11, color: '#C7C0BA', letterSpacing: '0.02em',
  },
};
