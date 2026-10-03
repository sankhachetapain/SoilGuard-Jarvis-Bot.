/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { SoilGuardCore } from './components/SoilGuardCore';

export default function App() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center p-6 relative">
      {/* Background Decorative Grid */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/4 -left-20 w-96 h-96 bg-core-primary/5 blur-[120px] rounded-full animate-pulse" />
        <div className="absolute bottom-1/4 -right-20 w-96 h-96 bg-core-secondary/5 blur-[120px] rounded-full animate-pulse decoration-delay-2000" />
      </div>

      <main className="relative z-10 w-full max-w-7xl">
        <SoilGuardCore />
      </main>

      {/* Footer Branding */}
      <div className="fixed bottom-8 left-12 opacity-30 flex items-center gap-2">
         <div className="w-1 h-3 bg-core-primary"></div>
         <span className="text-[10px] font-mono text-core-primary tracking-[0.5em] uppercase">SoilGuard Architecture v2</span>
      </div>
    </div>
  );
}


