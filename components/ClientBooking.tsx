import React, { useEffect, useState, useMemo } from 'react';
import { db } from '../firebase';
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  addDoc, 
  onSnapshot,
  doc,
  updateDoc,
  getDoc,
  limit
} from 'firebase/firestore';
import type { UserProfile, Appointment, Review, WorkingHours } from '../types';
import { GoogleGenAI, Type } from "@google/genai";

interface ClientBookingProps { profile: UserProfile; }

type ViewState = 'home' | 'agenda' | 'specialist-list' | 'doctor-profile';

const CATEGORIES_CONFIG = [
  { id: 'Medicine', icon: '🩺', color: 'bg-blue-600', specialties: ['Orthopedist', 'General Practitioner', 'ENT', 'Cardiologist', 'Pediatrician'] },
  { id: 'Physiotherapy', icon: '🦴', color: 'bg-emerald-600', specialties: ['Sports', 'Orthopedic', 'Postural', 'Neurological'] },
  { id: 'Dentistry', icon: '🦷', color: 'bg-purple-600', specialties: ['Orthodontics', 'Pediatric', 'Implants', 'Endodontics'] },
  { id: 'Psychology', icon: '🧠', color: 'bg-orange-600', specialties: ['CBT', 'Psychoanalysis', 'Child', 'Couple'] },
  { id: 'Nutrition', icon: '🍎', color: 'bg-rose-600', specialties: ['Sports', 'Clinical', 'Functional', 'Vegetarian'] }
];

interface HealthTip {
  category: string;
  title: string;
  text: string;
  icon: string;
  accent: string;
}

const ClientBooking: React.FC<ClientBookingProps> = ({ profile }) => {
  const [currentView, setCurrentView] = useState<ViewState>('home');
  const [doctors, setDoctors] = useState<UserProfile[]>([]);
  const [myAppointments, setMyAppointments] = useState<Appointment[]>([]);
  const [loadingDoctors, setLoadingDoctors] = useState(true);
  
  // Selection states
  const [inspectingApp, setInspectingApp] = useState<Appointment | null>(null);
  const [inspectingDoctorInfo, setInspectingDoctorInfo] = useState<UserProfile | null>(null);
  const [viewingDoctor, setViewingDoctor] = useState<UserProfile | null>(null);
  
  // Modals / State
  const [bookingFor, setBookingFor] = useState<UserProfile | null>(null);
  const [bookingDate, setBookingDate] = useState('');
  const [bookingTime, setBookingTime] = useState('');
  const [bookingType, setBookingType] = useState<'virtual' | 'in-person'>('in-person');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  
  // Slots State
  const [existingDayAppointments, setExistingDayAppointments] = useState<Appointment[]>([]);
  const [fetchingSlots, setFetchingSlots] = useState(false);
  
  // Cancellation logic
  const [appToCancel, setAppToCancel] = useState<Appointment | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [showCancelSuccess, setShowCancelSuccess] = useState(false);
  
  // History Visibility
  const [showCanceledHistory, setShowCanceledHistory] = useState(false);
  
  const [showSuccessPopup, setShowSuccessPopup] = useState(false);
  const [healthTips, setHealthTips] = useState<HealthTip[]>([]);

  // AI Symptom Bot
  const [showAiBot, setShowAiBot] = useState(false);
  const [aiMessages, setAiMessages] = useState<{ role: 'user' | 'assistant'; text: string }[]>([
    { role: 'assistant', text: "Hi! I'm your Kura health assistant. Describe your symptoms and I'll help you find the best professional. What brings you here today?" }
  ]);
  const [aiInput, setAiInput] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<{ category: string; specialty: string; reason: string } | null>(null);

  useEffect(() => {
    const fetchDoctors = async () => {
      const q = query(collection(db, 'users'), where('role', '==', 'doctor'));
      try {
        const querySnapshot = await getDocs(q);
        const docsArr: UserProfile[] = [];
        querySnapshot.forEach((docSnap) => docsArr.push({ ...docSnap.data() } as UserProfile));
        setDoctors(docsArr);
      } catch (error) { console.error("Error fetching doctors:", error); } 
      finally { setLoadingDoctors(false); }
    };

    const qApp = query(collection(db, 'appointments'), where('patientId', '==', profile.uid));
    const unsubscribe = onSnapshot(qApp, (snapshot) => {
      const apps = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as Appointment));
      apps.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      setMyAppointments(apps);
    });

    fetchDoctors();
    generateAiHealthTips();
    return () => unsubscribe();
  }, [profile.uid]);

  // Handle Fetching Doctor Info for Inspection
  useEffect(() => {
    if (inspectingApp) {
      const fetchDoc = async () => {
        const docRef = doc(db, 'users', inspectingApp.doctorId);
        const snap = await getDoc(docRef);
        if (snap.exists()) setInspectingDoctorInfo(snap.data() as UserProfile);
      };
      fetchDoc();
    } else {
      setInspectingDoctorInfo(null);
    }
  }, [inspectingApp]);

  useEffect(() => {
    if (bookingFor && bookingDate) {
      const fetchAvailability = async () => {
        setFetchingSlots(true);
        try {
          const startOfDay = `${bookingDate}T00:00:00`;
          const endOfDay = `${bookingDate}T23:59:59`;
          const q = query(
            collection(db, 'appointments'),
            where('doctorId', '==', bookingFor.uid),
            where('date', '>=', startOfDay),
            where('date', '<=', endOfDay)
          );
          const snap = await getDocs(q);
          const apps = snap.docs.map(d => d.data() as Appointment);
          setExistingDayAppointments(apps.filter(a => a.status !== 'cancelled'));
        } catch (error) { console.error(error); } finally { setFetchingSlots(false); }
      };
      fetchAvailability();
    }
  }, [bookingFor, bookingDate]);

  const generateAiHealthTips = async () => {
    try {
      const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_API_KEY ?? import.meta.env.VITE_GEMINI_API_KEY ?? (typeof process !== 'undefined' && process.env?.API_KEY) });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Generate 4 distinct health tips for ${profile.name}. Use valid Google Material Symbol names for icons. 
        Return JSON array: {category, title, text, icon, accent: 'blue'|'emerald'|'amber'|'rose'|'indigo'}`,
        config: { 
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                category: { type: Type.STRING },
                title: { type: Type.STRING },
                text: { type: Type.STRING },
                icon: { type: Type.STRING },
                accent: { type: Type.STRING }
              },
              required: ["category", "title", "text", "icon", "accent"]
            }
          }
        }
      });
      const jsonStr = response.text?.trim();
      if (jsonStr) setHealthTips(JSON.parse(jsonStr));
    } catch (error) {
      setHealthTips([
        { category: 'Nutrition', title: 'Hydration Strategy', text: 'Optimize metabolic function with 3L of daily hydration.', icon: 'water_drop', accent: 'blue' },
        { category: 'Vitality', title: 'Strength Protocol', text: 'Preserve bone density with twice-weekly resistance training.', icon: 'fitness_center', accent: 'emerald' },
        { category: 'Cognition', title: 'Neuroplasticity', text: 'Enhance focus with 10 minutes of deep breathwork.', icon: 'psychology', accent: 'indigo' },
        { category: 'Clinical', title: 'Vitals Sync', text: 'Monitor resting heart rate for early wellness trends.', icon: 'ecg_heart', accent: 'rose' }
      ]);
    }
  };

  const handleSymptomSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = aiInput.trim();
    if (!text || aiLoading) return;

    setAiMessages(prev => [...prev, { role: 'user', text }]);
    setAiInput('');
    setAiLoading(true);
    setAiSuggestion(null);

    try {
      const validCategories = CATEGORIES_CONFIG.map(c => c.id).join(', ');
      const validSpecialties = CATEGORIES_CONFIG.map(c => `${c.id}: [${c.specialties.join(', ')}]`).join('; ');
      const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_API_KEY ?? import.meta.env.VITE_GEMINI_API_KEY ?? process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-1.5-flash',
        contents: `You are a medical triage assistant. Based on these symptoms: "${text}"

