import React, { useState } from 'react';
import { auth, db } from '../firebase';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile, sendPasswordResetEmail } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import type { UserRole } from '../types';

const CATEGORIES_DATA: Record<string, string[]> = {
  'Medicine': ['Orthopedist', 'General Practitioner', 'ENT', 'Cardiologist', 'Pediatrician'],
  'Physiotherapy': ['Sports', 'Orthopedic', 'Postural', 'Neurological'],
  'Dentistry': ['Orthodontics', 'Pediatric', 'Implants', 'Endodontics'],
  'Psychology': ['CBT', 'Psychoanalysis', 'Child', 'Couple'],
  'Nutrition': ['Sports', 'Clinical', 'Functional', 'Vegetarian']
};

const KuraLogoLarge = () => (
  <div className="flex flex-col items-center space-y-6 mb-12">
    <div className="w-24 h-24 bg-[#A2F0D3] rounded-[28px] flex items-center justify-center p-4 shadow-2xl shadow-[#A2F0D3]/20">
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
    <h1 className="text-4xl font-black tracking-[0.15em] text-white">KURA</h1>
  </div>
);

const Auth: React.FC = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<UserRole>('patient');
  const [category, setCategory] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [graduation, setGraduation] = useState('');
  const [linkedin, setLinkedin] = useState('');
  const [location, setLocation] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        const profileData = {
          uid: user.uid,
          email,
          name,
          role,
          category: role === 'doctor' ? category : null,
          specialty: role === 'doctor' ? specialty : null,
          graduation: role === 'doctor' ? graduation : null,
          linkedin: role === 'doctor' ? linkedin : null,
          location: role === 'doctor' ? location : null,
          bio: role === 'doctor' ? `Healthcare professional dedicated to excellent patient care.` : null,
          createdAt: new Date().toISOString()
        };

        await setDoc(doc(db, 'users', user.uid), profileData);
        await updateProfile(user, { displayName: name });
      }
    } catch (err: any) {
      let msg = err.message;
      if (err.code === 'auth/user-not-found') msg = "User not found.";
      if (err.code === 'auth/wrong-password') msg = "Incorrect password.";
      setError(msg || 'Authentication failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email) {
      setError('Please enter your email address first.');
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email);
      setError('Password reset email sent. Please check your inbox.');
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="min-h-screen bg-[#121417] flex flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-[420px] flex flex-col">
        <KuraLogoLarge />

        {/* Auth Tabs */}
        <div className="flex border-b border-slate-800 mb-8">
          <button
            onClick={() => { setIsLogin(true); setError(''); }}
            className={`flex-1 pb-4 text-2xl font-bold transition-all relative ${isLogin ? 'text-white' : 'text-slate-500'}`}
          >
            Log in
            {isLogin && <div className="absolute bottom-0 left-0 w-full h-1 bg-[#5D44FF] rounded-t-full transition-all duration-300" />}
          </button>
          <button
            onClick={() => { setIsLogin(false); setError(''); }}
            className={`flex-1 pb-4 text-2xl font-bold transition-all relative ${!isLogin ? 'text-white' : 'text-slate-500'}`}
          >
            Create Account
            {!isLogin && <div className="absolute bottom-0 left-0 w-full h-1 bg-[#5D44FF] rounded-t-full transition-all duration-300" />}
          </button>
        </div>

        <p className="text-slate-400 text-sm mb-8 leading-relaxed font-medium">
          {isLogin 
            ? "Book your appointment in 3 clicks! Let's get started" 
            : "Join Kura and connect with the best healthcare professionals nearby."}
        </p>

        {error && (
          <div className={`mb-6 p-4 rounded-xl text-xs font-bold uppercase tracking-wider ${error.includes('sent') ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {!isLogin && (
            <div className="animate-in fade-in slide-in-from-top-2 duration-300 space-y-5">
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-[#1a1d21] border border-slate-800 rounded-2xl px-6 py-4 text-white placeholder-slate-500 focus:border-[#5D44FF] outline-none transition-all"
                placeholder="Full Name"
              />

              <div className="relative">
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as UserRole)}
                  className="w-full bg-[#1a1d21] border border-slate-800 rounded-2xl px-6 py-4 text-white appearance-none outline-none focus:border-[#5D44FF] transition-all"
                >
                  <option value="patient">I am a Patient</option>
                  <option value="doctor">I am a Healthcare Professional</option>
                  <option value="landlord">I am a Landlord (Rent a room)</option>
                </select>
                <div className="absolute right-6 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M19 9l-7 7-7-7" /></svg>
                </div>
              </div>

              {role === 'doctor' && (
                <div className="space-y-5 animate-in fade-in duration-300">
                   <select
                    required
                    value={category}
                    onChange={(e) => { setCategory(e.target.value); setSpecialty(''); }}
                    className="w-full bg-[#1a1d21] border border-slate-800 rounded-2xl px-6 py-4 text-white outline-none focus:border-[#5D44FF] transition-all"
                  >
                    <option value="">Select Field</option>
                    {Object.keys(CATEGORIES_DATA).map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>

                  {category && (
                    <select
                      required
                      value={specialty}
                      onChange={(e) => setSpecialty(e.target.value)}
                      className="w-full bg-[#1a1d21] border border-slate-800 rounded-2xl px-6 py-4 text-white outline-none focus:border-[#5D44FF] transition-all"
                    >
                      <option value="">Select Specialty</option>
                      {CATEGORIES_DATA[category].map(spec => (
                        <option key={spec} value={spec}>{spec}</option>
                      ))}
                    </select>
                  )}

                  <input
                    type="text"
                    required
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    className="w-full bg-[#1a1d21] border border-slate-800 rounded-2xl px-6 py-4 text-white placeholder-slate-500 focus:border-[#5D44FF] outline-none transition-all"
                    placeholder="Practice Address"
                  />
                </div>
              )}
            </div>
          )}

          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full bg-[#1a1d21] border border-slate-800 rounded-2xl px-6 py-4 text-white placeholder-slate-500 focus:border-[#5D44FF] outline-none transition-all"
            placeholder="Email"
          />

          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-[#1a1d21] border border-slate-800 rounded-2xl px-6 py-4 text-white placeholder-slate-500 focus:border-[#5D44FF] outline-none transition-all"
              placeholder="Password"
            />
            <button 
              type="button" 
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-6 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors"
            >
              {showPassword ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.542-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" /></svg>
              )}
            </button>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-5 bg-[#5D44FF] text-white rounded-[2.5rem] font-bold text-lg hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 transition-all shadow-2xl shadow-[#5D44FF]/30 mt-4"
          >
            {loading ? (
              <div className="flex items-center justify-center space-x-2">
                <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                <span>Processing...</span>
              </div>
            ) : (isLogin ? 'Login' : 'Sign Up')}
          </button>
        </form>

        {isLogin && (
          <button
            onClick={handleForgotPassword}
            className="mt-8 text-center text-slate-400 text-sm font-bold hover:text-white transition-colors"
          >
            Forgot password?
          </button>
        )}
      </div>
    </div>
  );
};

export default Auth;