import React, { useEffect, useState, useRef, useMemo } from 'react';
import { db } from '../firebase';
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
import type { UserProfile, Appointment, Review, WorkingHours, Education } from '../types';

interface DoctorDashboardProps {
  profile: UserProfile;
}

type DoctorView = 'overview' | 'profile' | 'schedule' | 'rooms';

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
    <div className="flex bg-white h-[calc(100vh-140px)] -mx-4 -mt-8 rounded-b-[2rem] overflow-hidden animate-in fade-in duration-500">
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
          <div className="grid grid-cols-7 min-h-full">
            {weekDates.map((_, dayIdx) => (
              <div key={dayIdx} className="border-r border-slate-50 relative min-h-full last:border-r-0">
                {timeSlots.map(time => (
                  <div key={time} className="h-20 border-b border-slate-50/50 flex items-start px-3 py-2">
                    {dayIdx === 0 && (
                      <span className="absolute left-[-45px] text-[10px] font-black text-slate-300 transform -translate-y-1/2">
                        {time}
                      </span>
                    )}
                  </div>
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
                        <p className="text-[9px] font-bold text-slate-500 uppercase tracking-tighter mt-1 truncate">{app.type}</p>
                      </div>
                    );
                  })}
              </div>
            ))}
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
    <div className="space-y-8 pb-24 animate-in fade-in duration-500">
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
    <div className="max-w-4xl mx-auto space-y-8 animate-in slide-in-from-bottom-4 duration-500 pb-24 text-slate-900">
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

  const pendingAppointments = appointments.filter(a => a.status === 'pending');
  const nextAppointment = pendingAppointments[0];
  const averageRating = reviews.length > 0 
    ? (reviews.reduce((acc, r) => acc + r.rating, 0) / reviews.length).toFixed(1)
    : '5.0';

  const renderOverview = () => (
    <div className="space-y-8 animate-in fade-in duration-500 pb-24 text-slate-900">
      {nextAppointment && (
        <section className="bg-slate-900 p-8 rounded-[2.5rem] text-white shadow-2xl relative overflow-hidden">
          <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-8">
            <div className="flex items-center space-x-6">
              <div className="w-24 h-24 rounded-[2rem] bg-white/10 backdrop-blur-md border border-white/20 p-1">
                <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${nextAppointment.patientName}`} className="w-full h-full rounded-[1.8rem] bg-slate-800" alt="" />
              </div>
              <div>
                <p className="text-[#A2F0D3] text-[10px] font-black uppercase tracking-[0.2em] mb-2">Next Patient Spotlight</p>
                <h2 className="text-3xl font-black tracking-tight">{nextAppointment.patientName}</h2>
                <p className="text-slate-400 text-sm mt-2 font-bold uppercase tracking-widest">{new Date(nextAppointment.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {nextAppointment.type}</p>
              </div>
            </div>
            <button onClick={() => handleComplete(nextAppointment.id)} className="px-8 py-4 bg-[#A2F0D3] text-black rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl">Check-In</button>
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-200">
          <h3 className="text-slate-400 text-[10px] font-black uppercase tracking-widest">Global Score</h3>
          <p className="text-3xl font-black text-slate-900 mt-2">{averageRating}</p>
        </div>
        <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-200">
          <h3 className="text-slate-400 text-[10px] font-black uppercase tracking-widest">Pending</h3>
          <p className="text-3xl font-black text-blue-600 mt-2">{pendingAppointments.length}</p>
        </div>
        <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-200">
          <h3 className="text-slate-400 text-[10px] font-black uppercase tracking-widest">Daily Count</h3>
          <p className="text-3xl font-black text-slate-900 mt-2">{appointments.filter(a => new Date(a.date).toDateString() === new Date().toDateString()).length}</p>
        </div>
        <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-200">
          <h3 className="text-slate-400 text-[10px] font-black uppercase tracking-widest">Completed</h3>
          <p className="text-3xl font-black text-emerald-600 mt-2">{appointments.filter(a => a.status === 'done').length}</p>
        </div>
      </div>

      <div className="bg-white rounded-[2.5rem] shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-8 py-6 border-b border-slate-100 flex justify-between items-center">
          <h2 className="text-sm font-black uppercase tracking-[0.2em] text-slate-900">Queue</h2>
        </div>
        <div className="divide-y divide-slate-100">
          {pendingAppointments.map(app => (
            <div key={app.id} className="p-8 flex items-center justify-between">
              <div className="flex items-center space-x-5">
                <div className="w-12 h-12 rounded-2xl bg-slate-100 overflow-hidden"><img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${app.patientName}`} alt="" /></div>
                <div><h4 className="font-bold text-slate-900">{app.patientName}</h4><p className="text-slate-500 text-xs font-medium uppercase mt-0.5">{new Date(app.date).toLocaleTimeString()} • {app.type}</p></div>
              </div>
              <button onClick={() => handleComplete(app.id)} className="w-10 h-10 rounded-full bg-slate-900 text-white flex items-center justify-center">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-8 min-h-screen">
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

      {currentView === 'overview'
        ? renderOverview()
        : currentView === 'schedule'
          ? renderSchedule()
          : currentView === 'rooms'
            ? renderRooms()
            : renderProfile()}

      <nav className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-white/80 backdrop-blur-2xl border border-slate-200 h-20 rounded-[2.5rem] flex items-center px-4 z-50 shadow-2xl min-w-[420px]">
        <div className="flex w-full justify-around items-center">
          <button onClick={() => setCurrentView('overview')} className={`flex flex-col items-center px-6 py-2 rounded-2xl transition-all ${currentView === 'overview' ? 'text-blue-600 scale-110' : 'text-slate-300'}`}>
            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/></svg>
            <span className="text-[10px] mt-1 font-black uppercase tracking-tighter">Summary</span>
          </button>
          <button onClick={() => setCurrentView('schedule')} className={`flex flex-col items-center px-6 py-2 rounded-2xl transition-all ${currentView === 'schedule' ? 'text-blue-600 scale-110' : 'text-slate-300'}`}>
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
            <span className="text-[10px] mt-1 font-black uppercase tracking-tighter">Schedule</span>
          </button>
          <button onClick={() => setCurrentView('rooms')} className={`flex flex-col items-center px-6 py-2 rounded-2xl transition-all ${currentView === 'rooms' ? 'text-blue-600 scale-110' : 'text-slate-300'}`}>
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 21V5a2 2 0 012-2h7a2 2 0 012 2v16M7 21v-4a2 2 0 012-2h3M14 7h5a2 2 0 012 2v12M17 21v-4" />
            </svg>
            <span className="text-[10px] mt-1 font-black uppercase tracking-tighter">Rooms</span>
          </button>
          <button onClick={() => { setCurrentView('profile'); setIsEditingProfile(false); }} className={`flex flex-col items-center px-6 py-2 rounded-2xl transition-all ${currentView === 'profile' ? 'text-blue-600 scale-110' : 'text-slate-300'}`}>
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
            <span className="text-[10px] mt-1 font-black uppercase tracking-tighter">Portfolio</span>
          </button>
        </div>
      </nav>
    </div>
  );
};

export default DoctorDashboard;