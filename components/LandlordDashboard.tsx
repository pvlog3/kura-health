import React, { useEffect, useMemo, useState } from 'react';
import { db } from '../firebase';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  updateDoc,
  where,
} from 'firebase/firestore';
import type { UserProfile, WorkingHours, RoomDoc, Amenity, RoomBooking } from '../types';

type LandlordView = 'overview' | 'create' | 'rooms' | 'bookings';

const AMENITIES: { id: Amenity; label: string; icon: string }[] = [
  { id: 'wifi', label: 'Wi‑Fi', icon: 'wifi' },
  { id: 'reception', label: 'Reception', icon: 'support_agent' },
  { id: 'parking', label: 'Parking', icon: 'local_parking' },
  { id: 'wheelchair', label: 'Accessible', icon: 'accessible' },
  { id: 'ac', label: 'A/C', icon: 'ac_unit' },
  { id: 'restroom', label: 'Restroom', icon: 'wc' },
  { id: 'waiting_area', label: 'Waiting area', icon: 'weekend' },
  { id: 'equipment', label: 'Equipment', icon: 'medical_services' },
];

const emptyForm = {
  name: '',
  address: '',
  city: '',
  hourlyRate: '',
  notes: '',
  available: true,
  amenities: new Set<Amenity>(),
  hoursStart: '08:00',
  hoursEnd: '18:00',
  days: new Set<number>([1, 2, 3, 4, 5]), // Mon-Fri
  sizeSqft: '',
  capacity: '',
  instantBook: false,
  cancellationPolicy: 'moderate' as 'flexible' | 'moderate' | 'strict',
  allowedCategories: new Set<string>(),
  allowedSpecialties: new Set<string>(),
};

const CATEGORIES = [
  { id: 'dentist', label: 'Dentist' },
  { id: 'psychologist', label: 'Psychologist' },
  { id: 'doctor', label: 'Medical Doctor' },
  { id: 'physiotherapist', label: 'Physiotherapist' },
];

const SPECIALTIES: Record<string, { id: string, label: string }[]> = {
  dentist: [
    { id: 'general_dentist', label: 'General Dentist' },
    { id: 'endodontist', label: 'Endodontist' },
    { id: 'orthodontist', label: 'Orthodontist' },
    { id: 'pediatric', label: 'Pediatric Dentist' },
    { id: 'periodontist', label: 'Periodontist' },
    { id: 'prosthodontist', label: 'Prosthodontist' },
    { id: 'oral_surgeon', label: 'Oral Surgeon' },
  ],
  psychologist: [
    { id: 'clinical', label: 'Clinical Psychologist' },
    { id: 'counseling', label: 'Counseling Psychologist' },
    { id: 'child', label: 'Child Psychologist' },
  ],
};

