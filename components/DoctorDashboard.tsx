import React, { useEffect, useState, useRef, useMemo } from 'react';
import { db, auth } from '../firebase';
import { signOut } from 'firebase/auth';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc,
  doc, 
  updateDoc,
  limit
} from 'firebase/firestore';
import type { UserProfile, Appointment, Review, WorkingHours, Education, PatientNote } from '../types';

interface DoctorDashboardProps {
  profile: UserProfile;
}

type DoctorView = 'overview' | 'profile' | 'schedule' | 'rooms' | 'news';

// ── The Guardian Open Platform API (CORS-friendly, free) ─────────────────
// 'test' key works immediately (12 req/day). Get your own free key at:
// https://open-platform.theguardian.com/access/
const GUARDIAN_API_KEY = 'test';

interface NewsArticle {
  id: string;
  webTitle: string;
  webUrl: string;
  webPublicationDate: string;
  fields?: {
    thumbnail?: string;
    trailText?: string;
    byline?: string;
  };
}

type RoomAmenity =
  | 'wifi'
  | 'reception'
  | 'parking'
  | 'wheelchair'
  | 'ac'
  | 'restroom'
  | 'waiting_area'
  | 'equipment';

interface RoomListing {
  id: string;
  name: string;
  address: string;
  city: string;
  hourlyRate: number;
  photos?: string[];
  amenities?: RoomAmenity[];
  notes?: string;
  contactEmail?: string;
  contactPhone?: string;
  available?: boolean;
  ownerId?: string;
  ownerName?: string;
}

const DEFAULT_HOURS: WorkingHours = {
  start: "08:00",
  end: "19:00",
  days: [1, 2, 3, 4, 5]
};

