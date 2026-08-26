import { Download, MonitorSmartphone, Code2, ArrowRight, Loader2 } from 'lucide-react';
import { useState, useEffect } from 'react';

export function ClientDownloadsPage() {
  const [release, setRelease] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('https://api.github.com/repos/Yuslash/WorkPulse/releases/latest')
      .then((res) => {
        if (!res.ok) throw new Error('Network response was not ok');
        return res.json();
      })
      .then((data) => {
        setRelease(data);
        setLoading(false);
      })
      .catch((error) => {
        console.error('Error fetching release:', error);
        setLoading(false);
      });
  }, []);

  const version = release?.tag_name || '1.0.1';
  const releaseDate = release?.published_at 
    ? new Date(release.published_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : 'August 26, 2026';
    
  const downloadUrl = release?.assets?.find((a: any) => a.name.endsWith('.exe'))?.browser_download_url 
    || 'https://github.com/Yuslash/WorkPulse/releases/latest/download/WorkPulseAgent.exe';
    
  const releaseBody = release?.body || "Added interactive global installation on normal execution.\nAdded Shift Selection (Day, Night, Midnight) via terminal.\nAgent now pauses telemetry automatically when outside of your selected shift boundaries.\nAutomatic background updates support.";

  return (
    <div className="flex flex-col gap-6 p-6 max-w-5xl mx-auto w-full animate-in fade-in zoom-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-fg">Client Downloads</h1>
        <p className="text-muted-fg mt-1">Download the WorkPulse agent for Windows and view recent updates.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 relative overflow-hidden group bg-surface border border-border/80 rounded-xl shadow-warm-sm p-6 flex flex-col gap-6">
          <div className="absolute inset-0 bg-gradient-to-br from-accent/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
          
          <div className="flex flex-col">
            <div className="w-12 h-12 bg-accent/10 rounded-2xl flex items-center justify-center mb-4 text-accent ring-1 ring-accent/20">
              <MonitorSmartphone className="w-6 h-6" />
            </div>
            <h2 className="text-2xl font-semibold text-fg tracking-tight">WorkPulse Agent for Windows</h2>
            <p className="text-base mt-2 text-muted-fg">
              The lightweight, secure endpoint agent. Records foreground activity and idle time without accessing personal files, keystrokes, or screen contents.
            </p>
          </div>
          
          <div className="space-y-4 relative z-10 flex-1">
            <div className="flex items-center justify-between p-4 bg-surface rounded-xl border border-border/80 shadow-warm-sm">
              <div className="flex items-center gap-3">
                <Code2 className="w-5 h-5 text-muted-fg" />
                <div>
                  <p className="text-sm font-medium text-fg">Version {version}</p>
                  <p className="text-xs text-muted-fg">Released {releaseDate} • Windows 10/11 (64-bit)</p>
                </div>
              </div>
              <div className="text-xs font-mono text-muted-fg bg-elevated px-2 py-1 rounded-md">
                x86_64-pc-windows-msvc
              </div>
            </div>
            
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-fg uppercase tracking-wider">What's New in {version}</h3>
              <div className="text-sm text-muted-fg bg-accent/5 p-4 rounded-lg border border-accent/10 whitespace-pre-wrap">
                {loading ? <Loader2 className="w-5 h-5 animate-spin text-accent" /> : releaseBody}
              </div>
            </div>
          </div>
          
          <div className="pt-2 relative z-10 mt-auto">
            <a 
              href={downloadUrl}
              className="inline-flex bg-accent hover:bg-accent/90 text-white font-semibold py-2.5 px-6 rounded-lg shadow-warm items-center gap-2 transition-all group/btn w-fit"
            >
              <Download className="w-4 h-4" />
              Download Installer (.exe)
              <ArrowRight className="w-4 h-4 ml-1 opacity-50 group-hover/btn:translate-x-1 group-hover/btn:opacity-100 transition-all" />
            </a>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-surface border border-border/80 rounded-xl shadow-warm-sm p-6">
            <h2 className="text-lg font-semibold text-fg mb-4">Installation Guide</h2>
            <div className="text-sm text-muted-fg space-y-4">
              <p>
                1. Download the <strong>WorkPulseAgent.exe</strong> file.
              </p>
              <p>
                2. Run the executable. It will prompt you to install it globally so it starts automatically on login.
              </p>
              <p>
                3. Follow the interactive terminal prompts to select your active work shift (Day, Night, or Midnight).
              </p>
              <div className="p-3 bg-accent/5 rounded-lg border border-accent/10 mt-4">
                <p className="text-xs text-accent">
                  <strong>Note:</strong> Enrollment requires a one-time password generated by your HR Administrator.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