const LandlordDashboard: React.FC<{ profile: UserProfile }> = ({ profile }) => {
  const [myRooms, setMyRooms] = useState<RoomDoc[]>([]);
  const [bookings, setBookings] = useState<RoomBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState(emptyForm);
  const [photoPreviews, setPhotoPreviews] = useState<(string | null)[]>([null, null, null]);
  const [submitting, setSubmitting] = useState(false);
  const [editingRoom, setEditingRoom] = useState<RoomDoc | null>(null);
  const [search, setSearch] = useState('');
  const [currentView, setCurrentView] = useState<LandlordView>('overview');
  const [showPublishSuccess, setShowPublishSuccess] = useState(false);
  const [publishedName, setPublishedName] = useState<string>('');
  const [createStep, setCreateStep] = useState(1);

  useEffect(() => {
    const qRooms = query(
      collection(db, 'rooms'),
      where('ownerId', '==', profile.uid)
    );

    const unsubRooms = onSnapshot(
      qRooms,
      (snap) => {
        const rooms = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<RoomDoc, 'id'>) }))
          .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
        setMyRooms(rooms);
        setError(null);
        setLoading(false);
      },
      (e) => {
        console.error('Landlord rooms snapshot error:', e);
        setError(
          e.code === 'permission-denied'
            ? "You don't have permission to manage rooms yet."
            : `Failed to load rooms. (${e.code || 'unknown-error'})`
        );
        setLoading(false);
      }
    );

    const qBookings = query(
      collection(db, 'room_requests'),
      where('roomOwnerId', '==', profile.uid)
    );

    const unsubBookings = onSnapshot(
      qBookings,
      (snap) => {
        const b = snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<RoomBooking, 'id'>) }))
            .sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt)));
        setBookings(b);
      },
      (e) => console.error('Bookings snap error:', e)
    );

    return () => { unsubRooms(); unsubBookings(); };
  }, [profile.uid]);

  const filteredRooms = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return myRooms;
    return myRooms.filter((r) => `${r.name} ${r.city} ${r.address}`.toLowerCase().includes(q));
  }, [myRooms, search]);

  const activeRoomsCount = myRooms.filter(r => r.available).length;
  const totalEarningsMock = bookings.filter(b => b.status === 'completed').reduce((acc, curr) => acc + (curr.totalPrice || 0), 0);
  const upcomingBookingsCount = bookings.filter(b => b.status === 'confirmed').length;

  const handlePhotoFile = (e: React.ChangeEvent<HTMLInputElement>, index: number) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const MAX = 800;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      const base64 = canvas.toDataURL('image/jpeg', 0.75);
      setPhotoPreviews(prev => { const next = [...prev]; next[index] = base64; return next; });
    };
    img.src = objectUrl;
  };

  const toggleAmenity = (id: Amenity) => {
    setForm((prev) => {
      const next = { ...prev, amenities: new Set(prev.amenities) };
      if (next.amenities.has(id)) next.amenities.delete(id);
      else next.amenities.add(id);
      return next;
    });
  };

  const handleEditRoom = (r: RoomDoc) => {
    setForm({
      name: r.name,
      address: r.address,
      city: r.city,
      hourlyRate: String(r.hourlyRate),
      notes: r.notes || '',
      available: r.available,
      amenities: new Set(r.amenities),
      hoursStart: r.availability?.start || '08:00',
      hoursEnd: r.availability?.end || '18:00',
      days: new Set(r.availability?.days || [1, 2, 3, 4, 5]),
      sizeSqft: r.sizeSqft ? String(r.sizeSqft) : '',
      capacity: r.capacity ? String(r.capacity) : '',
      instantBook: !!r.instantBook,
      cancellationPolicy: r.cancellationPolicy || 'moderate',
      allowedCategories: new Set(r.allowedCategories || []),
      allowedSpecialties: new Set(r.allowedSpecialties || []),
    });
    const previews: (string | null)[] = [null, null, null];
    r.photos.forEach((p, i) => { if (i < 3) previews[i] = p; });
    setPhotoPreviews(previews);
    setEditingRoom(r);
    setCreateStep(1);
    setCurrentView('create');
  };

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    if (createStep < 5) {
      setCreateStep(prev => prev + 1);
      return;
    }

    const hourly = Number(String(form.hourlyRate).trim());
    if (!Number.isFinite(hourly) || hourly <= 0) {
      alert('Please enter a valid hourly rate.');
      return;
    }

    const availability: WorkingHours = {
      start: form.hoursStart,
      end: form.hoursEnd,
      days: Array.from(form.days).sort(),
    };

    setSubmitting(true);
    try {
      const listingName = form.name.trim();
      const photos = photoPreviews.filter((p): p is string => p !== null);

      const payload = {
        name: listingName,
        address: form.address.trim(),
        city: form.city.trim(),
        hourlyRate: hourly,
        photos,
        amenities: Array.from(form.amenities),
        notes: form.notes.trim() ? form.notes.trim() : null,
        available: form.available,
        availability,
        sizeSqft: form.sizeSqft ? Number(form.sizeSqft) : null,
        capacity: form.capacity ? Number(form.capacity) : null,
        instantBook: form.instantBook,
        cancellationPolicy: form.cancellationPolicy,
        allowedCategories: Array.from(form.allowedCategories),
        allowedSpecialties: Array.from(form.allowedSpecialties),
      };

      if (editingRoom) {
        await updateDoc(doc(db, 'rooms', editingRoom.id), payload);
        setEditingRoom(null);
        setForm(emptyForm);
        setPhotoPreviews([null, null, null]);
        setCreateStep(1);
        setCurrentView('rooms');
      } else {
        await addDoc(collection(db, 'rooms'), {
          ...payload,
          ownerId: profile.uid,
          ownerName: profile.name,
          createdAt: new Date().toISOString(),
        });
        setForm(emptyForm);
        setPhotoPreviews([null, null, null]);
        setCreateStep(1);
        setPublishedName(listingName);
        setShowPublishSuccess(true);
        setCurrentView('rooms');
      }
    } catch (e) {
      console.error('Save room error:', e);
      alert('Failed to save listing. Check Firestore rules and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const removeRoom = async (roomId: string) => {
    const ok = confirm('Delete this listing? This cannot be undone.');
    if (!ok) return;
    try {
      await deleteDoc(doc(db, 'rooms', roomId));
    } catch (e) {
      console.error('Delete room error:', e);
      alert('Failed to delete listing.');
    }
  };

  return (
    <div className="space-y-10 pb-24 max-w-[1400px] mx-auto">
      {/* Header & Navigation */}
      <header className="bg-white border border-slate-200 rounded-[2.5rem] p-8 md:p-10 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tighter">Host Dashboard</h1>
          <p className="text-slate-500 text-sm mt-1">Manage your clinic spaces and bookings.</p>
        </div>

        <nav className="flex items-center gap-2 overflow-x-auto pb-2 md:pb-0 hide-scrollbar">
          {(['overview', 'bookings', 'rooms', 'create'] as LandlordView[]).map((view) => (
            <button
              key={view}
              onClick={() => {
                setCurrentView(view);
                if (view !== 'create') {
                  setEditingRoom(null);
                  setForm(emptyForm);
                  setPhotoPreviews([null, null, null]);
                  setCreateStep(1);
                }
              }}
              className={`whitespace-nowrap px-6 py-3 rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all ${
                currentView === view
                  ? 'bg-slate-900 text-white shadow-md'
                  : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
              }`}
            >
              {view === 'create' ? (editingRoom ? 'Edit Listing' : '+ New Listing') : view}
            </button>
          ))}
        </nav>
      </header>

      {/* OVERVIEW TAB */}
      {currentView === 'overview' && (
        <section className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white border border-slate-200 rounded-[2rem] p-8 shadow-sm relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-8 text-slate-100 group-hover:scale-110 group-hover:-rotate-12 transition-transform duration-500">
                <span className="material-symbols-outlined text-8xl">apartment</span>
              </div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 relative z-10">Total Listings</p>
              <h2 className="text-5xl font-black text-slate-900 mt-2 relative z-10">{myRooms.length}</h2>
              <p className="text-sm text-slate-500 font-medium mt-2 relative z-10">
                {activeRoomsCount} currently active
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-[2rem] p-8 shadow-sm relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-8 text-emerald-50 group-hover:scale-110 group-hover:rotate-12 transition-transform duration-500">
                <span className="material-symbols-outlined text-8xl">payments</span>
              </div>
              <p className="text-[10px] font-black uppercase tracking-widest text-emerald-600 relative z-10">Total Earnings</p>
              <h2 className="text-5xl font-black text-slate-900 mt-2 relative z-10">${totalEarningsMock}</h2>
              <p className="text-sm text-slate-500 font-medium mt-2 relative z-10">From completed bookings</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-[2rem] p-8 shadow-lg relative overflow-hidden group">
               <div className="absolute top-0 right-0 p-8 text-slate-800 group-hover:scale-110 transition-transform duration-500">
                <span className="material-symbols-outlined text-8xl">book_online</span>
              </div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 relative z-10">Upcoming Bookings</p>
              <h2 className="text-5xl font-black text-white mt-2 relative z-10">{upcomingBookingsCount}</h2>
              <p className="text-sm text-slate-400 font-medium mt-2 relative z-10">Confirmed for future dates</p>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-[2.5rem] p-8 md:p-10 shadow-sm">
             <div className="flex items-center justify-between mb-8">
                <h3 className="text-xl font-black text-slate-900 tracking-tight">Recent Activity</h3>
                <button onClick={() => setCurrentView('bookings')} className="text-sm font-bold text-blue-600 hover:text-blue-700">View all</button>
             </div>
             
             {bookings.length === 0 ? (
               <div className="text-center py-10">
                 <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
                   <span className="material-symbols-outlined text-slate-300 text-3xl">inbox</span>
                 </div>
                 <p className="text-slate-500 text-sm">No recent booking activity.</p>
               </div>
             ) : (
               <div className="space-y-4">
                 {bookings.slice(0, 5).map(b => (
                   <div key={b.id} className="flex items-center justify-between p-4 rounded-2xl border border-slate-100 hover:bg-slate-50 transition-colors">
                     <div className="flex items-center gap-4">
                       <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center text-blue-600">
                         <span className="material-symbols-outlined">event_available</span>
                       </div>
                       <div>
                         <p className="font-bold text-slate-900">{b.doctorName} <span className="font-medium text-slate-500">requested</span> {b.roomName}</p>
                         <p className="text-xs text-slate-500 mt-1">{b.date || new Date(b.createdAt).toLocaleDateString()} {b.startTime ? `• ${b.startTime} - ${b.endTime}` : ''}</p>
                       </div>
                     </div>
                     <div className="text-right">
                       {b.totalPrice ? <p className="font-black text-slate-900">${b.totalPrice}</p> : <p className="font-bold text-slate-400 text-xs uppercase">Requested</p>}
                       <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-md mt-1 inline-block ${
                         b.status === 'confirmed' ? 'bg-emerald-100 text-emerald-700' :
                         b.status === 'pending' ? 'bg-amber-100 text-amber-700' :
                         b.status === 'completed' ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'
                       }`}>
                         {b.status}
                       </span>
                     </div>
                   </div>
                 ))}
               </div>
             )}
          </div>
        </section>
      )}

      {/* CREATE LISTING WIZARD */}
      {currentView === 'create' && (
        <section className="bg-white border border-slate-200 rounded-[2.5rem] p-8 md:p-12 shadow-sm animate-in fade-in slide-in-from-bottom-4">
          <div className="flex items-center justify-between mb-10">
            <div>
              <h2 className="text-2xl font-black text-slate-900 tracking-tight">{editingRoom ? 'Edit listing' : 'Create a listing'}</h2>
              <p className="text-slate-500 text-sm mt-1">Step {createStep} of 4</p>
            </div>
            
            {/* Progress bar */}
            <div className="w-1/3 h-2 bg-slate-100 rounded-full overflow-hidden flex">
              {[1, 2, 3, 4, 5].map(s => (
                <div key={s} className={`flex-1 h-full ${s <= createStep ? 'bg-slate-900' : ''} border-r border-white/20 last:border-0 transition-all duration-500`} />
              ))}
            </div>
          </div>

          <form onSubmit={submitForm}>
            
            {/* STEP 1: Basics */}
            {createStep === 1 && (
              <div className="space-y-8 animate-in fade-in">
                <div>
                  <h3 className="text-xl font-bold text-slate-900 mb-6">Let's start with the basics</h3>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Listing title</label>
                  <input
                    value={form.name}
                    onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                    placeholder="e.g. Bright private dental room near downtown"
                    required
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-900 transition-all"
                  />
                </div>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Size (sq ft / sqm)</label>
                    <input
                      value={form.sizeSqft}
                      onChange={(e) => setForm((p) => ({ ...p, sizeSqft: e.target.value }))}
                      type="number"
                      placeholder="e.g. 200"
                      className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-900 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Capacity (people)</label>
                    <input
                      value={form.capacity}
                      onChange={(e) => setForm((p) => ({ ...p, capacity: e.target.value }))}
                      type="number"
                      placeholder="e.g. 3"
                      className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-900 transition-all"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* STEP 2: Location */}
            {createStep === 2 && (
              <div className="space-y-8 animate-in fade-in">
                <h3 className="text-xl font-bold text-slate-900 mb-6">Where is your clinic located?</h3>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Street Address</label>
                  <input
                    value={form.address}
                    onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))}
                    placeholder="e.g. 123 Health Ave, Suite 400"
                    required
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-900 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">City</label>
                  <input
                    value={form.city}
                    onChange={(e) => setForm((p) => ({ ...p, city: e.target.value }))}
                    placeholder="e.g. New York"
                    required
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-900 transition-all"
                  />
                </div>
              </div>
            )}

            {/* STEP 3: Features */}
            {createStep === 3 && (
              <div className="space-y-8 animate-in fade-in">
                <h3 className="text-xl font-bold text-slate-900 mb-6">Make your listing stand out</h3>
                
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3">Photos</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {[0, 1, 2].map((i) => (
                      <label
                        key={i}
                        className="relative h-40 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 hover:bg-slate-100 hover:border-slate-400 cursor-pointer transition-all overflow-hidden flex flex-col items-center justify-center gap-2 group"
                      >
                        {photoPreviews[i] ? (
                          <>
                            <img src={photoPreviews[i]!} alt={`Photo ${i + 1}`} className="absolute inset-0 w-full h-full object-cover rounded-2xl" />
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                              <span className="material-symbols-outlined text-white">edit</span>
                            </div>
                          </>
                        ) : (
                          <>
                            <span className="material-symbols-outlined text-slate-300 text-3xl">add_photo_alternate</span>
                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Photo {i + 1}</span>
                          </>
                        )}
                        <input type="file" accept="image/*" className="hidden" onChange={(e) => handlePhotoFile(e, i)} />
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-4">Amenities</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {AMENITIES.map((a) => {
                      const selected = form.amenities.has(a.id);
                      return (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => toggleAmenity(a.id)}
                          className={`p-4 rounded-2xl border text-left transition-all ${
                            selected ? 'bg-slate-900 border-slate-900 text-white' : 'bg-slate-50 border-slate-200 hover:bg-slate-100 text-slate-700'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className={`material-symbols-outlined text-lg ${selected ? 'text-white' : 'text-slate-500'}`}>{a.icon}</span>
                            <span className="text-[10px] font-black uppercase tracking-widest">{a.label}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Description / Notes</label>
                  <textarea
                    value={form.notes}
                    onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                    placeholder="Describe the space, equipment available, check-in instructions, etc."
                    className="w-full h-32 bg-slate-50 border border-slate-200 rounded-[1.5rem] px-5 py-4 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-900 transition-all"
                  />
                </div>
              </div>
            )}

            {/* STEP 4: Pricing & Availability */}
            {createStep === 4 && (
              <div className="space-y-10 animate-in fade-in">
                <h3 className="text-xl font-bold text-slate-900 mb-6">Set your price and policies</h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-8">
                    <div>
                      <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Hourly Rate ($)</label>
                      <input
                        value={form.hourlyRate}
                        onChange={(e) => setForm((p) => ({ ...p, hourlyRate: e.target.value }))}
                        type="number"
                        placeholder="e.g. 45"
                        required
                        className="w-full text-2xl font-black bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-slate-900 outline-none focus:ring-2 focus:ring-slate-900 transition-all"
                      />
                    </div>
                    
                    <div className="p-5 border border-slate-200 rounded-2xl bg-slate-50">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-bold text-slate-900">Instant Book</p>
                          <p className="text-xs text-slate-500 mt-1">Professionals can book without your approval.</p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input type="checkbox" className="sr-only peer" checked={form.instantBook} onChange={(e) => setForm(p => ({...p, instantBook: e.target.checked}))} />
                          <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                        </label>
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3">Cancellation Policy</label>
                      <div className="flex gap-2 bg-slate-50 border border-slate-200 p-1 rounded-xl">
                        {(['flexible', 'moderate', 'strict'] as const).map((pol) => (
                          <button
                            key={pol}
                            type="button"
                            onClick={() => setForm(p => ({...p, cancellationPolicy: pol}))}
                            className={`flex-1 py-2 text-xs font-bold capitalize rounded-lg transition-all ${
                              form.cancellationPolicy === pol ? 'bg-white shadow-sm text-slate-900 border border-slate-200' : 'text-slate-500 hover:text-slate-700'
                            }`}
                          >
                            {pol}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-6">
                    <div className="flex items-center justify-between">
                      <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500">Listing Status</label>
                      <button
                        type="button"
                        onClick={() => setForm((p) => ({ ...p, available: !p.available }))}
                        className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all border ${
                          form.available ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-50 text-slate-500 border-slate-200'
                        }`}
                      >
                        {form.available ? 'Active' : 'Hidden'}
                      </button>
                    </div>

                    <div className="space-y-4">
                      <p className="block text-[10px] font-black uppercase tracking-widest text-slate-500">Availability Schedule</p>
                      <div className="bg-slate-50 border border-slate-200 p-5 rounded-2xl space-y-4">
                        <div>
                          <p className="text-xs font-bold text-slate-700 mb-2">Operating Days</p>
                          <div className="flex gap-1">
                            {['S','M','T','W','T','F','S'].map((label, i) => {
                              const selected = form.days.has(i);
                              return (
                                <button
                                  key={i}
                                  type="button"
                                  onClick={() =>
                                    setForm((p) => {
                                      const days = new Set(p.days);
                                      if (days.has(i)) days.delete(i);
                                      else days.add(i);
                                      if (days.size === 0) days.add(1);
                                      return { ...p, days };
                                    })
                                  }
                                  className={`w-8 h-8 rounded-full text-[10px] font-black transition-all ${
                                    selected ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-200 border border-slate-200'
                                  }`}
                                >
                                  {label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        <div className="flex items-center gap-4 pt-2">
                          <div className="flex-1">
                            <label className="text-[10px] font-bold text-slate-500 uppercase">From</label>
                            <input
                              type="time"
                              value={form.hoursStart}
                              onChange={(e) => setForm((p) => ({ ...p, hoursStart: e.target.value }))}
                              className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 mt-1"
                            />
                          </div>
                          <div className="flex-1">
                            <label className="text-[10px] font-bold text-slate-500 uppercase">To</label>
                            <input
                              type="time"
                              value={form.hoursEnd}
                              onChange={(e) => setForm((p) => ({ ...p, hoursEnd: e.target.value }))}
                              className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 mt-1"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 5: Target Audience */}
            {createStep === 5 && (
              <div className="space-y-10 animate-in fade-in">
                <div className="mb-6">
                  <h3 className="text-xl font-bold text-slate-900 mb-2">Who can book your clinic?</h3>
                  <p className="text-slate-500 text-sm">Select the professions and specialties allowed to rent this space. If you don't select any, anyone can book.</p>
                </div>

                <div className="space-y-8">
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-4">Allowed Categories</label>
                    <div className="flex flex-wrap gap-3">
                      {CATEGORIES.map(cat => {
                        const isSelected = form.allowedCategories.has(cat.id);
                        return (
                          <button
                            key={cat.id}
                            type="button"
                            onClick={() => {
                              setForm(p => {
                                const newCats = new Set(p.allowedCategories);
                                if (newCats.has(cat.id)) {
                                  newCats.delete(cat.id);
                                  // Clear specialties for this category
                                  const newSpecs = new Set(p.allowedSpecialties);
                                  (SPECIALTIES[cat.id] || []).forEach(s => newSpecs.delete(s.id));
                                  return { ...p, allowedCategories: newCats, allowedSpecialties: newSpecs };
                                } else {
                                  newCats.add(cat.id);
                                  return { ...p, allowedCategories: newCats };
                                }
                              });
                            }}
                            className={`px-5 py-3 rounded-2xl border text-sm font-bold transition-all ${
                              isSelected ? 'bg-slate-900 border-slate-900 text-white shadow-md' : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                            }`}
                          >
                            {cat.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {Array.from(form.allowedCategories).filter(c => SPECIALTIES[c]).map(catId => {
                    const categoryLabel = CATEGORIES.find(c => c.id === catId)?.label;
                    return (
                      <div key={catId} className="bg-slate-50 border border-slate-200 p-6 rounded-3xl animate-in fade-in">
                        <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-4">{categoryLabel} Specialties</label>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setForm(p => {
                                const newSpecs = new Set(p.allowedSpecialties);
                                const allCategorySpecs = SPECIALTIES[catId].map(s => s.id);
                                const hasAll = allCategorySpecs.every(s => newSpecs.has(s));
                                
                                if (hasAll) {
                                  allCategorySpecs.forEach(s => newSpecs.delete(s));
                                } else {
                                  allCategorySpecs.forEach(s => newSpecs.add(s));
                                }
                                return { ...p, allowedSpecialties: newSpecs };
                              });
                            }}
                            className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:bg-slate-100 transition-colors"
                          >
                            Select All / None
                          </button>
                          
                          {SPECIALTIES[catId].map(spec => {
                            const isSelected = form.allowedSpecialties.has(spec.id);
                            return (
                              <button
                                key={spec.id}
                                type="button"
                                onClick={() => {
                                  setForm(p => {
                                    const newSpecs = new Set(p.allowedSpecialties);
                                    if (newSpecs.has(spec.id)) newSpecs.delete(spec.id);
                                    else newSpecs.add(spec.id);
                                    return { ...p, allowedSpecialties: newSpecs };
                                  });
                                }}
                                className={`px-4 py-2 rounded-xl border text-xs font-bold transition-all ${
                                  isSelected ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                                }`}
                              >
                                {spec.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="mt-12 flex items-center justify-between border-t border-slate-100 pt-6">
              <button
                type="button"
                onClick={() => {
                  if (createStep > 1) setCreateStep(p => p - 1);
                  else {
                    setForm(emptyForm);
                    setCurrentView('rooms');
                  }
                }}
                className="px-8 py-4 rounded-2xl border border-slate-200 text-slate-600 font-black uppercase text-[11px] tracking-widest hover:bg-slate-50 transition-colors"
              >
                {createStep > 1 ? 'Back' : 'Cancel'}
              </button>
              
              <button
                type="submit"
                disabled={submitting}
                className="px-10 py-4 rounded-2xl bg-slate-900 text-white font-black uppercase text-[11px] tracking-widest hover:bg-black transition-colors shadow-lg disabled:opacity-50"
              >
                {submitting ? 'Saving...' : createStep < 5 ? 'Next' : (editingRoom ? 'Save Changes' : 'Publish Listing')}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* MY LISTINGS TAB */}
      {currentView === 'rooms' && (
        <section className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search your listings…"
              className="w-full sm:w-72 bg-white border border-slate-200 rounded-2xl px-5 py-3.5 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-900 shadow-sm transition-all"
            />
          </div>

          {loading && <div className="p-10 text-center text-slate-500 font-bold">Loading your properties...</div>}
          
          {!loading && filteredRooms.length === 0 && (
            <div className="bg-white border border-slate-200 rounded-[2.5rem] p-16 shadow-sm text-center">
               <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-6">
                 <span className="material-symbols-outlined text-slate-300 text-4xl">add_home</span>
               </div>
              <h3 className="text-2xl font-black text-slate-900 tracking-tight">No listings found</h3>
              <p className="text-slate-500 text-sm mt-2 max-w-sm mx-auto">You don't have any properties matching your search, or you haven't created one yet.</p>
              <button
                onClick={() => setCurrentView('create')}
                className="mt-8 px-8 py-4 rounded-2xl bg-slate-900 text-white font-black uppercase text-[11px] tracking-widest hover:bg-black shadow-lg"
              >
                Create new listing
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredRooms.map((r) => (
              <div key={r.id} className="bg-white border border-slate-200 rounded-[2rem] shadow-sm overflow-hidden group hover:shadow-xl transition-all duration-300">
                <div className="h-56 bg-slate-100 relative overflow-hidden">
                  {r.photos?.[0] ? (
                    <img src={r.photos[0]} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-300">
                      <span className="material-symbols-outlined text-5xl">image</span>
                    </div>
                  )}
                  
                  {/* Overlay Badges */}
                  <div className="absolute top-4 left-4 flex gap-2">
                    <div className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest shadow-sm backdrop-blur-md ${
                      r.available ? 'bg-white/90 text-slate-900' : 'bg-slate-900/90 text-white'
                    }`}>
                      {r.available ? 'Active' : 'Hidden'}
                    </div>
                    {r.instantBook && (
                      <div className="px-3 py-1.5 rounded-full bg-emerald-500/90 text-white text-[10px] font-black uppercase tracking-widest shadow-sm backdrop-blur-md flex items-center gap-1">
                        <span className="material-symbols-outlined text-[12px]">bolt</span>
                        Instant
                      </div>
                    )}
                  </div>
                </div>
                
                <div className="p-6">
                  <div className="flex justify-between items-start gap-4 mb-3">
                    <h4 className="text-lg font-black text-slate-900 leading-tight line-clamp-1">{r.name}</h4>
                    <p className="text-lg font-black text-slate-900 shrink-0">${r.hourlyRate}<span className="text-xs text-slate-500 font-normal">/hr</span></p>
                  </div>
                  
                  <p className="text-slate-500 text-xs flex items-center gap-1.5 mb-4">
                    <span className="material-symbols-outlined text-[14px]">location_on</span>
                    {r.city}
                  </p>
                  
                  <div className="flex items-center gap-3 text-xs font-bold text-slate-600 mb-4 border-y border-slate-100 py-3">
                    {r.sizeSqft && <span>{r.sizeSqft} sqft</span>}
                    {r.sizeSqft && r.capacity && <span className="text-slate-300">•</span>}
                    {r.capacity && <span>Up to {r.capacity} ppl</span>}
                  </div>
                  
                  {r.allowedCategories && r.allowedCategories.length > 0 && (
                    <div className="mb-6 flex flex-wrap gap-1.5">
                      {r.allowedCategories.map(cat => (
                        <span key={cat} className="px-2 py-1 bg-slate-100 text-slate-600 rounded-md text-[9px] font-black uppercase tracking-widest">
                          {cat}
                        </span>
                      ))}
                      {r.allowedSpecialties && r.allowedSpecialties.length > 0 && (
                        <span className="px-2 py-1 bg-blue-50 text-blue-600 rounded-md text-[9px] font-black uppercase tracking-widest">
                          +{r.allowedSpecialties.length} specs
                        </span>
                      )}
                    </div>
                  )}

                  <div className="flex gap-3">
                    <button
                      onClick={() => handleEditRoom(r)}
                      className="flex-1 py-3 rounded-xl bg-slate-100 text-slate-900 font-black uppercase text-[10px] tracking-widest hover:bg-slate-200 transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => removeRoom(r.id)}
                      className="px-4 py-3 rounded-xl border border-red-100 text-red-600 hover:bg-red-50 transition-colors"
                    >
                      <span className="material-symbols-outlined text-[18px] block">delete</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* BOOKINGS TAB */}
      {currentView === 'bookings' && (
        <section className="bg-white border border-slate-200 rounded-[2.5rem] p-8 md:p-10 shadow-sm animate-in fade-in slide-in-from-bottom-4">
           <h2 className="text-2xl font-black text-slate-900 tracking-tight mb-8">Booking History</h2>
           
           {bookings.length === 0 ? (
             <div className="text-center py-20">
               <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-6">
                 <span className="material-symbols-outlined text-slate-300 text-4xl">event_busy</span>
               </div>
               <h3 className="text-xl font-black text-slate-900">No bookings yet</h3>
               <p className="text-slate-500 mt-2">When professionals book your spaces, they will appear here.</p>
             </div>
           ) : (
             <div className="overflow-x-auto">
               <table className="w-full text-left border-collapse min-w-[800px]">
                 <thead>
                   <tr className="border-b border-slate-200">
                     <th className="pb-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Date & Time</th>
                     <th className="pb-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Room</th>
                     <th className="pb-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Tenant</th>
                     <th className="pb-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Message / Price</th>
                     <th className="pb-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Status</th>
                     <th className="pb-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Actions</th>
                   </tr>
                 </thead>
                 <tbody className="divide-y divide-slate-100">
                   {bookings.map(b => (
                     <tr key={b.id} className="hover:bg-slate-50 transition-colors group">
                       <td className="py-5">
                         <p className="font-bold text-slate-900">{b.date || new Date(b.createdAt).toLocaleDateString()}</p>
                         {b.startTime && <p className="text-xs text-slate-500 mt-1">{b.startTime} - {b.endTime}</p>}
                       </td>
                       <td className="py-5 font-medium text-slate-700">{b.roomName}</td>
                       <td className="py-5 font-medium text-slate-700">{b.doctorName}</td>
                       <td className="py-5 max-w-[200px] truncate">
                         {b.totalPrice ? <span className="font-black text-slate-900">${b.totalPrice}</span> : <span className="text-xs text-slate-500 truncate">{b.note || 'No message'}</span>}
                       </td>
                       <td className="py-5">
                          <span className={`text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg ${
                           b.status === 'confirmed' ? 'bg-emerald-100 text-emerald-700' :
                           b.status === 'pending' ? 'bg-amber-100 text-amber-700' :
                           b.status === 'completed' ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'
                         }`}>
                           {b.status}
                         </span>
                       </td>
                       <td className="py-5">
                         {b.status === 'pending' && (
                           <div className="flex gap-2">
                             <button
                               onClick={async () => {
                                 try {
                                   await updateDoc(doc(db, 'room_requests', b.id), { status: 'confirmed' });
                                 } catch (e) { alert('Failed to confirm'); }
                               }}
                               className="px-3 py-1.5 bg-slate-900 text-white text-[9px] font-black uppercase tracking-widest rounded-lg hover:bg-black transition-colors"
                             >
                               Approve
                             </button>
                             <button
                               onClick={async () => {
                                 try {
                                   await updateDoc(doc(db, 'room_requests', b.id), { status: 'cancelled' });
                                 } catch (e) { alert('Failed to decline'); }
                               }}
                               className="px-3 py-1.5 bg-slate-100 text-slate-600 text-[9px] font-black uppercase tracking-widest rounded-lg hover:bg-slate-200 transition-colors"
                             >
                               Decline
                             </button>
                           </div>
                         )}
                       </td>
                     </tr>
                   ))}
                 </tbody>
               </table>
             </div>
           )}
        </section>
      )}

      {/* Success Popup */}
      {showPublishSuccess && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-6 z-50 animate-in fade-in">
          <div className="bg-white rounded-[3rem] p-12 max-w-md w-full border border-slate-200 text-center space-y-6 shadow-2xl animate-in zoom-in-95">
            <div className="w-24 h-24 bg-emerald-50 rounded-full flex items-center justify-center mx-auto text-emerald-500">
              <span className="material-symbols-outlined text-5xl">verified</span>
            </div>
            <div>
              <h2 className="text-3xl font-black text-slate-900 tracking-tight mb-2">Listing Published!</h2>
              <p className="text-slate-500 text-sm">
                <strong className="text-slate-800">{publishedName}</strong> is now live and can be booked by professionals.
              </p>
            </div>
            <button
              onClick={() => { setShowPublishSuccess(false); setCurrentView('rooms'); }}
              className="w-full py-4 rounded-2xl bg-slate-900 text-white font-black uppercase text-[11px] tracking-widest hover:bg-black transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default LandlordDashboard;
