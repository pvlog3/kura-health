
import React from 'react';
import { auth } from '../firebase';
// Fix: Use standard named import for signOut to resolve compiler errors.
import { signOut } from 'firebase/auth';
import type { UserProfile } from '../types';

// Fix: Defined LayoutProps interface to resolve the "Cannot find name 'LayoutProps'" error on line 25.
interface LayoutProps {
  children: React.ReactNode;
  profile: UserProfile | null;
}

const KuraLogo = () => (
  <div className="w-9 h-9 bg-[#A2F0D3] rounded-[10px] flex items-center justify-center p-1.5 shadow-lg shadow-[#A2F0D3]/10">
    <svg viewBox="0 0 100 100" className="w-full h-full text-black fill-current">
      {/* 8-petal floral icon recreation */}
      <g transform="translate(50, 50)">
        {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
          <path
            key={angle}
            transform={`rotate(${angle})`}
            d="M 0 -10 C 15 -10, 15 -35, 0 -35 C -15 -35, -15 -10, 0 -10 Z"
          />
        ))}
      </g>
    </svg>
  </div>
);

const Layout: React.FC<LayoutProps> = ({ children, profile }) => {
  const handleLogout = () => signOut(auth);
  const isLightTheme = profile?.role === 'doctor' || profile?.role === 'landlord';

  return (
    <div className={`min-h-screen flex flex-col ${isLightTheme ? 'bg-slate-50' : 'bg-[#121417]'}`}>
      <header className={`${isLightTheme ? 'bg-white border-b border-slate-200' : 'bg-[#121417]/80 backdrop-blur-md border-b border-slate-800'} sticky top-0 z-50`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-20">
            <div className="flex items-center space-x-3">
              <KuraLogo />
              <span className={`text-2xl font-black tracking-tighter ${isLightTheme ? 'text-slate-900' : 'text-white'}`}>Kura</span>
            </div>
            
            {profile && (
              <div className="flex items-center space-x-4">
                <div className="text-right hidden sm:block">
                  <p className={`text-sm font-bold ${isLightTheme ? 'text-slate-900' : 'text-white'}`}>{profile.name}</p>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{profile.role}</p>
                </div>
                <button
                  onClick={handleLogout}
                  className={`px-5 py-2.5 text-xs font-black uppercase tracking-widest rounded-full transition-all ${
                    isLightTheme 
                    ? 'text-slate-600 bg-slate-100 hover:bg-slate-200' 
                    : 'text-slate-300 bg-[#1e2124] hover:bg-slate-800 border border-slate-800'
                  }`}
                >
                  Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>

      {!isLightTheme && <div className="h-20" />} {/* Spacer for bottom nav */}
      
      <footer className={`${isLightTheme ? 'bg-white border-t border-slate-200' : 'bg-[#121417] border-t border-slate-800'} py-8`}>
        <div className="max-w-7xl mx-auto px-4 text-center">
          <div className="flex justify-center mb-4">
             <KuraLogo />
          </div>
          <p className="text-slate-500 text-xs font-medium tracking-tight uppercase tracking-[0.2em]">© 2024 Kura Health. Reimagining healthcare connections.</p>
        </div>
      </footer>
    </div>
  );
};

export default Layout;
