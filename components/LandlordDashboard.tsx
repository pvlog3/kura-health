import React, { useEffect, useMemo, useState } from 'react';
import { db } from '../firebase';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import type { UserProfile, WorkingHours } from '../types';

type Amenity =
  | 'wifi'
  | 'reception'
  | 'parking'
  | 'wheelchair'
  | 'ac'
  | 'restroom'
  | 'waiting_area'
  | 'equipment';

interface RoomDoc {
  id: string;
  ownerId: string;
  ownerName: string;
  name: string;
  address: string;
  city: string;
  hourlyRate: number;
  photos: string[];
  amenities: Amenity[];
  notes: string | null;
  available: boolean;
  createdAt: string;
  availability?: WorkingHours;
}

type LandlordView = 'create' | 'rooms';

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
};

const LandlordDashboard: React.FC<{ profile: UserProfile }> = ({ profile }) => {
  const [myRooms, setMyRooms] = useState<RoomDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState(emptyForm);
  const [photoFiles, setPhotoFiles] = useState<(File | null)[]>([null, null, null]);
  const [photoPreviews, setPhotoPreviews] = useState<(string | null)[]>([null, null, null]);
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState('');
  const [currentView, setCurrentView] = useState<LandlordView>('create');
  const [showPublishSuccess, setShowPublishSuccess] = useState(false);
  const [publishedName, setPublishedName] = useState<string>('');

  useEffect(() => {
    const q = query(
      collection(db, 'rooms'),
      where('ownerId', '==', profile.uid)
    );

    const unsub = onSnapshot(
      q,
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

    return () => unsub();
  }, [profile.uid]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return myRooms;
    return myRooms.filter((r) => `${r.name} ${r.city} ${r.address}`.toLowerCase().includes(q));
  }, [myRooms, search]);

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
      setPhotoFiles(prev => { const next = [...prev]; next[index] = file; return next; });
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

  const createRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

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
      // Use compressed base64 previews directly — no Firebase Storage needed
      const photos = photoPreviews.filter((p): p is string => p !== null);
      await addDoc(collection(db, 'rooms'), {
        ownerId: profile.uid,
        ownerName: profile.name,
        name: listingName,
        address: form.address.trim(),
        city: form.city.trim(),
        hourlyRate: hourly,
        photos,
        amenities: Array.from(form.amenities),
        notes: form.notes.trim() ? form.notes.trim() : null,
        available: form.available,
        createdAt: new Date().toISOString(),
        availability,
      });

      setForm(emptyForm);
      setPhotoFiles([null, null, null]);
      setPhotoPreviews([null, null, null]);
      setPublishedName(listingName);
      setShowPublishSuccess(true);
      setCurrentView('rooms');
    } catch (e) {
      console.error('Create room error:', e);
      alert('Failed to publish listing. Check Firestore rules and try again.');
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
    <div className="space-y-10 pb-24">
      <header className="bg-white border border-slate-200 rounded-[2.5rem] p-10 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-8">
          <div className="space-y-3">
            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-500">Host</p>
            <h1 className="text-4xl font-black text-slate-900 tracking-tighter">Offer your space</h1>
            <p className="text-slate-500 text-sm font-medium max-w-2xl">
              Publish rooms clinics can rent for appointments. Add photos, amenities, and a fair hourly rate—like an Airbnb host flow.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-1 flex">
              <button
                type="button"
                onClick={() => setCurrentView('create')}
                className={`px-5 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                  currentView === 'create' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-white'
                }`}
              >
                Create listing
              </button>
              <button
                type="button"
                onClick={() => setCurrentView('rooms')}
                className={`px-5 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                  currentView === 'rooms' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-white'
                }`}
              >
                My rooms
              </button>
            </div>

            {currentView === 'rooms' && (
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search your listings…"
                className="w-72 max-w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              />
            )}
          </div>
        </div>
      </header>

      {/* Create listing */}
      {currentView === 'create' && (
      <section className="bg-white border border-slate-200 rounded-[2.5rem] p-10 shadow-sm">
        <div className="flex items-center justify-between gap-6 flex-wrap">
          <div>
            <h2 className="text-xl font-black text-slate-900 tracking-tight">Create a new listing</h2>
            <p className="text-slate-500 text-sm mt-1">Tell professionals what makes your space great for consultations.</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Status</span>
              <button
                type="button"
                onClick={() => setForm((p) => ({ ...p, available: !p.available }))}
                className={`px-5 py-2.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all border ${
                  form.available ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-50 text-slate-600 border-slate-200'
                }`}
              >
                {form.available ? 'Available' : 'Hidden'}
              </button>
            </div>
            <p className="text-[11px] text-slate-500">
              Configure bookable hours below – doctors will prefer rooms that match their schedule.
            </p>
          </div>
        </div>

        <form onSubmit={createRoom} className="mt-10 grid grid-cols-1 lg:grid-cols-2 gap-10">
          <div className="space-y-6">
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Listing title</label>
              <input
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="e.g. Bright private room near downtown"
                required
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">City</label>
                <input
                  value={form.city}
                  onChange={(e) => setForm((p) => ({ ...p, city: e.target.value }))}
                  placeholder="City"
                  required
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Hourly rate</label>
                <input
                  value={form.hourlyRate}
                  onChange={(e) => setForm((p) => ({ ...p, hourlyRate: e.target.value }))}
                  inputMode="numeric"
                  placeholder="e.g. 35"
                  required
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                />
              </div>
            </div>

            <div className="space-y-4">
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Address</label>
              <input
                value={form.address}
                onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))}
                placeholder="Street address"
                required
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              />
            </div>

            <div className="space-y-3">
              <p className="block text-[10px] font-black uppercase tracking-widest text-slate-500">Room hours (bookable)</p>
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-500 font-semibold uppercase tracking-widest">Days</span>
                  <div className="flex gap-1 bg-slate-50 border border-slate-200 rounded-2xl px-2 py-1">
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
                          className={`w-7 h-7 rounded-xl text-[10px] font-black ${
                            selected ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-200'
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-500 font-semibold uppercase tracking-widest">From</span>
                  <input
                    type="time"
                    value={form.hoursStart}
                    onChange={(e) => setForm((p) => ({ ...p, hoursStart: e.target.value }))}
                    className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                  />
                  <span className="text-[11px] text-slate-500 font-semibold uppercase tracking-widest">To</span>
                  <input
                    type="time"
                    value={form.hoursEnd}
                    onChange={(e) => setForm((p) => ({ ...p, hoursEnd: e.target.value }))}
                    className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Notes (optional)</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                placeholder="Parking instructions, check-in process, equipment available, etc."
                className="w-full h-28 bg-slate-50 border border-slate-200 rounded-[1.5rem] px-5 py-4 text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              />
            </div>
          </div>

          <div className="space-y-8">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3">Photos</p>
              <div className="grid grid-cols-3 gap-3">
                {[0, 1, 2].map((i) => (
                  <label
                    key={i}
                    className="relative h-32 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 hover:bg-slate-100 hover:border-blue-300 cursor-pointer transition-all overflow-hidden flex flex-col items-center justify-center gap-2"
                  >
                    {photoPreviews[i] ? (
                      <img src={photoPreviews[i]!} alt={`Photo ${i + 1}`} className="absolute inset-0 w-full h-full object-cover rounded-2xl" />
                    ) : (
                      <>
                        <span className="material-symbols-outlined text-slate-300" style={{ fontSize: '28px' }}>add_photo_alternate</span>
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Photo {i + 1}</span>
                      </>
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => handlePhotoFile(e, i)}
                    />
                  </label>
                ))}
              </div>
              <p className="text-slate-400 text-xs mt-3">Click a box to upload a photo from your device.</p>
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
                        selected ? 'bg-blue-50 border-blue-200' : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-slate-700 text-lg">{a.icon}</span>
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-700">{a.label}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex gap-4">
              <button
                type="button"
                onClick={() => { setForm(emptyForm); setPhotoFiles([null, null, null]); setPhotoPreviews([null, null, null]); }}
                className="flex-1 py-4 rounded-2xl border border-slate-200 text-slate-600 font-black uppercase text-[10px] tracking-widest hover:bg-slate-50 transition-colors"
              >
                Reset
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 py-4 rounded-2xl bg-slate-900 text-white font-black uppercase text-[10px] tracking-widest hover:bg-black transition-colors shadow-xl disabled:opacity-50"
              >
                {submitting ? 'Publishing…' : 'Publish listing'}
              </button>
            </div>
          </div>
        </form>
      </section>
      )}

      {/* My listings */}
      {currentView === 'rooms' && (
      <section className="space-y-4">
        <div className="flex items-end justify-between gap-6 flex-wrap">
          <div>
            <h2 className="text-xl font-black text-slate-900 tracking-tight">Your listings</h2>
            <p className="text-slate-500 text-sm mt-1">Manage what professionals can see.</p>
          </div>
        </div>

        {loading && (
          <div className="bg-white border border-slate-200 rounded-[2.5rem] p-10 shadow-sm text-center">
            <p className="text-slate-500 text-sm font-bold">Loading your rooms…</p>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-[2.5rem] p-8">
            <p className="text-red-700 text-sm font-bold">{error}</p>
            <p className="text-red-600 text-xs mt-2">
              You need Firestore rules allowing landlords to read/write their own docs in <span className="font-black">rooms</span>.
            </p>
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="bg-white border border-slate-200 rounded-[2.5rem] p-12 shadow-sm text-center">
            <h3 className="text-slate-900 text-xl font-black tracking-tight">No listings yet</h3>
            <p className="text-slate-500 text-sm mt-2">Publish your first room to start receiving requests.</p>
          </div>
        )}

        {!loading && !error && filtered.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {filtered.map((r) => (
              <div key={r.id} className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden">
                <div className="h-44 bg-slate-100 relative">
                  {r.photos?.[0] ? (
                    <img src={r.photos[0]} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-400">
                      <span className="material-symbols-outlined text-4xl">apartment</span>
                    </div>
                  )}
                  <div className="absolute top-4 left-4 bg-white/90 backdrop-blur-md border border-slate-200 px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest text-slate-700">
                    {r.available ? 'Available' : 'Hidden'}
                  </div>
                  <div className="absolute top-4 right-4 bg-slate-900 text-white px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest shadow-lg">
                    ${r.hourlyRate}/hr
                  </div>
                </div>
                <div className="p-8 space-y-4">
                  <div>
                    <h4 className="text-slate-900 text-xl font-black tracking-tight leading-tight">{r.name}</h4>
                    <p className="text-slate-500 text-xs font-bold uppercase tracking-widest mt-2">{r.city}</p>
                    <p className="text-slate-600 text-sm mt-2">{r.address}</p>
                    {r.availability && (
                      <p className="text-slate-500 text-xs mt-3 flex items-center gap-2">
                        <span className="material-symbols-outlined text-[16px] text-slate-400">schedule</span>
                        <span className="font-medium">
                          {r.availability.days
                            .slice()
                            .sort()
                            .map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d])
                            .join(' · ')}{' '}
                          • {r.availability.start}–{r.availability.end}
                        </span>
                      </p>
                    )}
                  </div>
                  <div className="flex gap-3 pt-2">
                    <button
                      onClick={() => removeRoom(r.id)}
                      className="flex-1 py-4 rounded-2xl bg-red-600 text-white font-black uppercase text-[10px] tracking-widest hover:bg-red-500 transition-colors shadow-lg"
                    >
                      Delete
                    </button>
                    <a
                      href="#"
                      onClick={(e) => e.preventDefault()}
                      className="flex-1 py-4 rounded-2xl bg-slate-100 text-slate-700 font-black uppercase text-[10px] tracking-widest text-center"
                      title="Edit can be added next"
                    >
                      Edit (next)
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      )}

      {/* Publish Confirmation Popup */}
      {showPublishSuccess && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center p-6 z-[950] animate-in fade-in">
          <div className="bg-white rounded-[3rem] p-12 max-w-md w-full border border-slate-200 text-center space-y-8 shadow-2xl animate-in zoom-in-95">
            <div className="w-24 h-24 bg-emerald-50 rounded-full flex items-center justify-center mx-auto text-emerald-700 border border-emerald-200">
              <span className="material-symbols-outlined text-4xl">verified</span>
            </div>
            <div className="space-y-2">
              <h2 className="text-3xl font-black text-slate-900 tracking-tighter">Listing published</h2>
              <p className="text-slate-500 text-sm">
                {publishedName ? (
                  <>
                    <span className="font-black text-slate-700">{publishedName}</span> is now visible to professionals.
                  </>
                ) : (
                  'Your room is now visible to professionals.'
                )}
              </p>
            </div>
            <div className="flex gap-4">
              <button
                onClick={() => { setShowPublishSuccess(false); setCurrentView('create'); }}
                className="flex-1 py-4 rounded-2xl border border-slate-200 text-slate-600 font-black uppercase text-[10px] tracking-widest hover:bg-slate-50 transition-colors"
              >
                Create another
              </button>
              <button
                onClick={() => { setShowPublishSuccess(false); setCurrentView('rooms'); }}
                className="flex-1 py-4 rounded-2xl bg-slate-900 text-white font-black uppercase text-[10px] tracking-widest hover:bg-black transition-colors shadow-xl"
              >
                View my rooms
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LandlordDashboard;