const DoctorDashboard: React.FC<DoctorDashboardProps> = ({ profile }) => {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentView, setCurrentView] = useState<DoctorView>('overview');
  const [commentingId, setCommentingId] = useState<string | null>(null);
  const [tempComment, setTempComment] = useState('');
  const [selectedPeriod, setSelectedPeriod] = useState<'yearly' | 'monthly' | 'weekly'>('monthly');
  const [selectedPatient, setSelectedPatient] = useState<{
    patientId: string;
    patientName: string;
    appointmentId?: string;
    visitDate?: string;
  } | null>(null);
  const [patientNotes, setPatientNotes] = useState<PatientNote[]>([]);
  const [noteInput, setNoteInput] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  // Rooms to rent
  const [rooms, setRooms] = useState<RoomListing[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [roomsError, setRoomsError] = useState<string | null>(null);
  const [roomSearch, setRoomSearch] = useState('');
  const [maxRate, setMaxRate] = useState<number | ''>('');
  const [requestingRoom, setRequestingRoom] = useState<RoomListing | null>(null);
  const [requestNote, setRequestNote] = useState('');
  const [submittingRequest, setSubmittingRequest] = useState(false);
  
  // Date states
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [calendarViewDate, setCalendarViewDate] = useState(new Date());

  // Profile Edit State
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editData, setEditData] = useState<Partial<UserProfile>>({});
  const [saving, setSaving] = useState(false);

  // News state
  const [news, setNews] = useState<NewsArticle[]>([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState<string | null>(null);
  const [newsRefreshKey, setNewsRefreshKey] = useState(0);

  const profileInputRef = useRef<HTMLInputElement>(null);
  const backgroundInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const q = query(
      collection(db, 'appointments'),
      where('doctorId', '==', profile.uid)
    );

    const unsubscribeApps = onSnapshot(q, (snapshot) => {
      const apps = snapshot.docs.map(docSnap => ({ 
        id: docSnap.id, 
        ...docSnap.data() 
      } as Appointment));
      apps.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      setAppointments(apps);
      setLoading(false);
    }, (error) => {
      console.error("Appointments snapshot error:", error);
      setLoading(false);
    });

    const qReviews = query(
      collection(db, 'reviews'),
      where('doctorId', '==', profile.uid),
      limit(20)
    );

    const unsubscribeReviews = onSnapshot(qReviews, (snapshot) => {
      const revs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Review));
      revs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setReviews(revs.slice(0, 5));
    }, (error) => {
      if (error.code !== 'permission-denied') {
        console.error("Reviews snapshot error:", error);
      }
    });

    return () => {
      unsubscribeApps();
      unsubscribeReviews();
    };
  }, [profile.uid]);

  useEffect(() => {
    const q = query(
      collection(db, 'patient_notes'),
      where('doctorId', '==', profile.uid)
    );
    const unsub = onSnapshot(q, (snapshot) => {
      const notes = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as PatientNote));
      notes.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setPatientNotes(notes);
    }, (error) => {
      if (error.code !== 'permission-denied') {
        console.error('Patient notes snapshot error:', error);
      }
    });
    return () => unsub();
  }, [profile.uid]);

  useEffect(() => {
    if (currentView !== 'rooms') return;

    setRoomsLoading(true);
    setRoomsError(null);

    const qRooms = query(collection(db, 'rooms'));
    const unsubscribe = onSnapshot(
      qRooms,
      (snapshot) => {
        const nextRooms = snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<RoomListing, 'id'>) }));
        setRooms(nextRooms);
        setRoomsLoading(false);
      },
      (error) => {
        if (error.code !== 'permission-denied') {
          console.error('Rooms snapshot error:', error);
        }
        setRoomsError(
          error.code === 'permission-denied'
            ? "You don't have permission to read room listings yet."
            : 'Failed to load room listings.'
        );
        setRoomsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [currentView]);

  // News fetch
  const getGuardianQuery = (): { q: string; section: string; label: string } => {
    const raw = `${profile.specialty || ''} ${profile.category || ''}`.toLowerCase();
    if (raw.includes('cardio'))
      return { q: 'cardiology heart disease', section: 'science', label: 'Cardiology' };
    if (raw.includes('psych') || raw.includes('mental'))
      return { q: 'mental health psychiatry', section: 'society', label: 'Psychology' };
    if (raw.includes('neurol') || raw.includes('brain'))
      return { q: 'neurology brain neuroscience', section: 'science', label: 'Neurology' };
    if (raw.includes('pediatr') || raw.includes('paediatr') || raw.includes('child'))
      return { q: 'children health pediatrics', section: 'society', label: 'Pediatrics' };
    if (raw.includes('oncol') || raw.includes('cancer'))
      return { q: 'cancer oncology treatment', section: 'science', label: 'Oncology' };
    if (raw.includes('ortho'))
      return { q: 'orthopedics sports medicine', section: 'sport', label: 'Orthopedics' };
    if (raw.includes('dermat') || raw.includes('skin'))
      return { q: 'dermatology skin health', section: 'science', label: 'Dermatology' };
    if (raw.includes('diabet') || raw.includes('endocrin'))
      return { q: 'diabetes endocrinology', section: 'science', label: 'Endocrinology' };
    if (raw.includes('infect') || raw.includes('immun'))
      return { q: 'infectious disease immunology', section: 'science', label: 'Infectious Disease' };
    if (raw.includes('gastro') || raw.includes('digest'))
      return { q: 'gastroenterology digestive health', section: 'science', label: 'Gastroenterology' };
    return { q: 'medicine health medical research', section: 'science', label: 'Medicine' };
  };

  useEffect(() => {
    if (currentView !== 'news') return;

    setNewsLoading(true);
    setNewsError(null);
    const { q, section } = getGuardianQuery();
    const apiUrl = `https://content.guardianapis.com/search?q=${encodeURIComponent(q)}&section=${section}&show-fields=thumbnail,trailText,byline&order-by=newest&page-size=12&api-key=${GUARDIAN_API_KEY}`;
    fetch(apiUrl)
      .then(r => r.json())
      .then(data => {
        if (data.response?.status !== 'ok') throw new Error('API error');
        setNews(data.response.results || []);
      })
      .catch(() => setNewsError('Failed to load news. Please try again.'))
      .finally(() => setNewsLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView, newsRefreshKey]);

  // Calendar Helpers
  const weekDates = useMemo(() => {
    const start = new Date(selectedDate);
    const day = start.getDay();
    const diff = start.getDate() - day + (day === 0 ? -6 : 1); 
    start.setDate(diff);
    return Array.from({ length: 7 }).map((_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [selectedDate]);

  const monthDays = useMemo(() => {
    const year = calendarViewDate.getFullYear();
    const month = calendarViewDate.getMonth();
    const firstDayOfMonth = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const days = [];
    for (let i = 0; i < firstDayOfMonth; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) days.push(new Date(year, month, i));
    return days;
  }, [calendarViewDate]);

  const timeSlots = useMemo(() => {
    const start = 8;
    const end = 19;
    return Array.from({ length: (end - start) * 2 + 1 }).map((_, i) => {
      const h = Math.floor(start + i / 2);
      const m = i % 2 === 0 ? '00' : '30';
      return `${h.toString().padStart(2, '0')}:${m}`;
    });
  }, []);

  const changeMonth = (offset: number) => {
    setCalendarViewDate(new Date(calendarViewDate.getFullYear(), calendarViewDate.getMonth() + offset, 1));
  };

  const changeWeek = (offset: number) => {
    const nextWeek = new Date(selectedDate);
    nextWeek.setDate(selectedDate.getDate() + (offset * 7));
    setSelectedDate(nextWeek);
  };

  const handleStartEdit = () => {
    setEditData({
      name: profile.name,
      bio: profile.bio || '',
      education: profile.education || { bachelor: profile.graduation || '', master: '', phd: '', specialization: '' },
      linkedin: profile.linkedin || '',
      location: profile.location || '',
      avatarSeed: profile.avatarSeed || profile.name,
      specialty: profile.specialty || '',
      category: profile.category || '',
      profilePicture: profile.profilePicture || '',
      backgroundPicture: profile.backgroundPicture || '',
      availability: profile.availability || DEFAULT_HOURS
    });
    setIsEditingProfile(true);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, field: 'profilePicture' | 'backgroundPicture') => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 800000) { 
        alert("Image is too large. Please select a smaller image (under 800KB).");
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setEditData(prev => ({ ...prev, [field]: reader.result as string }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSaveProfile = async () => {
    setSaving(true);
    try {
      await updateDoc(doc(db, 'users', profile.uid), editData);
      setIsEditingProfile(false);
    } catch (error) {
      alert("Failed to update profile.");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveNote = async () => {
    if (!selectedPatient || !noteInput.trim() || savingNote) return;
    setSavingNote(true);
    try {
      await addDoc(collection(db, 'patient_notes'), {
        doctorId: profile.uid,
        patientId: selectedPatient.patientId,
        patientName: selectedPatient.patientName,
        content: noteInput.trim(),
        visitDate: selectedPatient.visitDate ?? new Date().toISOString(),
        createdAt: new Date().toISOString(),
      });
      setNoteInput('');
    } catch (e) {
      alert('Failed to save note. Please try again.');
    } finally {
      setSavingNote(false);
    }
  };

  // Fix: Added handleComplete to manage the state transition for completing an appointment with notes.
  const handleComplete = (id: string) => {
    setCommentingId(id);
    setTempComment('');
  };

  // Fix: Added submitCompletion to save appointment results and doctor notes to the database.
  const submitCompletion = async () => {
    if (!commentingId) return;
    try {
      await updateDoc(doc(db, 'appointments', commentingId), {
        status: 'done',
        doctorComment: tempComment
      });
      setCommentingId(null);
      setTempComment('');
    } catch (error) {
      console.error("Error finalizing appointment:", error);
      alert("Failed to finalize appointment.");
    }
  };

  const renderSchedule = () => (
    <div className="flex bg-white h-[calc(100vh-64px)] -mx-8 -mt-8 overflow-hidden animate-in fade-in duration-500">
      <aside className="w-80 border-r border-slate-100 flex flex-col bg-slate-50/50 p-6 space-y-8 overflow-y-auto no-scrollbar">
        <section>
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-900 text-sm">
                {calendarViewDate.toLocaleString('default', { month: 'long', year: 'numeric' })}
              </h3>
              <div className="flex space-x-2">
                <button onClick={() => changeMonth(-1)} className="p-1 hover:bg-slate-100 rounded-md transition-colors">
                  <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M15 19l-7-7 7-7" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
                <button onClick={() => changeMonth(1)} className="p-1 hover:bg-slate-100 rounded-md transition-colors">
                  <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <div key={i}>{d}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {monthDays.map((date, i) => (
                <button 
                  key={i} 
                  disabled={!date}
                  onClick={() => date && setSelectedDate(date)}
                  className={`h-8 w-8 flex items-center justify-center rounded-lg text-xs font-bold transition-all ${
                    !date ? 'invisible' :
                    date.toDateString() === selectedDate.toDateString() 
                      ? 'bg-[#A2F0D3] text-black shadow-[#A2F0D3]/20 shadow-lg' 
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {date?.getDate()}
                </button>
              ))}
            </div>
          </div>
        </section>
        <section className="space-y-4">
          <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 ml-1">Services Legend</h4>
          <div className="space-y-2">
            {[
              { label: 'Virtual Visit', color: 'bg-indigo-400' },
              { label: 'In-Person Visit', color: 'bg-[#A2F0D3]' },
            ].map(s => (
              <div key={s.label} className="flex items-center space-x-3 p-2">
                <div className={`w-3 h-3 rounded-full ${s.color}`} />
                <span className="text-xs font-bold text-slate-600">{s.label}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 ml-1">Upcoming</h4>
          {(() => {
            const upcoming = appointments
              .filter(a => new Date(a.date) >= new Date() && a.status !== 'done')
              .slice(0, 5);
            if (upcoming.length === 0) return (
              <p className="text-xs text-slate-400 px-2">No upcoming appointments.</p>
            );
            return (
              <div className="space-y-2">
                {upcoming.map(a => {
                  const d = new Date(a.date);
                  return (
                    <div key={a.id} className={`rounded-xl p-3 border ${a.type === 'virtual' ? 'bg-indigo-50 border-indigo-100' : 'bg-[#A2F0D3]/20 border-[#A2F0D3]/40'}`}>
                      <p className="text-xs font-black text-slate-900 truncate">{a.patientName}</p>
                      <p className="text-[10px] font-bold text-slate-500 mt-1">
                        {d.toLocaleDateString('default', { weekday: 'short', month: 'short', day: 'numeric' })}
                        {' · '}
                        {d.toLocaleTimeString('default', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                      <span className={`inline-block mt-1.5 text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${a.type === 'virtual' ? 'bg-indigo-100 text-indigo-700' : 'bg-[#A2F0D3]/60 text-emerald-800'}`}>
                        {a.type}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </section>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden bg-white">
        <header className="flex items-center justify-between px-8 py-4 border-b border-slate-100 bg-slate-50/20">
           <div className="flex items-center space-x-4">
              <button onClick={() => changeWeek(-1)} className="p-2 hover:bg-white rounded-xl shadow-sm border border-slate-100 transition-all">
                <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M15 19l-7-7 7-7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
              <h2 className="text-xl font-black text-slate-900 tracking-tighter">
                {weekDates[0].toLocaleDateString('default', { day: 'numeric', month: 'short' })} - {weekDates[6].toLocaleDateString('default', { day: 'numeric', month: 'short', year: 'numeric' })}
              </h2>
              <button onClick={() => changeWeek(1)} className="p-2 hover:bg-white rounded-xl shadow-sm border border-slate-100 transition-all">
                <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
           </div>
           <button onClick={() => setSelectedDate(new Date())} className="px-6 py-2 bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest rounded-full shadow-lg">Today</button>
        </header>

        <div className="grid grid-cols-7 border-b border-slate-100">
          {weekDates.map((date, idx) => {
            const isToday = date.toDateString() === new Date().toDateString();
            return (
              <div key={idx} className="flex flex-col items-center py-6 border-r border-slate-50 last:border-r-0">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2">
                  {['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][date.getDay()]}
                </span>
                <span className={`w-10 h-10 flex items-center justify-center rounded-full text-lg font-black tracking-tighter ${isToday ? 'bg-emerald-600 text-white shadow-lg' : 'text-slate-900'}`}>
                  {date.getDate()}
                </span>
              </div>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto relative no-scrollbar">
          <div className="flex min-h-full">
            {/* Time gutter */}
            <div className="w-16 flex-shrink-0 border-r border-slate-100 bg-white">
              {timeSlots.map(time => (
                <div key={time} className="h-20 border-b border-slate-50/50 flex items-start justify-end pr-3 pt-1">
                  <span className="text-[10px] font-black text-slate-300">{time}</span>
                </div>
              ))}
            </div>
            {/* Day columns */}
            <div className="flex-1 grid grid-cols-7 min-h-full">
            {weekDates.map((_, dayIdx) => (
              <div key={dayIdx} className="border-r border-slate-50 relative min-h-full last:border-r-0">
                {timeSlots.map(time => (
                  <div key={time} className="h-20 border-b border-slate-50/50" />
                ))}
                {appointments
                  .filter(a => new Date(a.date).toDateString() === weekDates[dayIdx].toDateString())
                  .map(app => {
                    const date = new Date(app.date);
                    const hour = date.getHours();
                    const minutes = date.getMinutes();
                    const topPos = ((hour - 8) * 2 + (minutes / 30)) * 80;
                    return (
                      <div 
                        key={app.id}
                        onClick={() => app.status === 'pending' && handleComplete(app.id)}
                        style={{ top: `${topPos + 8}px`, height: '70px' }}
                        className={`absolute left-2 right-2 rounded-xl p-3 shadow-sm border border-white/20 cursor-pointer hover:scale-[1.02] hover:shadow-lg transition-all z-10 ${
                          app.type === 'virtual' ? 'bg-indigo-50 border-indigo-100' : 'bg-[#A2F0D3]/30 border-[#A2F0D3]/50'
                        }`}
                      >
                        <h5 className="text-xs font-black text-slate-900 truncate">{app.patientName}</h5>
                        <p className="text-[9px] font-bold text-slate-500 uppercase tracking-tighter mt-1 truncate">
                          {date.toLocaleTimeString('default', { hour: '2-digit', minute: '2-digit' })} · {app.type}
                        </p>
                      </div>
                    );
                  })}
              </div>
            ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );

  const filteredRooms = useMemo(() => {
    const q = roomSearch.trim().toLowerCase();
    const max = typeof maxRate === 'number' ? maxRate : null;
    return rooms.filter((r) => {
      const hay = `${r.name} ${r.city} ${r.address}`.toLowerCase();
      const matchText = q ? hay.includes(q) : true;
      const matchRate = max !== null ? r.hourlyRate <= max : true;
      const matchAvailability = r.available === undefined ? true : r.available;
      return matchText && matchRate && matchAvailability;
    });
  }, [rooms, roomSearch, maxRate]);

  const amenityLabel = (a: RoomAmenity) => {
    const map: Record<RoomAmenity, string> = {
      wifi: 'Wi‑Fi',
      reception: 'Reception',
      parking: 'Parking',
      wheelchair: 'Accessible',
      ac: 'A/C',
      restroom: 'Restroom',
      waiting_area: 'Waiting area',
      equipment: 'Equipment',
    };
    return map[a] ?? a;
  };

  const submitRoomRequest = async () => {
    if (!requestingRoom || submittingRequest) return;
    setSubmittingRequest(true);
    try {
      await addDoc(collection(db, 'room_requests'), {
        roomId: requestingRoom.id,
        roomName: requestingRoom.name,
        roomOwnerId: requestingRoom.ownerId || null,
        roomOwnerName: requestingRoom.ownerName || null,
        doctorId: profile.uid,
        doctorName: profile.name,
        note: requestNote.trim() || null,
        status: 'pending',
        createdAt: new Date().toISOString(),
      });
      setRequestNote('');
      setRequestingRoom(null);
      alert('Request sent. The room owner will contact you.');
    } catch (error) {
      console.error('Error creating room request:', error);
      alert('Failed to send request. Please try again.');
    } finally {
      setSubmittingRequest(false);
    }
  };

  const renderRooms = () => (
    <div className="space-y-8 animate-in fade-in duration-500">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-500">Practice</p>
          <h1 className="text-4xl font-black text-slate-900 tracking-tighter">Rooms to rent</h1>
          <p className="text-slate-500 text-sm mt-2 font-medium">
            Find a space for in-person appointments.
          </p>
        </div>
        <div className="flex gap-3">
          <div className="relative">
            <input
              value={roomSearch}
              onChange={(e) => setRoomSearch(e.target.value)}
              placeholder="Search city, address, name…"
              className="w-72 max-w-full bg-white border border-slate-200 rounded-2xl px-5 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all"
            />
          </div>
          <div className="relative">
            <input
              value={maxRate}
              onChange={(e) => {
                const v = e.target.value.trim();
                if (v === '') setMaxRate('');
                else setMaxRate(Number(v));
              }}
              inputMode="numeric"
              placeholder="Max $/hr"
              className="w-28 bg-white border border-slate-200 rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all"
            />
          </div>
        </div>
      </header>

      {roomsLoading && (
        <div className="bg-white p-10 rounded-[2.5rem] border border-slate-200 shadow-sm text-center">
          <p className="text-slate-500 text-sm font-bold">Loading rooms…</p>
        </div>
      )}

      {roomsError && (
        <div className="bg-red-50 p-8 rounded-[2.5rem] border border-red-200">
          <p className="text-red-700 text-sm font-bold">{roomsError}</p>
          <p className="text-red-600 text-xs mt-2">
            Firestore collection: <span className="font-black">rooms</span>
          </p>
        </div>
      )}

      {!roomsLoading && !roomsError && (
        <>
          {filteredRooms.length === 0 ? (
            <div className="bg-white p-12 rounded-[2.5rem] border border-slate-200 shadow-sm text-center space-y-3">
              <h3 className="text-slate-900 text-xl font-black tracking-tight">No rooms found</h3>
              <p className="text-slate-500 text-sm">
                Add documents to the Firestore <span className="font-black">rooms</span> collection to show listings.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {filteredRooms.map((r) => (
                <div key={r.id} className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden group">
                  <div className="h-44 bg-slate-100 relative">
                    {r.photos?.[0] ? (
                      <img src={r.photos[0]} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-slate-400">
                        <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 7h18M6 7V5a2 2 0 012-2h8a2 2 0 012 2v2m-2 0v14a2 2 0 01-2 2H8a2 2 0 01-2-2V7m3 4h6" />
                        </svg>
                      </div>
                    )}
                    <div className="absolute top-4 right-4 bg-slate-900 text-white px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest shadow-lg">
                      ${r.hourlyRate}/hr
                    </div>
                  </div>
                  <div className="p-8 space-y-4">
                    <div>
                      <h4 className="text-slate-900 text-xl font-black tracking-tight leading-tight">{r.name}</h4>
                      <p className="text-slate-500 text-xs font-bold uppercase tracking-widest mt-2">{r.city}</p>
                      <p className="text-slate-600 text-sm mt-2">{r.address}</p>
                    </div>
                    {r.amenities && r.amenities.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {r.amenities.slice(0, 6).map((a) => (
                          <span key={a} className="px-3 py-1.5 rounded-full bg-slate-50 border border-slate-200 text-[10px] font-black uppercase tracking-widest text-slate-600">
                            {amenityLabel(a)}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="pt-2 flex gap-3">
                      <button
                        onClick={() => { setRequestingRoom(r); setRequestNote(''); }}
                        className="flex-1 py-4 bg-slate-900 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-black transition-colors shadow-lg"
                      >
                        Request rental
                      </button>
                      {r.contactEmail && (
                        <a
                          href={`mailto:${r.contactEmail}`}
                          className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-700 flex items-center justify-center hover:bg-slate-200 transition-colors"
                          aria-label="Email room owner"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8m-18 8h18a2 2 0 002-2V8a2 2 0 00-2-2H3a2 2 0 00-2 2v6a2 2 0 002 2z" />
                          </svg>
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {requestingRoom && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center p-4 z-[120] animate-in fade-in duration-200">
          <div className="bg-white rounded-[3rem] p-10 max-w-lg w-full shadow-2xl animate-in zoom-in-95 duration-300 border border-slate-200">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-500">Request rental</p>
                <h3 className="text-2xl font-black text-slate-900 tracking-tighter mt-2">{requestingRoom.name}</h3>
                <p className="text-slate-500 text-sm mt-2">{requestingRoom.city} • ${requestingRoom.hourlyRate}/hr</p>
              </div>
              <button
                onClick={() => setRequestingRoom(null)}
                className="w-10 h-10 rounded-2xl bg-slate-100 text-slate-600 flex items-center justify-center hover:bg-slate-200 transition-colors"
                aria-label="Close"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="mt-8 space-y-3">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Message (optional)</label>
              <textarea
                value={requestNote}
                onChange={(e) => setRequestNote(e.target.value)}
                placeholder="e.g. I’d like to rent this room on Tuesdays 14:00–18:00 for consultations."
                className="w-full h-32 bg-slate-50 border border-slate-200 rounded-[1.5rem] p-6 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all text-slate-900"
              />
            </div>

            <div className="mt-8 flex gap-4">
              <button
                onClick={() => setRequestingRoom(null)}
                className="flex-1 py-4 text-slate-500 font-black uppercase text-[10px] tracking-widest hover:bg-slate-50 rounded-2xl transition-colors border border-slate-200"
              >
                Cancel
              </button>
              <button
                onClick={submitRoomRequest}
                disabled={submittingRequest}
                className="flex-1 py-4 bg-slate-900 text-white font-black uppercase text-[10px] tracking-widest rounded-2xl hover:bg-black shadow-xl disabled:opacity-50"
              >
                {submittingRequest ? 'Sending…' : 'Send request'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const renderProfile = () => (
    <div className="max-w-4xl mx-auto space-y-8 animate-in slide-in-from-bottom-4 duration-500 text-slate-900">
      <div className="bg-white rounded-[3.5rem] shadow-sm border border-slate-200 overflow-hidden group/card relative">
        <div className="h-72 relative bg-slate-900">
          <div className="absolute inset-0 overflow-hidden">
            {(isEditingProfile ? editData.backgroundPicture : profile.backgroundPicture) ? (
              <img src={isEditingProfile ? editData.backgroundPicture : profile.backgroundPicture} className="w-full h-full object-cover opacity-80" alt="" />
            ) : (
              <div className="w-full h-full bg-gradient-to-r from-slate-900 via-blue-900 to-slate-800 opacity-60" />
            )}
            {isEditingProfile && (
              <button onClick={() => backgroundInputRef.current?.click()} className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                <span className="font-bold text-white text-sm">Change Cover</span>
              </button>
            )}
            <input type="file" ref={backgroundInputRef} className="hidden" accept="image/*" onChange={(e) => handleFileChange(e, 'backgroundPicture')} />
          </div>

          <div className="absolute -bottom-20 left-12">
            <div className="w-44 h-44 rounded-[3rem] border-8 border-white shadow-2xl overflow-hidden bg-white relative group/avatar">
              {(isEditingProfile ? editData.profilePicture : profile.profilePicture) ? (
                <img src={isEditingProfile ? editData.profilePicture : profile.profilePicture} className="w-full h-full object-cover" alt="" />
              ) : (
                <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${isEditingProfile ? editData.avatarSeed : (profile.avatarSeed || profile.name)}`} alt="Avatar" className="w-full h-full object-cover" />
              )}
              {isEditingProfile && (
                <button onClick={() => profileInputRef.current?.click()} className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover/avatar:opacity-100 transition-opacity text-white">
                  <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
              )}
              <input type="file" ref={profileInputRef} className="hidden" accept="image/*" onChange={(e) => handleFileChange(e, 'profilePicture')} />
            </div>
          </div>
          
          {!isEditingProfile && (
            <button onClick={handleStartEdit} className="absolute bottom-6 right-10 bg-white text-slate-900 px-8 py-3 rounded-full text-[10px] font-black uppercase tracking-widest transition-all hover:scale-105 shadow-xl">
              Modify Portfolio
            </button>
          )}
        </div>

        <div className="pt-28 px-12 pb-12">
          {isEditingProfile ? (
            <div className="space-y-12">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-2 ml-1">Full Identity</label>
                  <input type="text" value={editData.name} onChange={e => setEditData({...editData, name: e.target.value})} className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-2 ml-1">Specialization</label>
                  <input type="text" value={editData.specialty} onChange={e => setEditData({...editData, specialty: e.target.value})} className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>

              {/* ACADEMIC BACKGROUND EDITOR */}
              <section className="bg-slate-50 p-8 rounded-[2.5rem] border border-slate-200 space-y-6">
                <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-2">Academic Journey</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-600 mb-2 ml-1">Bachelor's Degree</label>
                    <input type="text" value={editData.education?.bachelor} onChange={e => setEditData({...editData, education: {...editData.education!, bachelor: e.target.value}})} className="w-full px-6 py-4 bg-white border border-slate-200 rounded-2xl outline-none" placeholder="e.g. B.S. in Biology" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-600 mb-2 ml-1">Master's Degree</label>
                    <input type="text" value={editData.education?.master} onChange={e => setEditData({...editData, education: {...editData.education!, master: e.target.value}})} className="w-full px-6 py-4 bg-white border border-slate-200 rounded-2xl outline-none" placeholder="e.g. M.Sc. in Orthopedics" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-600 mb-2 ml-1">PhD / Doctorate</label>
                    <input type="text" value={editData.education?.phd} onChange={e => setEditData({...editData, education: {...editData.education!, phd: e.target.value}})} className="w-full px-6 py-4 bg-white border border-slate-200 rounded-2xl outline-none" placeholder="e.g. PhD in Medical Science" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-600 mb-2 ml-1">Specialization / Residency</label>
                    <input type="text" value={editData.education?.specialization} onChange={e => setEditData({...editData, education: {...editData.education!, specialization: e.target.value}})} className="w-full px-6 py-4 bg-white border border-slate-200 rounded-2xl outline-none" placeholder="e.g. Sports Medicine Residency" />
                  </div>
                </div>
              </section>

              <div>
                <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-2 ml-1">Bio / About Me</label>
                <textarea value={editData.bio} onChange={e => setEditData({...editData, bio: e.target.value})} rows={4} className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none resize-none" />
              </div>

              <div className="flex space-x-4 pt-4">
                <button onClick={() => setIsEditingProfile(false)} className="flex-1 py-4 bg-slate-100 text-slate-500 font-black uppercase tracking-widest text-[10px] rounded-2xl">Cancel</button>
                <button onClick={handleSaveProfile} disabled={saving} className="flex-1 py-4 bg-slate-900 text-white font-black uppercase tracking-widest text-[10px] rounded-2xl disabled:opacity-50 shadow-xl">
                  {saving ? 'Saving...' : 'Update Portfolio'}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-12">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div>
                  <h1 className="text-4xl font-black text-slate-900 tracking-tighter leading-tight">{profile.name}</h1>
                  <div className="flex flex-wrap items-center gap-3 mt-4">
                    <span className="px-5 py-1.5 bg-blue-50 text-blue-600 text-[9px] font-black rounded-full uppercase tracking-[0.2em]">{profile.category}</span>
                    <span className="px-5 py-1.5 bg-slate-100 text-slate-500 text-[9px] font-black rounded-full uppercase tracking-[0.2em]">{profile.specialty}</span>
                  </div>
                </div>
                {profile.linkedin && (
                  <a href={profile.linkedin} target="_blank" rel="noopener noreferrer" className="px-8 py-3 bg-[#0077b5] text-white rounded-full font-black text-[10px] uppercase tracking-widest flex items-center hover:scale-105 transition-all shadow-lg">
                    LinkedIn Profile
                  </a>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
                <div className="md:col-span-2 space-y-10">
                  <section>
                    <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-6">About Me</h3>
                    <p className="text-slate-600 text-xl leading-relaxed font-medium italic">"{profile.bio || "Patient-centric care driven by science and empathy."}"</p>
                  </section>
                  
                  {/* STRUCTURED ACADEMIC TIMELINE DISPLAY */}
                  <section>
                    <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-8">Academic Milestones</h3>
                    <div className="space-y-6">
                      {profile.education?.phd && (
                        <div className="flex items-start space-x-6">
                          <div className="w-12 h-12 rounded-2xl bg-blue-600 text-white flex items-center justify-center font-black text-xs shrink-0">PhD</div>
                          <div className="pt-2">
                             <h4 className="text-slate-900 font-bold text-lg leading-tight">{profile.education.phd}</h4>
                             <p className="text-slate-400 text-xs font-black uppercase mt-1 tracking-widest">Doctorate Degree</p>
                          </div>
                        </div>
                      )}
                      {profile.education?.specialization && (
                        <div className="flex items-start space-x-6">
                          <div className="w-12 h-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center font-black text-xs shrink-0">SPEC</div>
                          <div className="pt-2">
                             <h4 className="text-slate-900 font-bold text-lg leading-tight">{profile.education.specialization}</h4>
                             <p className="text-slate-400 text-xs font-black uppercase mt-1 tracking-widest">Residency / Specialization</p>
                          </div>
                        </div>
                      )}
                      {profile.education?.master && (
                        <div className="flex items-start space-x-6">
                          <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center font-black text-xs shrink-0">MSC</div>
                          <div className="pt-2">
                             <h4 className="text-slate-900 font-bold text-lg leading-tight">{profile.education.master}</h4>
                             <p className="text-slate-400 text-xs font-black uppercase mt-1 tracking-widest">Master of Science</p>
                          </div>
                        </div>
                      )}
                      {(profile.education?.bachelor || profile.graduation) && (
                        <div className="flex items-start space-x-6">
                          <div className="w-12 h-12 rounded-2xl bg-slate-900 text-white flex items-center justify-center font-black text-xs shrink-0">BA</div>
                          <div className="pt-2">
                             <h4 className="text-slate-900 font-bold text-lg leading-tight">{profile.education?.bachelor || profile.graduation}</h4>
                             <p className="text-slate-400 text-xs font-black uppercase mt-1 tracking-widest">Bachelor's Degree</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </section>
                </div>
                <div className="space-y-10">
                  <section className="bg-slate-50 p-10 rounded-[2.5rem] border border-slate-200/50">
                    <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-6">Schedule Info</h3>
                    <div className="space-y-4">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-black uppercase text-slate-400">Hours</span>
                        <span className="text-sm font-bold text-slate-900">{profile.availability?.start} - {profile.availability?.end}</span>
                      </div>
                    </div>
                  </section>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const renderNews = () => {
    const { label: topicLabel } = getGuardianQuery();

    return (
      <div className="space-y-8 animate-in fade-in duration-500">
        <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-500">Your feed</p>
            <h1 className="text-4xl font-black text-slate-900 tracking-tighter">{topicLabel} News</h1>
            <p className="text-slate-500 text-sm mt-2 font-medium">
              Latest headlines tailored to your specialization.
            </p>
          </div>
          <button
            onClick={() => setNewsRefreshKey(k => k + 1)}
            disabled={newsLoading}
            className="flex items-center gap-2 px-6 py-3 bg-slate-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-black transition-colors shadow-lg disabled:opacity-50 shrink-0"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>refresh</span>
            Refresh
          </button>
        </header>

        {/* Loading skeleton */}
        {newsLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden animate-pulse">
                <div className="h-44 bg-slate-100" />
                <div className="p-6 space-y-3">
                  <div className="h-3 bg-slate-100 rounded-full w-1/3" />
                  <div className="h-5 bg-slate-100 rounded-full w-full" />
                  <div className="h-5 bg-slate-100 rounded-full w-4/5" />
                  <div className="h-3 bg-slate-100 rounded-full w-2/3 mt-2" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Error */}
        {newsError && (
          <div className="bg-red-50 border border-red-200 rounded-[2.5rem] p-10 text-center space-y-3">
            <span className="material-symbols-outlined block text-red-300" style={{ fontSize: '48px' }}>wifi_off</span>
            <p className="text-red-700 font-black">{newsError}</p>
            <button onClick={() => setNewsRefreshKey(k => k + 1)} className="px-6 py-3 bg-red-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-red-500 transition-colors">
              Retry
            </button>
          </div>
        )}

        {/* Articles grid */}
        {!newsLoading && !newsError && news.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {news.map((article, i) => (
              <a
                key={i}
                href={article.webUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden group hover:shadow-lg hover:-translate-y-1 transition-all duration-300 flex flex-col ${i === 0 ? 'md:col-span-2' : ''}`}
              >
                <div className={`${i === 0 ? 'h-64' : 'h-44'} bg-slate-100 relative overflow-hidden`}>
                  {article.fields?.thumbnail ? (
                    <img src={article.fields.thumbnail} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200">
                      <span className="material-symbols-outlined text-slate-300" style={{ fontSize: '48px' }}>article</span>
                    </div>
                  )}
                  {article.fields?.byline && (
                    <div className="absolute top-4 left-4">
                      <span className="bg-white/90 backdrop-blur-md text-slate-700 text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full border border-slate-200">
                        {article.fields.byline}
                      </span>
                    </div>
                  )}
                </div>
                <div className="p-6 flex flex-col flex-1 gap-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                    {new Date(article.webPublicationDate).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                  <h3 className={`font-black text-slate-900 leading-tight tracking-tight group-hover:text-blue-600 transition-colors ${i === 0 ? 'text-2xl' : 'text-base'}`}>
                    {article.webTitle}
                  </h3>
                  {article.fields?.trailText && (
                    <p className="text-slate-500 text-sm leading-relaxed line-clamp-2 flex-1">{article.fields.trailText}</p>
                  )}
                  <div className="flex items-center gap-2 pt-2 text-blue-600 text-[10px] font-black uppercase tracking-widest">
                    Read article
                    <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>arrow_forward</span>
                  </div>
                </div>
              </a>
            ))}
          </div>
        )}

        {/* Empty */}
        {!newsLoading && !newsError && news.length === 0 && (
          <div className="bg-white border border-slate-200 rounded-[2.5rem] p-12 text-center space-y-3">
            <span className="material-symbols-outlined block text-slate-200" style={{ fontSize: '48px' }}>newspaper</span>
            <p className="text-slate-500 font-bold text-sm">No articles found for your specialization</p>
            <button onClick={() => setNewsRefreshKey(k => k + 1)} className="px-6 py-3 bg-slate-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest">
              Try again
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderPatientPanel = () => {
    if (!selectedPatient) return null;

    const patientApps = appointments.filter(a => a.patientId === selectedPatient.patientId);
    const visitCount = patientApps.length;
    const latestApp = [...patientApps].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    )[0];
    const notes = patientNotes.filter(n => n.patientId === selectedPatient.patientId);

    return (
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-end sm:items-center justify-end p-0 sm:p-6 z-[110] animate-in fade-in duration-200"
        onClick={() => { setSelectedPatient(null); setNoteInput(''); }}
      >
        <div
          className="bg-white rounded-t-[2.5rem] sm:rounded-[2.5rem] w-full sm:w-[480px] max-h-[92vh] flex flex-col shadow-2xl animate-in slide-in-from-bottom-8 sm:slide-in-from-right-8 duration-300"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-8 pt-8 pb-5 border-b border-slate-100 shrink-0">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl overflow-hidden bg-slate-100 shrink-0">
                <img
                  src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${selectedPatient.patientName}`}
                  alt={selectedPatient.patientName}
                  className="w-full h-full"
                />
              </div>
              <div>
                <h2 className="text-xl font-black text-slate-900 tracking-tighter leading-tight">
                  {selectedPatient.patientName}
                </h2>
                <div className="flex items-center gap-2 mt-1.5">
                  <span className="text-xs font-bold text-slate-400">
                    {visitCount} {visitCount === 1 ? 'visit' : 'visits'}
                  </span>
                  {latestApp && (
                    <span className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full ${
                      latestApp.type === 'virtual'
                        ? 'bg-indigo-50 text-indigo-500'
                        : 'bg-[#A2F0D3]/40 text-emerald-700'
                    }`}>
                      {latestApp.type === 'virtual' ? 'Virtual' : 'In-Person'}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <button
              onClick={() => { setSelectedPatient(null); setNoteInput(''); }}
              className="w-9 h-9 rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center hover:bg-slate-200 transition shrink-0"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M6 18L18 6M6 6l12 12" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          {/* Timeline */}
          <div className="flex-1 overflow-y-auto px-8 py-6 no-scrollbar">
            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-4">
              Session History
            </h3>
            {notes.length === 0 ? (
              <div className="text-center py-14">
                <span className="material-symbols-outlined block text-slate-200 mb-3" style={{ fontSize: '44px' }}>note_alt</span>
                <p className="text-slate-400 text-sm font-medium">No notes yet for this patient</p>
                <p className="text-slate-300 text-xs mt-1">Add your first note below</p>
              </div>
            ) : (
              <div className="space-y-4">
                {notes.map((note, i) => (
                  <div key={note.id} className="relative pl-6">
                    {/* Timeline line */}
                    {i < notes.length - 1 && (
                      <div className="absolute left-[7px] top-5 bottom-[-16px] w-px bg-slate-100" />
                    )}
                    {/* Dot */}
                    <div className="absolute left-0 top-[18px] w-3.5 h-3.5 rounded-full bg-[#A2F0D3] border-2 border-white shadow-sm" />
                    <div className="bg-slate-50 rounded-2xl p-5 border border-slate-100">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
                        {new Date(note.visitDate).toLocaleDateString('en-US', {
                          weekday: 'short',
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </p>
                      <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                        {note.content}
                      </p>
                      <p className="text-[10px] text-slate-300 font-bold mt-2">
                        Saved at {new Date(note.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Add Note footer */}
          <div className="px-8 pb-8 pt-4 border-t border-slate-100 shrink-0 space-y-3">
            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Add Note</h3>
            <textarea
              value={noteInput}
              onChange={e => setNoteInput(e.target.value)}
              placeholder="Write a session note, diagnosis, observations..."
              rows={3}
              className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm text-slate-900 outline-none focus:ring-2 focus:ring-blue-500 resize-none transition-all"
            />
            <button
              onClick={handleSaveNote}
              disabled={!noteInput.trim() || savingNote}
              className="w-full py-4 bg-slate-900 text-white font-black uppercase text-[10px] tracking-widest rounded-2xl hover:bg-black shadow-xl disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              {savingNote ? 'Saving...' : 'Save Note'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  const pendingAppointments = appointments.filter(a => a.status === 'pending');
  const nextAppointment = pendingAppointments[0];
  const averageRating = reviews.length > 0 
    ? (reviews.reduce((acc, r) => acc + r.rating, 0) / reviews.length).toFixed(1)
    : '5.0';

  const renderOverview = () => {
    const today = new Date();
    const totalApps = appointments.length;
    const doneCount = appointments.filter(a => a.status === 'done').length;
    const virtualCount = appointments.filter(a => a.type === 'virtual').length;
    const inPersonCount = appointments.filter(a => a.type === 'in-person').length;
    const todayCount = appointments.filter(a => new Date(a.date).toDateString() === today.toDateString()).length;

    // Donut chart segments via SVG arc paths
    const donutData = [
      { label: 'Virtual', value: virtualCount, color: '#4B9FE1' },
      { label: 'In-Person', value: inPersonCount, color: '#F97316' },
      { label: 'Pending', value: pendingAppointments.length, color: '#1E40AF' },
      { label: 'Completed', value: doneCount, color: '#A2F0D3' },
    ].filter(d => d.value > 0);

    const donutTotal = donutData.reduce((s, d) => s + d.value, 0) || 1;
    const CX = 75, CY = 75, R = 55;
    let cumAngle = -90;
    const donutSegments = donutData.map(d => {
      const spanAngle = (d.value / donutTotal) * 360;
      const x1 = CX + R * Math.cos(cumAngle * Math.PI / 180);
      const y1 = CY + R * Math.sin(cumAngle * Math.PI / 180);
      const endAngle = cumAngle + spanAngle;
      const x2 = CX + R * Math.cos((endAngle - 0.01) * Math.PI / 180);
      const y2 = CY + R * Math.sin((endAngle - 0.01) * Math.PI / 180);
      const largeArc = spanAngle > 180 ? 1 : 0;
      const path = `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${R} ${R} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
      cumAngle = endAngle;
      return { ...d, path };
    });

    const recentPatients = [...appointments]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 5);

    const selectedDateStr = selectedDate.toDateString();
    const dayAppointments = [...appointments]
      .filter(a => new Date(a.date).toDateString() === selectedDateStr)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    return (
      <div className="flex gap-5 text-slate-900 animate-in fade-in duration-500">

        {/* ── MAIN CONTENT ── */}
        <div className="flex-1 min-w-0 space-y-5">

          {/* Period toggle + date picker */}
          <div className="flex items-center justify-between">
            <div className="flex bg-slate-100 rounded-xl p-1">
              {(['Yearly', 'Monthly', 'Weekly'] as const).map(p => (
                <button
                  key={p}
                  onClick={() => setSelectedPeriod(p.toLowerCase() as 'yearly' | 'monthly' | 'weekly')}
                  className={`px-5 py-2 rounded-lg text-xs font-bold transition-all ${
                    selectedPeriod === p.toLowerCase()
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
            <button className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 shadow-sm hover:bg-slate-50 transition">
              <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>calendar_month</span>
              Select Dates
            </button>
          </div>

          {/* Stats cards + Patient Overview donut */}
          <div className="flex gap-5">
            {/* 2×2 stat cards */}
            <div className="grid grid-cols-2 gap-4 flex-1">
              {[
                { label: 'Total Patients',  value: totalApps,              icon: 'groups',         bg: 'bg-blue-50',   ic: 'text-blue-500',   trend: '+0.39%', up: true  },
                { label: 'New Patients',    value: pendingAppointments.length, icon: 'person_add',  bg: 'bg-purple-50', ic: 'text-purple-500', trend: '+0.62%', up: true  },
                { label: 'Old Patients',    value: doneCount,              icon: 'person',         bg: 'bg-slate-50',  ic: 'text-slate-400',  trend: '-0.12%', up: false },
                { label: 'Appointments',    value: todayCount,             icon: 'event_available',bg: 'bg-green-50',  ic: 'text-green-500',  trend: '-2%',    up: false },
              ].map(s => (
                <div key={s.label} className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                  <div className="flex items-start justify-between mb-3">
                    <div className={`w-10 h-10 rounded-xl ${s.bg} ${s.ic} flex items-center justify-center`}>
                      <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>{s.icon}</span>
                    </div>
                    <button className="text-slate-300 hover:text-slate-500 transition">
                      <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>more_vert</span>
                    </button>
                  </div>
                  <p className="text-3xl font-black text-slate-900">{s.value}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{s.label}</p>
                  <span className={`text-[11px] font-bold ${s.up ? 'text-emerald-500' : 'text-red-400'}`}>
                    {s.up ? '▲' : '▼'} {s.trend}
                  </span>
                </div>
              ))}
            </div>

            {/* Patient Overview donut */}
            <div className="w-64 bg-white rounded-2xl p-5 border border-slate-100 shadow-sm shrink-0">
              <h3 className="font-black text-slate-900 text-sm mb-3">Patient Overview</h3>
              <div className="space-y-1.5 mb-2">
                {donutData.map(d => (
                  <div key={d.label} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                      <span className="text-xs text-slate-500">{d.label}</span>
                    </div>
                    <span className="text-xs font-black text-slate-700">{d.value}</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-center">
                <svg width="150" height="150" viewBox="0 0 150 150">
                  {donutData.length === 0 ? (
                    <circle cx={CX} cy={CY} r={R} fill="none" stroke="#f1f5f9" strokeWidth="20" />
                  ) : (
                    donutSegments.map((seg, i) => (
                      <path key={i} d={seg.path} fill="none" stroke={seg.color} strokeWidth="20" strokeLinecap="butt" />
                    ))
                  )}
                  <text x={CX} y={CY - 5} textAnchor="middle" style={{ fontSize: '20px', fontWeight: '900', fill: '#0f172a', fontFamily: 'inherit' }}>{totalApps}</text>
                  <text x={CX} y={CY + 13} textAnchor="middle" style={{ fontSize: '9px', fill: '#94a3b8', fontWeight: '600', fontFamily: 'inherit' }}>Total Patients</text>
                </svg>
              </div>
            </div>
          </div>

          {/* My Patients table */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-black text-slate-900 text-sm">My Patients</h3>
              <button className="flex items-center gap-1.5 text-xs font-bold text-slate-500 border border-slate-200 rounded-xl px-3 py-1.5 hover:bg-slate-50 transition">
                Most Recent
                <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>expand_more</span>
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-50 bg-slate-50/50">
                    <th className="text-left px-6 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">#</th>
                    <th className="text-left px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Name</th>
                    <th className="text-left px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Date & Time</th>
                    <th className="text-left px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Appointed for</th>
                    <th className="text-center px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Report</th>
                    <th className="text-center px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {recentPatients.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-12 text-slate-400 text-sm">No patients yet</td>
                    </tr>
                  ) : recentPatients.map((app, i) => (
                    <tr key={app.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-6 py-4 text-slate-400 font-bold text-xs">{String(i + 1).padStart(2, '0')}</td>
                      <td className="px-4 py-4 font-bold text-slate-900 text-sm">
                        <button
                          className="hover:text-blue-600 transition-colors text-left font-bold underline-offset-2 hover:underline"
                          onClick={() => setSelectedPatient({
                            patientId: app.patientId,
                            patientName: app.patientName,
                            appointmentId: app.id,
                            visitDate: app.date,
                          })}
                        >
                          {app.patientName}
                        </button>
                      </td>
                      <td className="px-4 py-4 text-slate-500 text-xs whitespace-nowrap">
                        {new Date(app.date).toLocaleDateString('en-US', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                      </td>
                      <td className="px-4 py-4 text-slate-600 text-xs capitalize">
                        {app.type === 'virtual' ? 'Virtual Consultation' : 'In-Person Visit'}
                      </td>
                      <td className="px-4 py-4 text-center">
                        <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-red-50 text-red-400">
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 7V3.5L18.5 9H13zM6 4h6v5h5v11H6V4z"/>
                          </svg>
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center justify-center gap-1.5">
                          <button className="w-7 h-7 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center hover:bg-slate-200 transition">
                            <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>share</span>
                          </button>
                          <button className="w-7 h-7 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center hover:bg-slate-200 transition">
                            <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>download</span>
                          </button>
                          {app.status === 'pending' && (
                            <button onClick={() => handleComplete(app.id)} className="w-7 h-7 rounded-lg bg-slate-900 text-white flex items-center justify-center hover:bg-black transition">
                              <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>check</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Bottom charts row */}
          <div className="grid grid-cols-2 gap-5">
            {/* Daily Visitors */}
            <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-slate-900 text-sm">Daily Visitors</h3>
                <button className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center hover:bg-slate-200 transition">
                  <span className="material-symbols-outlined text-slate-400" style={{ fontSize: '14px' }}>refresh</span>
                </button>
              </div>
              <div className="flex gap-2">
                <div className="flex flex-col justify-between text-[9px] text-slate-300 font-bold py-1" style={{ minWidth: '36px' }}>
                  <span>50-70</span>
                  <span>25-50</span>
                  <span>10-25</span>
                  <span>0-10</span>
                </div>
                <div className="flex-1">
                  <svg viewBox="0 0 220 72" className="w-full h-20" preserveAspectRatio="xMidYMid meet">
                    <polyline
                      points="10,62 42,52 74,42 106,24 138,36 170,14 202,20"
                      fill="none" stroke="#A2F0D3" strokeWidth="2.5"
                      strokeLinecap="round" strokeLinejoin="round"
                    />
                    <circle cx="106" cy="24" r="4" fill="#A2F0D3" stroke="white" strokeWidth="1.5" />
                    <circle cx="170" cy="14" r="4" fill="#A2F0D3" stroke="white" strokeWidth="1.5" />
                  </svg>
                  <div className="flex justify-between text-[9px] text-slate-300 font-bold mt-1">
                    {['S','M','T','W','T','F','S'].map((d, i) => <span key={i}>{d}</span>)}
                  </div>
                </div>
              </div>
            </div>

            {/* Appointment Stats */}
            <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-slate-900 text-sm">Appointment Stats</h3>
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1 text-[10px] font-bold text-slate-500">
                    <span className="w-2.5 h-2.5 rounded-full bg-orange-400 inline-block" /> Offline
                  </span>
                  <span className="flex items-center gap-1 text-[10px] font-bold text-slate-500">
                    <span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block" /> Online
                  </span>
                </div>
              </div>
              <svg viewBox="0 0 210 72" className="w-full h-20" preserveAspectRatio="xMidYMid meet">
                {[
                  { off: 48, on: 44 },
                  { off: 35, on: 56 },
                  { off: 52, on: 48 },
                  { off: 40, on: 60 },
                  { off: 58, on: 40 },
                  { off: 44, on: 52 },
                  { off: 50, on: 58 },
                ].map((day, i) => (
                  <g key={i} transform={`translate(${i * 30 + 5}, 0)`}>
                    <rect x="2"  y={72 - day.off} width="10" height={day.off} fill="#F97316" rx="3" opacity="0.85" />
                    <rect x="14" y={72 - day.on}  width="10" height={day.on}  fill="#3B82F6" rx="3" opacity="0.85" />
                  </g>
                ))}
              </svg>
              <div className="flex justify-between text-[9px] text-slate-300 font-bold mt-1 px-2">
                {['S','M','T','W','T','F','S'].map((d, i) => <span key={i}>{d}</span>)}
              </div>
            </div>
          </div>
        </div>

        {/* ── APPOINTMENTS SIDEBAR ── */}
        <div className="w-72 shrink-0 flex flex-col">
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden flex flex-col" style={{ maxHeight: 'calc(100vh - 120px)' }}>

            {/* Header */}
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-black text-slate-900 text-sm">Appointments</h3>
              <button className="flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-slate-700 transition">
                {selectedDate.toLocaleString('default', { month: 'long', year: 'numeric' })}
                <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>expand_more</span>
              </button>
            </div>

            {/* Date strip */}
            <div className="px-3 py-3 flex items-center gap-1.5 border-b border-slate-50">
              <button onClick={() => changeWeek(-1)} className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center hover:bg-slate-200 transition shrink-0">
                <span className="material-symbols-outlined text-slate-500" style={{ fontSize: '15px' }}>chevron_left</span>
              </button>
              <div className="flex flex-1 gap-1">
                {weekDates.slice(0, 5).map((date, i) => {
                  const isSel = date.toDateString() === selectedDateStr;
                  const isTod = date.toDateString() === today.toDateString();
                  return (
                    <button
                      key={i}
                      onClick={() => setSelectedDate(date)}
                      className={`flex flex-col items-center py-2 rounded-xl transition-all flex-1 ${
                        isSel
                          ? 'bg-[#A2F0D3] text-slate-900'
                          : isTod
                            ? 'bg-slate-900 text-white'
                            : 'hover:bg-slate-50 text-slate-500'
                      }`}
                    >
                      <span className="text-[8px] font-black uppercase leading-none">
                        {['SUN','MON','TUE','WED','THU','FRI','SAT'][date.getDay()].slice(0, 3)}
                      </span>
                      <span className="text-base font-black leading-none mt-1">{date.getDate()}</span>
                    </button>
                  );
                })}
              </div>
              <button onClick={() => changeWeek(1)} className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center hover:bg-slate-200 transition shrink-0">
                <span className="material-symbols-outlined text-slate-500" style={{ fontSize: '15px' }}>chevron_right</span>
              </button>
            </div>

            {/* Appointment list */}
            <div className="overflow-y-auto flex-1 no-scrollbar">
              {dayAppointments.length === 0 ? (
                <div className="px-5 py-12 text-center">
                  <span className="material-symbols-outlined block text-slate-200 mb-3" style={{ fontSize: '40px' }}>event_busy</span>
                  <p className="text-slate-400 text-xs font-medium">No appointments for this day</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-50">
                  {dayAppointments.map(app => (
                    <div
                      key={app.id}
                      className="px-4 py-4 flex items-center gap-3 hover:bg-slate-50 transition cursor-pointer"
                      onClick={() => setSelectedPatient({
                        patientId: app.patientId,
                        patientName: app.patientName,
                        appointmentId: app.id,
                        visitDate: app.date,
                      })}
                    >
                      <div className="w-10 h-10 rounded-full bg-slate-100 overflow-hidden shrink-0">
                        <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${app.patientName}`} alt="" className="w-full h-full" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-slate-900 text-sm truncate leading-tight">{app.patientName}</p>
                        <p
                          className="text-[11px] font-bold mt-0.5 capitalize leading-tight"
                          style={{ color: app.type === 'virtual' ? '#4B9FE1' : '#2dd4bf' }}
                        >
                          {app.type === 'virtual' ? 'Virtual Visit' : 'In-Person Visit'}
                        </p>
                      </div>
                      <div className="text-right shrink-0 flex flex-col items-end gap-1">
                        <p className="text-xs font-bold text-slate-500">
                          {new Date(app.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                        <button className="text-slate-300 hover:text-slate-500 transition">
                          <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>more_vert</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const navItems: { view: DoctorView; label: string; icon: string }[] = [
    { view: 'overview',  label: 'Dashboard',    icon: 'grid_view'      },
    { view: 'schedule',  label: 'Appointments', icon: 'calendar_month' },
    { view: 'rooms',     label: 'Rooms',        icon: 'meeting_room'   },
    { view: 'news',      label: 'News',         icon: 'newspaper'      },
    { view: 'profile',   label: 'Profile',      icon: 'person'         },
  ];

  const viewTitle: Record<DoctorView, string> = {
    overview: 'Dashboard',
    schedule: 'Appointments',
    rooms:    'Rooms',
    news:     'News',
    profile:  'Profile',
  };

  return (
    <div className="flex min-h-screen bg-slate-50">

      {/* ── Visit wrap-up modal ── */}
      {commentingId && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center p-4 z-[100] animate-in fade-in duration-200">
          <div className="bg-white rounded-[3rem] p-10 max-w-md w-full shadow-2xl animate-in zoom-in-95 duration-300">
            <h3 className="text-2xl font-black text-slate-900 mb-2 uppercase tracking-tighter">Visit Wrap-Up</h3>
            <textarea value={tempComment} onChange={(e) => setTempComment(e.target.value)} placeholder="Visit notes..." className="w-full h-40 bg-slate-50 border border-slate-200 rounded-[1.5rem] p-6 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all mb-8 text-slate-900" />
            <div className="flex space-x-4">
              <button onClick={() => setCommentingId(null)} className="flex-1 py-4 text-slate-400 font-black uppercase text-[10px] tracking-widest hover:bg-slate-100 rounded-2xl">Discard</button>
              <button onClick={submitCompletion} className="flex-1 py-4 bg-slate-900 text-white font-black uppercase text-[10px] tracking-widest rounded-2xl hover:bg-black shadow-xl">Finalize</button>
            </div>
          </div>
        </div>
      )}

      {renderPatientPanel()}

      {/* ── LEFT SIDEBAR ── */}
      <aside className="w-60 shrink-0 bg-[#0a1628] flex flex-col fixed inset-y-0 left-0 z-50">

        {/* Logo */}
        <div className="px-6 py-5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <img src="/kura-logo.png" alt="Kura" className="w-9 h-9 rounded-[10px] shadow-lg" />
            <span className="text-white font-black text-xl tracking-tighter">Kura</span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-6 space-y-1">
          {navItems.map(item => (
            <button
              key={item.view}
              onClick={() => { setCurrentView(item.view); setSelectedPatient(null); setNoteInput(''); if (item.view === 'profile') setIsEditingProfile(false); }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-sm font-bold text-left ${
                currentView === item.view
                  ? 'bg-white/15 text-white'
                  : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
              }`}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        {/* User card + logout */}
        <div className="px-3 pb-6">
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/5">
            <div className="w-9 h-9 rounded-full bg-[#A2F0D3] flex items-center justify-center text-slate-900 font-black text-sm shrink-0">
              {profile.name?.[0]?.toUpperCase() ?? '?'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-xs font-bold truncate">{profile.name}</p>
              <p className="text-slate-400 text-[10px] capitalize truncate">{profile.specialty || profile.category || 'Doctor'}</p>
            </div>
            <button
              onClick={() => signOut(auth)}
              className="text-slate-400 hover:text-white transition shrink-0"
              title="Sign out"
            >
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>logout</span>
            </button>
          </div>
        </div>
      </aside>

      {/* ── MAIN AREA ── */}
      <div className="ml-60 flex-1 flex flex-col min-h-screen">

        {/* Top bar */}
        <header className="bg-white border-b border-slate-100 px-8 h-16 flex items-center justify-between sticky top-0 z-40 shrink-0">
          <h2 className="text-slate-900 font-black text-lg tracking-tighter">{viewTitle[currentView]}</h2>
          <span className="text-slate-400 text-xs font-medium hidden sm:block">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </span>
        </header>

        {/* Page content */}
        <main className="flex-1 p-8">
          {currentView === 'overview'
            ? renderOverview()
            : currentView === 'schedule'
              ? renderSchedule()
              : currentView === 'rooms'
                ? renderRooms()
                : currentView === 'news'
                  ? renderNews()
                  : renderProfile()}
        </main>
      </div>
    </div>
  );
};

export default DoctorDashboard;