Available categories: ${validCategories}
Available specialties per category: ${validSpecialties}

Return ONLY valid JSON: { "category": "one of ${validCategories}", "specialty": "exact specialty name from that category", "reason": "brief 1-2 sentence explanation for the patient" }
If unclear or emergency (chest pain, difficulty breathing, stroke symptoms), return: { "category": "Medicine", "specialty": "General Practitioner", "reason": "For general assessment. If urgent, please seek emergency care." }`,
        config: { responseMimeType: 'application/json' }
      });
      const jsonStr = response.text?.trim();
      if (jsonStr) {
        const parsed = JSON.parse(jsonStr);
        const suggestion = { category: parsed.category, specialty: parsed.specialty, reason: parsed.reason };
        setAiSuggestion(suggestion);
        setAiMessages(prev => [...prev, {
          role: 'assistant',
          text: `Based on your symptoms, I recommend seeing a **${parsed.specialty}** (${parsed.category}). ${parsed.reason}\n\nWould you like to browse specialists in this area?`
        }]);
      }
    } catch (err) {
      setAiMessages(prev => [...prev, {
        role: 'assistant',
        text: "I couldn't analyze that right now. Please try again or browse our Clinical Specialties below to find the right professional."
      }]);
    } finally {
      setAiLoading(false);
    }
  };

  const handleViewSuggestedSpecialists = () => {
    if (aiSuggestion) {
      setSelectedCategory(aiSuggestion.category);
      setCurrentView('specialist-list');
      setShowAiBot(false);
      setAiSuggestion(null);
    }
  };

  const handleBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bookingFor || !bookingDate || !bookingTime) return;
    try {
      const fullDateTime = `${bookingDate}T${bookingTime}:00`;
      await addDoc(collection(db, 'appointments'), {
        doctorId: bookingFor.uid,
        doctorName: bookingFor.name,
        patientId: profile.uid,
        patientName: profile.name,
        date: fullDateTime,
        type: bookingType,
        status: 'pending',
        createdAt: new Date().toISOString()
      });
      setBookingFor(null);
      setShowSuccessPopup(true);
    } catch (error) { console.error(error); }
  };

  const handleConfirmCancel = async () => {
    if (!appToCancel) return;
    setIsCancelling(true);
    try {
      await updateDoc(doc(db, 'appointments', appToCancel.id), { status: 'cancelled' });
      setAppToCancel(null);
      setShowCancelSuccess(true);
      setTimeout(() => setShowCancelSuccess(false), 3000);
    } catch (error) { console.error(error); } finally { setIsCancelling(false); }
  };

  const generateTimeSlots = useMemo(() => {
    if (!bookingFor) return [];
    const hours = bookingFor.availability || { start: "08:30", end: "18:00", days: [1,2,3,4,5] };
    const slots: string[] = [];
    let [startH, startM] = hours.start.split(':').map(Number);
    let [endH, endM] = hours.end.split(':').map(Number);
    let cH = startH, cM = startM;
    while (cH < endH || (cH === endH && cM < endM)) {
      slots.push(`${cH.toString().padStart(2, '0')}:${cM.toString().padStart(2, '0')}`);
      cM += 30; if (cM >= 60) { cM -= 60; cH += 1; }
    }
    return slots;
  }, [bookingFor]);

  const getAccentStyles = (accent: string) => {
    const map: Record<string, { icon: string, bg: string, text: string, border: string }> = {
      blue: { icon: 'text-blue-400', bg: 'bg-blue-600/10', text: 'text-blue-500', border: 'border-blue-500/20' },
      emerald: { icon: 'text-emerald-400', bg: 'bg-emerald-600/10', text: 'text-emerald-500', border: 'border-emerald-500/20' },
      amber: { icon: 'text-amber-400', bg: 'bg-amber-600/10', text: 'text-amber-500', border: 'border-amber-500/20' },
      rose: { icon: 'text-rose-400', bg: 'bg-rose-600/10', text: 'text-rose-500', border: 'border-rose-500/20' },
      indigo: { icon: 'text-indigo-400', bg: 'bg-indigo-600/10', text: 'text-indigo-500', border: 'border-indigo-500/20' }
    };
    return map[accent] || map.blue;
  };

  const upcomingApps = myAppointments.filter(a => a.status === 'pending');
  const pastApps = myAppointments.filter(a => a.status === 'done').reverse();
  const canceledApps = myAppointments.filter(a => a.status === 'cancelled').reverse();

  const handleViewDoctorProfile = async (doctorId: string) => {
    const docRef = doc(db, 'users', doctorId);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      setViewingDoctor(docSnap.data() as UserProfile);
      setCurrentView('doctor-profile');
      setInspectingApp(null);
    }
  };

  const renderHome = () => (
    <div className="animate-in fade-in duration-500 space-y-12 pb-24">
      <header>
        <h1 className="text-4xl font-black text-white leading-tight tracking-tighter">Welcome back,<br/>{profile.name.split(' ')[0]}.</h1>
        <p className="text-slate-500 text-sm mt-2 font-medium tracking-tight">Your personalized health gateway is active.</p>
      </header>

      {upcomingApps[0] && (
        <section onClick={() => setInspectingApp(upcomingApps[0])} className="bg-white/5 border border-white/10 p-8 rounded-[2.5rem] flex flex-col md:flex-row justify-between items-center gap-6 cursor-pointer hover:bg-white/10 transition-all group shadow-2xl">
           <div className="flex items-center space-x-6">
              <div className="w-16 h-16 bg-[#A2F0D3] rounded-2xl flex items-center justify-center p-4">
                 <span className="material-symbols-outlined text-black text-3xl">calendar_today</span>
              </div>
              <div>
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Next Session</p>
                <h3 className="text-xl font-bold text-white group-hover:text-[#A2F0D3] transition-colors">{upcomingApps[0].doctorName}</h3>
                <p className="text-[#A2F0D3] text-xs font-black uppercase mt-1">
                   {new Date(upcomingApps[0].date).toLocaleDateString()} @ {new Date(upcomingApps[0].date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
           </div>
           <button onClick={(e) => { e.stopPropagation(); setAppToCancel(upcomingApps[0]); }} className="px-6 py-3 bg-red-600/10 text-red-500 rounded-full font-black text-[10px] uppercase tracking-widest hover:bg-red-600 hover:text-white transition-all border border-red-600/20">Cancel</button>
        </section>
      )}

      {/* Specialist Categories moved to the top position in Home dashboard */}
      <section>
        <h2 className="text-xl font-black text-white mb-6 uppercase tracking-widest text-[11px] flex items-center">
          <span className="w-8 h-px bg-slate-800 mr-4"></span>
          Clinical Specialties
        </h2>
        <div className="flex space-x-5 overflow-x-auto pb-6 no-scrollbar -mx-4 px-4 snap-x">
          {CATEGORIES_CONFIG.map((cat) => (
            <button key={cat.id} onClick={() => { setSelectedCategory(cat.id); setCurrentView('specialist-list'); }} className="snap-start flex-shrink-0 w-72 flex flex-col rounded-[2.5rem] bg-[#1a1d21] border border-slate-800/50 overflow-hidden hover:border-blue-500/50 transition-all shadow-xl">
              <div className={`h-40 w-full p-6 flex flex-col justify-between ${cat.color} bg-opacity-80`}>
                <div className="w-12 h-12 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center text-2xl shadow-inner">{cat.icon}</div>
                <h3 className="text-white font-black text-2xl tracking-tighter">{cat.id}</h3>
              </div>
              <div className="p-6 bg-[#16181b] text-left"><p className="text-slate-400 text-[10px] font-black uppercase tracking-widest">Connect with experts</p></div>
            </button>
          ))}
        </div>
      </section>

      {/* Daily Intelligence moved to below Clinical Specialties */}
      <section>
        <h2 className="text-xl font-black text-white mb-6 uppercase tracking-widest text-[11px] flex items-center">
          <span className="w-8 h-px bg-slate-800 mr-4"></span>
          Daily Intelligence
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {healthTips.map((tip, idx) => {
            const styles = getAccentStyles(tip.accent);
            return (
              <div key={idx} className="bg-[#1a1d21] border border-slate-800/60 p-8 rounded-[2.5rem] hover:border-blue-500/30 transition-all group shadow-lg">
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform ${styles.bg}`}>
                  <span className={`material-symbols-outlined text-2xl ${styles.icon}`}>{tip.icon}</span>
                </div>
                <p className={`text-[10px] font-black uppercase tracking-widest mb-2 ${styles.text}`}>{tip.category}</p>
                <h4 className="text-white font-bold text-lg leading-tight mb-3 tracking-tight">{tip.title}</h4>
                <p className="text-slate-500 text-xs leading-relaxed">{tip.text}</p>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );

  const renderAgenda = () => (
    <div className="animate-in slide-in-from-right duration-500 space-y-12 pb-24">
      <header>
        <h1 className="text-4xl font-black text-white tracking-tighter">Agenda</h1>
        <p className="text-slate-500 text-sm mt-2 font-medium">Manage your clinical history and upcoming sessions.</p>
      </header>

      {/* Upcoming Section */}
      <section>
        <h2 className="text-xl font-black text-white mb-6 uppercase tracking-widest text-[11px] flex items-center">
          <span className="w-8 h-px bg-slate-800 mr-4"></span>
          Active Sessions
        </h2>
        <div className="space-y-4">
          {upcomingApps.map(app => (
            <div key={app.id} onClick={() => setInspectingApp(app)} className="bg-[#1e2124] p-6 rounded-[2.5rem] border border-slate-800 flex items-center justify-between group cursor-pointer hover:border-[#A2F0D3]/40 transition-all shadow-xl">
              <div className="flex items-center space-x-5">
                <div className="w-16 h-16 rounded-2xl bg-slate-700 overflow-hidden border-2 border-slate-600"><img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${app.doctorName}`} alt="" /></div>
                <div>
                  <p className="text-white font-bold text-lg">{app.doctorName}</p>
                  <p className="text-slate-500 text-xs">{new Date(app.date).toLocaleDateString()} @ {new Date(app.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                </div>
              </div>
              <button onClick={(e) => { e.stopPropagation(); setAppToCancel(app); }} className="px-5 py-2.5 bg-red-600/10 text-red-500 text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-red-600 hover:text-white transition-colors">Cancel</button>
            </div>
          ))}
          {upcomingApps.length === 0 && <p className="text-slate-600 italic py-12 text-center bg-white/5 rounded-[2.5rem] border border-dashed border-white/10">No active appointments.</p>}
        </div>
      </section>

      {/* Past Section */}
      <section>
        <h2 className="text-xl font-black text-white mb-6 uppercase tracking-widest text-[11px] flex items-center">
          <span className="w-8 h-px bg-slate-800 mr-4"></span>
          Clinical Archive
        </h2>
        <div className="space-y-4">
          {pastApps.map(app => (
            <div key={app.id} onClick={() => setInspectingApp(app)} className="bg-[#1a1d21] p-6 rounded-[2.5rem] border border-slate-800/40 flex items-center justify-between group cursor-pointer hover:border-blue-500/40 transition-all">
              <div className="flex items-center space-x-5 opacity-70 group-hover:opacity-100 transition-opacity">
                <div className="w-14 h-14 rounded-2xl bg-slate-800 overflow-hidden"><img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${app.doctorName}`} alt="" /></div>
                <div>
                  <p className="text-white font-bold text-lg">{app.doctorName}</p>
                  <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest">Completed: {new Date(app.date).toLocaleDateString()}</p>
                </div>
              </div>
              <div className="flex space-x-3">
                 <button className="px-5 py-2.5 bg-white/5 text-slate-300 text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-white hover:text-black transition-all">Report</button>
              </div>
            </div>
          ))}
          {pastApps.length === 0 && <p className="text-slate-600 italic py-12 text-center bg-white/5 rounded-[2.5rem] border border-dashed border-white/10">Archive is currently empty.</p>}
        </div>
      </section>

      {/* Canceled Section */}
      <section>
        <button 
          onClick={() => setShowCanceledHistory(!showCanceledHistory)}
          className="flex items-center space-x-2 text-slate-600 hover:text-slate-400 transition-colors mb-6"
        >
          <span className="material-symbols-outlined text-sm">{showCanceledHistory ? 'keyboard_arrow_down' : 'keyboard_arrow_right'}</span>
          <span className="text-[10px] font-black uppercase tracking-widest">View Canceled Events ({canceledApps.length})</span>
        </button>
        {showCanceledHistory && (
          <div className="space-y-4 animate-in slide-in-from-top-2 duration-300">
            {canceledApps.map(app => (
              <div key={app.id} onClick={() => setInspectingApp(app)} className="bg-red-900/5 p-6 rounded-[2.5rem] border border-red-900/10 flex items-center justify-between opacity-50 cursor-pointer hover:opacity-100 transition-all">
                <div className="flex items-center space-x-5">
                  <div className="w-12 h-12 rounded-xl bg-slate-800 overflow-hidden grayscale"><img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${app.doctorName}`} alt="" /></div>
                  <div>
                    <p className="text-slate-400 font-bold">{app.doctorName}</p>
                    <p className="text-slate-600 text-[10px] uppercase tracking-tighter">Canceled on {new Date(app.date).toLocaleDateString()}</p>
                  </div>
                </div>
                <span className="text-red-900 text-[9px] font-black uppercase tracking-widest">Canceled</span>
              </div>
            ))}
            {canceledApps.length === 0 && <p className="text-slate-700 text-xs italic ml-6">No canceled sessions recorded.</p>}
          </div>
        )}
      </section>
    </div>
  );

  const renderSpecialistList = () => (
    <div className="animate-in slide-in-from-right duration-300 space-y-8">
       <header className="flex items-center space-x-4">
          <button onClick={() => setCurrentView('home')} className="w-14 h-14 bg-[#1e2124] rounded-2xl border border-slate-800 flex items-center justify-center text-white">
            <span className="material-symbols-outlined font-black">arrow_back</span>
          </button>
          <h2 className="text-3xl font-black text-white tracking-tighter">{selectedCategory} Experts</h2>
       </header>
       <div className="grid grid-cols-1 gap-4">
          {doctors.filter(d => d.category === selectedCategory).map(docSnap => (
            <div key={docSnap.uid} onClick={() => handleViewDoctorProfile(docSnap.uid)} className="bg-[#1e2124] p-6 rounded-[2.5rem] border border-slate-800 flex items-center justify-between group cursor-pointer hover:border-[#A2F0D3]/40 transition-all shadow-xl">
              <div className="flex items-center space-x-5">
                <div className="w-20 h-20 rounded-[1.5rem] overflow-hidden border-2 border-slate-700 bg-slate-800">
                  <img src={docSnap.profilePicture || `https://api.dicebear.com/7.x/avataaars/svg?seed=${docSnap.name}`} alt="" />
                </div>
                <div>
                  <h4 className="text-white font-bold text-xl group-hover:text-[#A2F0D3] transition-colors">{docSnap.name}</h4>
                  <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest mt-1">{docSnap.specialty}</p>
                </div>
              </div>
              <span className="material-symbols-outlined text-slate-600 group-hover:text-white transition-colors">arrow_forward</span>
            </div>
          ))}
          {doctors.filter(d => d.category === selectedCategory).length === 0 && (
            <p className="text-slate-600 text-center py-20 italic">No professionals found in this category.</p>
          )}
       </div>
    </div>
  );

  const renderDoctorProfile = () => {
    if (!viewingDoctor) return null;
    return (
      <div className="animate-in slide-in-from-bottom-6 duration-500 max-w-4xl mx-auto space-y-8 pb-32">
        <div className="flex justify-between items-center px-4">
          <button onClick={() => setCurrentView('specialist-list')} className="flex items-center space-x-2 text-slate-500 hover:text-white transition-colors text-[10px] font-black uppercase tracking-widest">
            <span className="material-symbols-outlined text-sm">arrow_back</span>
            <span>Return to List</span>
          </button>
          <button onClick={() => setBookingFor(viewingDoctor)} className="px-8 py-3 bg-[#A2F0D3] text-black rounded-full font-black text-xs uppercase tracking-widest hover:scale-105 active:scale-95 transition-all shadow-xl shadow-[#A2F0D3]/10">Schedule Consultation</button>
        </div>

        <div className="bg-[#1e2124] rounded-[3.5rem] border border-slate-800 overflow-hidden shadow-2xl">
          <div className="h-64 relative bg-slate-900">
             {viewingDoctor.backgroundPicture && <img src={viewingDoctor.backgroundPicture} className="w-full h-full object-cover opacity-30" alt="" />}
             <div className="absolute inset-0 bg-gradient-to-t from-[#1e2124] to-transparent" />
             <div className="absolute -bottom-16 left-12">
                <div className="w-40 h-40 rounded-[2.5rem] bg-[#1e2124] border-[6px] border-[#1e2124] shadow-2xl overflow-hidden">
                   <img src={viewingDoctor.profilePicture || `https://api.dicebear.com/7.x/avataaars/svg?seed=${viewingDoctor.avatarSeed || viewingDoctor.name}`} className="w-full h-full object-cover" alt="" />
                </div>
             </div>
          </div>
          
          <div className="pt-24 px-12 pb-12">
             <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
                <div>
                   <h1 className="text-4xl font-black text-white tracking-tighter">{viewingDoctor.name}</h1>
                   <p className="text-blue-400 font-black text-xs uppercase tracking-[0.2em] mt-2">{viewingDoctor.specialty} • {viewingDoctor.category}</p>
                </div>
             </div>
             <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-12">
                <div className="space-y-8">
                   <section>
                      <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-600 mb-4">Philosophy</h3>
                      <p className="text-slate-400 text-lg font-medium leading-relaxed italic">"{viewingDoctor.bio || "Patient-centric care driven by science and empathy."}"</p>
                   </section>
                   <section>
                      <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-600 mb-6">Academic Journey</h3>
                      <div className="space-y-4">
                        {viewingDoctor.education?.phd && (
                          <div className="flex items-start space-x-4 bg-white/5 p-4 rounded-2xl border border-white/5">
                             <div className="w-10 h-10 bg-blue-600/20 text-blue-400 rounded-lg flex items-center justify-center font-black text-[10px] shrink-0">PhD</div>
                             <p className="text-white text-sm font-bold pt-2">{viewingDoctor.education.phd}</p>
                          </div>
                        )}
                        {viewingDoctor.education?.specialization && (
                          <div className="flex items-start space-x-4 bg-white/5 p-4 rounded-2xl border border-white/5">
                             <div className="w-10 h-10 bg-emerald-600/20 text-emerald-400 rounded-lg flex items-center justify-center font-black text-[10px] shrink-0">SPEC</div>
                             <p className="text-white text-sm font-bold pt-2">{viewingDoctor.education.specialization}</p>
                          </div>
                        )}
                        {viewingDoctor.education?.master && (
                          <div className="flex items-start space-x-4 bg-white/5 p-4 rounded-2xl border border-white/5">
                             <div className="w-10 h-10 bg-indigo-600/20 text-indigo-400 rounded-lg flex items-center justify-center font-black text-[10px] shrink-0">MSC</div>
                             <p className="text-white text-sm font-bold pt-2">{viewingDoctor.education.master}</p>
                          </div>
                        )}
                        {(viewingDoctor.education?.bachelor || viewingDoctor.graduation) && (
                          <div className="flex items-start space-x-4 bg-white/5 p-4 rounded-2xl border border-white/5">
                             <div className="w-10 h-10 bg-slate-600/20 text-slate-400 rounded-lg flex items-center justify-center font-black text-[10px] shrink-0">BA</div>
                             <p className="text-white text-sm font-bold pt-2">{viewingDoctor.education?.bachelor || viewingDoctor.graduation}</p>
                          </div>
                        )}
                      </div>
                   </section>
                </div>
                <div className="space-y-6">
                   <div className="bg-white/5 p-8 rounded-[2rem] border border-white/5">
                      <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-600 mb-4">Location</h3>
                      <p className="text-white font-bold text-sm leading-tight">{viewingDoctor.location || "Office address not listed"}</p>
                   </div>
                   <div className="bg-white/5 p-8 rounded-[2rem] border border-white/5">
                      <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-600 mb-4">Practice Schedule</h3>
                      <div className="flex gap-1 pt-2">
                        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, i) => (
                          <div key={i} className={`w-7 h-7 rounded-lg flex items-center justify-center text-[9px] font-black ${viewingDoctor.availability?.days?.includes(i) ? 'bg-[#A2F0D3] text-black' : 'bg-white/5 text-slate-600'}`}>
                            {day}
                          </div>
                        ))}
                      </div>
                   </div>
                </div>
             </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6 pb-24 min-h-screen">
      {/* Appointment Inspection Dossier */}
      {inspectingApp && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-3xl flex items-center justify-center p-6 z-[850] animate-in fade-in">
           <div className="bg-[#1a1d21] rounded-[3.5rem] border border-slate-800 max-w-2xl w-full p-10 space-y-8 animate-in zoom-in-95 relative overflow-hidden shadow-2xl">
              <button onClick={() => setInspectingApp(null)} className="absolute top-8 right-8 w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center text-slate-500 hover:text-white transition-all">
                <span className="material-symbols-outlined font-black">close</span>
              </button>
              
              <div className="flex items-center space-x-6">
                 <div className="w-24 h-24 rounded-[2rem] overflow-hidden bg-slate-800 border-2 border-slate-700 shadow-lg">
                    <img src={inspectingDoctorInfo?.profilePicture || `https://api.dicebear.com/7.x/avataaars/svg?seed=${inspectingApp.doctorName}`} alt="" />
                 </div>
                 <div className="flex-1">
                    <p className="text-[10px] font-black text-slate-600 uppercase tracking-[0.2em] mb-1">Clinical Dossier</p>
                    <h3 className="text-2xl font-black text-white tracking-tighter">{inspectingApp.doctorName}</h3>
                    <p className="text-blue-400 text-[11px] font-black uppercase tracking-widest mt-1">{inspectingDoctorInfo?.specialty || "Health Expert"}</p>
                    <div className="mt-3 flex items-center space-x-3">
                       <span className={`px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest shadow-inner ${
                         inspectingApp.status === 'pending' ? 'bg-[#A2F0D3] text-black' : 
                         inspectingApp.status === 'done' ? 'bg-blue-600 text-white' : 
                         'bg-red-900/20 text-red-500'
                       }`}>
                          {inspectingApp.status}
                       </span>
                       <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">REF: {inspectingApp.id.slice(0, 8).toUpperCase()}</span>
                    </div>
                 </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                 <div className="bg-white/5 p-6 rounded-[2rem] border border-white/5 flex items-start space-x-4">
                    <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center text-[#A2F0D3]">
                      <span className="material-symbols-outlined text-xl">event</span>
                    </div>
                    <div>
                      <p className="text-[9px] font-black text-slate-600 uppercase tracking-widest mb-1">Schedule</p>
                      <p className="text-white font-bold text-sm">{new Date(inspectingApp.date).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</p>
                      <p className="text-slate-400 text-xs mt-0.5">{new Date(inspectingApp.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                    </div>
                 </div>
                 <div className="bg-white/5 p-6 rounded-[2rem] border border-white/5 flex items-start space-x-4">
                    <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center text-[#A2F0D3]">
                      <span className="material-symbols-outlined text-xl">{inspectingApp.type === 'virtual' ? 'videocam' : 'location_on'}</span>
                    </div>
                    <div>
                      <p className="text-[9px] font-black text-slate-600 uppercase tracking-widest mb-1">Modality</p>
                      <p className="text-white font-bold text-sm uppercase tracking-tighter">{inspectingApp.type}</p>
                      <p className="text-slate-400 text-xs mt-0.5">{inspectingApp.type === 'virtual' ? 'HD Connection' : 'Office Visit'}</p>
                    </div>
                 </div>
              </div>

              {inspectingApp.type === 'in-person' && (inspectingDoctorInfo?.location || inspectingApp.location) && (
                <div className="bg-emerald-900/10 p-8 rounded-[2.5rem] border border-emerald-900/20 space-y-4">
                   <div className="flex justify-between items-start">
                      <div>
                        <p className="text-[9px] font-black text-emerald-600 uppercase tracking-widest mb-2">Facility Location</p>
                        <p className="text-white font-bold text-sm leading-relaxed max-w-[250px]">{inspectingDoctorInfo?.location || inspectingApp.location}</p>
                      </div>
                      <a 
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(inspectingDoctorInfo?.location || inspectingApp.location || '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-12 h-12 bg-[#A2F0D3] text-black rounded-2xl flex items-center justify-center shadow-lg hover:scale-105 transition-all"
                      >
                        <span className="material-symbols-outlined">directions</span>
                      </a>
                   </div>
                </div>
              )}

              {inspectingApp.doctorComment && (
                <div className="bg-blue-900/10 p-8 rounded-[2.5rem] border border-blue-900/20 space-y-3">
                   <div className="flex items-center space-x-2 text-blue-400">
                      <span className="material-symbols-outlined text-sm">sticky_note_2</span>
                      <p className="text-[9px] font-black uppercase tracking-widest">Medical Intelligence</p>
                   </div>
                   <p className="text-slate-300 text-sm italic leading-relaxed font-medium">"{inspectingApp.doctorComment}"</p>
                </div>
              )}

              <div className="pt-4 flex flex-col space-y-3">
                 <button 
                  onClick={() => handleViewDoctorProfile(inspectingApp.doctorId)} 
                  className="w-full py-5 bg-white text-black rounded-[2rem] font-black uppercase text-[11px] tracking-widest hover:scale-[1.02] active:scale-[0.98] transition-all shadow-xl"
                 >
                   Open Professional Profile
                 </button>
                 
                 {inspectingApp.status === 'pending' && (
                   <button 
                    onClick={() => { setAppToCancel(inspectingApp); setInspectingApp(null); }} 
                    className="w-full py-4 bg-red-900/10 text-red-500 rounded-[2rem] font-black uppercase text-[10px] tracking-widest border border-red-900/10 hover:bg-red-900 hover:text-white transition-all"
                   >
                     Cancel Appointment
                   </button>
                 )}
                 
                 {inspectingApp.status === 'done' && (
                   <div className="flex gap-3">
                     <button className="flex-1 py-4 bg-white/5 text-slate-500 rounded-2xl font-black uppercase text-[9px] tracking-widest border border-white/5 hover:bg-white/10 transition-all">Download Receipt</button>
                     <button className="flex-1 py-4 bg-white/5 text-slate-500 rounded-2xl font-black uppercase text-[9px] tracking-widest border border-white/5 hover:bg-white/10 transition-all">Reschedule</button>
                   </div>
                 )}
              </div>
           </div>
        </div>
      )}

      {/* Cancellation Modal */}
      {appToCancel && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-6 z-[800] animate-in fade-in">
           <div className="bg-[#1e2124] rounded-[3rem] p-10 max-sm w-full border border-red-900/20 text-center space-y-8 animate-in zoom-in-95">
              <div className="w-20 h-20 bg-red-600/10 rounded-full flex items-center justify-center mx-auto text-red-500">
                <span className="material-symbols-outlined text-3xl font-black">error</span>
              </div>
              <div className="space-y-2">
                 <h2 className="text-2xl font-black text-white tracking-tighter uppercase">Cancel Visit?</h2>
                 <p className="text-slate-500 text-sm">This will release your slot for <span className="text-white font-bold">{appToCancel.doctorName}</span>. Proceed?</p>
              </div>
              <div className="flex gap-4">
                 <button onClick={() => setAppToCancel(null)} className="flex-1 py-4 bg-slate-800 text-slate-400 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-700 transition-all">Keep</button>
                 <button onClick={handleConfirmCancel} disabled={isCancelling} className="flex-1 py-4 bg-red-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-red-500 shadow-xl transition-all">Confirm</button>
              </div>
           </div>
        </div>
      )}

      {/* Booking Modal */}
      {bookingFor && (
        <div className="fixed inset-0 bg-black/95 z-[600] overflow-y-auto backdrop-blur-3xl animate-in fade-in duration-300">
           <div className="min-h-screen flex items-center justify-center p-6">
              <div className="bg-[#1e2124] rounded-[4rem] border border-slate-800 max-w-2xl w-full p-12 space-y-10 relative shadow-2xl animate-in zoom-in-95">
                 <button onClick={() => { setBookingFor(null); setBookingTime(''); setBookingDate(''); }} className="absolute top-8 right-8 w-12 h-12 rounded-2xl bg-slate-800/50 flex items-center justify-center text-slate-500 hover:text-white transition-all">
                    <span className="material-symbols-outlined font-black">close</span>
                 </button>
                 <header>
                    <h2 className="text-3xl font-black text-white tracking-tighter">Secure Session</h2>
                    <p className="text-slate-500 text-sm mt-2">Professional: <span className="text-[#A2F0D3] font-bold">{bookingFor.name}</span></p>
                 </header>
                 <form onSubmit={handleBooking} className="space-y-8">
                    <div>
                       <label className="block text-[10px] font-black uppercase tracking-widest text-slate-600 mb-3 ml-1">1. Choose Date</label>
                       <input type="date" required value={bookingDate} onChange={e => setBookingDate(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-2xl p-5 text-white outline-none focus:ring-2 focus:ring-blue-500 transition-all" />
                    </div>
                    {bookingDate && (
                      <div className="animate-in slide-in-from-top-4 duration-300">
                         <label className="block text-[10px] font-black uppercase tracking-widest text-slate-600 mb-4 ml-1">2. Select Available Slot</label>
                         {fetchingSlots ? (
                           <div className="py-10 text-center"><div className="w-8 h-8 border-4 border-[#A2F0D3] border-t-transparent rounded-full animate-spin mx-auto"></div></div>
                         ) : (
                           <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 max-h-60 overflow-y-auto pr-2 no-scrollbar">
                              {generateTimeSlots.map(time => {
                                const isBooked = existingDayAppointments.some(a => a.date.includes(time));
                                return (
                                  <button key={time} type="button" disabled={isBooked} onClick={() => setBookingTime(time)} className={`py-4 rounded-xl font-black text-[11px] tracking-tight transition-all border ${bookingTime === time ? 'bg-[#A2F0D3] text-black border-[#A2F0D3] shadow-lg shadow-[#A2F0D3]/20' : isBooked ? 'bg-red-900/10 text-red-900/50 border-red-900/20 cursor-not-allowed opacity-50' : 'bg-white/5 text-slate-400 border-white/5 hover:bg-white/10'}`}>{time}</button>
                                );
                              })}
                           </div>
                         )}
                      </div>
                    )}
                    {bookingTime && (
                      <div className="animate-in fade-in duration-300 space-y-8">
                        <div>
                           <label className="block text-[10px] font-black uppercase tracking-widest text-slate-600 mb-4 ml-1">3. Visit Modality</label>
                           <div className="grid grid-cols-2 gap-4">
                              <button type="button" onClick={() => setBookingType('in-person')} className={`py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all ${bookingType === 'in-person' ? 'bg-[#A2F0D3] text-black shadow-lg shadow-[#A2F0D3]/10' : 'bg-white/5 text-slate-500 hover:bg-white/10'}`}>Office</button>
                              <button type="button" onClick={() => setBookingType('virtual')} className={`py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all ${bookingType === 'virtual' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/10' : 'bg-white/5 text-slate-500 hover:bg-white/10'}`}>Virtual</button>
                           </div>
                        </div>
                        <button type="submit" className="w-full py-6 bg-white text-black rounded-[2rem] font-black uppercase text-xs tracking-widest hover:scale-[1.02] active:scale-[0.98] transition-all shadow-2xl">Confirm Booking</button>
                      </div>
                    )}
                 </form>
              </div>
           </div>
        </div>
      )}

      {/* Success Popup */}
      {showSuccessPopup && (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center p-6 z-[900] backdrop-blur-2xl animate-in fade-in">
           <div className="bg-[#1e2124] rounded-[4rem] p-12 max-w-md w-full border border-slate-800 text-center space-y-8">
              <div className="w-24 h-24 bg-[#A2F0D3] rounded-full flex items-center justify-center mx-auto text-black shadow-2xl shadow-[#A2F0D3]/30">
                <span className="material-symbols-outlined text-4xl font-black">verified</span>
              </div>
              <div className="space-y-2">
                 <h2 className="text-3xl font-black text-white tracking-tighter">Session Confirmed</h2>
                 <p className="text-slate-500 text-sm">Your medical milestone has been officially scheduled.</p>
              </div>
              <button onClick={() => { setShowSuccessPopup(false); setCurrentView('agenda'); }} className="w-full py-5 bg-white text-black rounded-[2rem] font-black uppercase tracking-widest text-xs shadow-xl transition-transform active:scale-95">Check Agenda</button>
           </div>
        </div>
      )}

      {currentView === 'home' ? renderHome() : 
       currentView === 'agenda' ? renderAgenda() : 
       currentView === 'specialist-list' ? renderSpecialistList() :
       currentView === 'doctor-profile' ? renderDoctorProfile() : null}

      {/* AI Symptom Bot FAB */}
      <button
        onClick={() => setShowAiBot(true)}
        className="fixed bottom-28 right-6 w-14 h-14 bg-[#A2F0D3] hover:bg-[#8de0c0] text-black rounded-2xl flex items-center justify-center shadow-2xl shadow-[#A2F0D3]/30 hover:scale-105 transition-all z-50"
        aria-label="Open AI health assistant"
      >
        <span className="material-symbols-outlined text-2xl font-black">smart_toy</span>
      </button>

      {/* AI Symptom Bot Modal */}
      {showAiBot && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-3xl flex items-end sm:items-center justify-center p-0 sm:p-6 z-[900] animate-in fade-in">
          <div className="bg-[#1e2124] rounded-t-[3rem] sm:rounded-[3rem] border border-slate-800 w-full sm:max-w-lg max-h-[85vh] flex flex-col shadow-2xl animate-in slide-in-from-bottom-6">
            <div className="p-6 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-[#A2F0D3] rounded-xl flex items-center justify-center">
                  <span className="material-symbols-outlined text-black text-xl font-black">smart_toy</span>
                </div>
                <div>
                  <h2 className="text-lg font-black text-white tracking-tight">Symptom Assistant</h2>
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Find the right specialist</p>
                </div>
              </div>
              <button onClick={() => { setShowAiBot(false); setAiSuggestion(null); }} className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-slate-500 hover:text-white transition-colors">
                <span className="material-symbols-outlined font-black">close</span>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4 min-h-[200px] max-h-[400px]">
              {aiMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-2xl px-5 py-3 ${msg.role === 'user' ? 'bg-[#A2F0D3] text-black' : 'bg-white/5 text-slate-200 border border-slate-800'}`}>
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.text.replace(/\*\*(.*?)\*\*/g, '$1')}</p>
                  </div>
                </div>
              ))}
              {aiLoading && (
                <div className="flex justify-start">
                  <div className="bg-white/5 rounded-2xl px-5 py-3 border border-slate-800 flex items-center space-x-2">
                    <div className="w-2 h-2 bg-[#A2F0D3] rounded-full animate-pulse" />
                    <div className="w-2 h-2 bg-[#A2F0D3] rounded-full animate-pulse delay-100" />
                    <div className="w-2 h-2 bg-[#A2F0D3] rounded-full animate-pulse delay-200" />
                  </div>
                </div>
              )}
            </div>
            <div className="p-6 border-t border-slate-800 space-y-3">
              {aiSuggestion && (
                <button
                  onClick={handleViewSuggestedSpecialists}
                  className="w-full py-4 bg-[#A2F0D3] text-black rounded-2xl font-black text-sm uppercase tracking-widest hover:scale-[1.02] active:scale-[0.98] transition-all shadow-lg"
                >
                  View {aiSuggestion.specialty} Specialists
                </button>
              )}
              <form onSubmit={handleSymptomSubmit} className="flex gap-3">
                <input
                  type="text"
                  value={aiInput}
                  onChange={(e) => setAiInput(e.target.value)}
                  placeholder="Describe your symptoms..."
                  className="flex-1 bg-white/5 border border-slate-800 rounded-2xl px-5 py-3.5 text-white placeholder-slate-600 outline-none focus:border-[#A2F0D3]/50 transition-colors"
                  disabled={aiLoading}
                />
                <button type="submit" disabled={aiLoading || !aiInput.trim()} className="w-12 h-12 bg-[#5D44FF] rounded-2xl flex items-center justify-center text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#6d54ff] transition-colors">
                  <span className="material-symbols-outlined font-black">send</span>
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      <nav className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-[#1e2124]/70 backdrop-blur-2xl border border-slate-800 h-20 rounded-[2.5rem] flex items-center px-4 z-50 shadow-2xl min-w-[320px]">
        <div className="flex w-full justify-around items-center">
          <button onClick={() => { setViewingDoctor(null); setInspectingApp(null); setCurrentView('home'); }} className={`flex flex-col items-center px-6 py-2 rounded-2xl transition-all ${currentView === 'home' || currentView === 'specialist-list' ? 'text-[#A2F0D3] scale-110' : 'text-slate-600'}`}>
            <span className="material-symbols-outlined font-black">home</span>
            <span className="text-[10px] mt-1 font-black uppercase tracking-tighter">Home</span>
          </button>
          <button onClick={() => { setViewingDoctor(null); setInspectingApp(null); setCurrentView('agenda'); }} className={`flex flex-col items-center px-6 py-2 rounded-2xl transition-all ${currentView === 'agenda' || currentView === 'doctor-profile' ? 'text-[#A2F0D3] scale-110' : 'text-slate-600'}`}>
            <span className="material-symbols-outlined font-black">calendar_today</span>
            <span className="text-[10px] mt-1 font-black uppercase tracking-tighter">Agenda</span>
          </button>
        </div>
      </nav>
    </div>
  );
};

export default ClientBooking;