import React from 'react';
import { useUserRole } from './hooks/useUserRole';
import Auth from './components/Auth';
import DoctorDashboard from './components/DoctorDashboard';
import ClientBooking from './components/ClientBooking';
import Layout from './components/Layout';
import LandlordDashboard from './components/LandlordDashboard';

const App: React.FC = () => {
  const { user, profile, loading } = useUserRole();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#121417]">
        <div className="flex flex-col items-center space-y-6">
          <div className="w-16 h-16 bg-[#A2F0D3] rounded-[20px] flex items-center justify-center p-3 animate-pulse shadow-2xl shadow-[#A2F0D3]/20">
            <svg viewBox="0 0 100 100" className="w-full h-full text-black fill-current">
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
          <p className="text-slate-400 text-xs font-black uppercase tracking-[0.3em] animate-pulse">Connecting to Kura...</p>
        </div>
      </div>
    );
  }

  if (!user || !profile) {
    return (
      <div className="min-h-screen bg-[#121417] flex flex-col justify-center">
        <Auth />
      </div>
    );
  }

  return (
    <Layout profile={profile}>
      {profile.role === 'doctor' ? (
        <DoctorDashboard profile={profile} />
      ) : profile.role === 'landlord' ? (
        <LandlordDashboard profile={profile} />
      ) : (
        <ClientBooking profile={profile} />
      )}
    </Layout>
  );
};

export default App;