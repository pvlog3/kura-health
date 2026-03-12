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
          <img src="/kura-logo.svg" alt="Kura" className="w-16 h-16 animate-pulse shadow-2xl shadow-[#A2F0D3]/20 rounded-[20px]" />
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