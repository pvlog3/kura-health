import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import type { UserProfile, WorkingHours, RoomDoc, Amenity, RoomBooking, Chat, ChatMessage } from '../types';

type LandlordView = 'overview' | 'create' | 'rooms' | 'bookings' | 'finances' | 'messages';

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
  dailyRate: '',
  notes: '',
  available: true,
  amenities: new Set<Amenity>(),
  hoursStart: '08:00',
  hoursEnd: '18:00',
  days: new Set<number>([1, 2, 3, 4, 5]),
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

const SPECIALTIES: Record<string, { id: string; label: string }[]> = {
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
  // ── Room / booking state ──
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
  const [calendarDate, setCalendarDate] = useState<Date>(() => new Date());
  const [selectedCalendarDay, setSelectedCalendarDay] = useState<string | null>(null);

  // ── Chat state ──
  const [chats, setChats] = useState<Chat[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // ── Subscriptions ──
  useEffect(() => {
    const qRooms = query(collection(db, 'rooms'), where('ownerId', '==', profile.uid));
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

    const qBookings = query(collection(db, 'room_requests'), where('roomOwnerId', '==', profile.uid));
    const unsubBookings = onSnapshot(
      qBookings,
      (snap) => {
        const b = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<RoomBooking, 'id'>) }))
          .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
        setBookings(b);
        setError(null);
      },
      (e) => {
        console.error('Bookings snap error:', e);
        setError(
          e.code === 'permission-denied'
            ? "You don't have permission to read requests."
            : `Failed to load requests: ${e.message}`
        );
      }
    );

    const qChats = query(collection(db, 'chats'), where('landlordId', '==', profile.uid));
    const unsubChats = onSnapshot(qChats, (snap) => {
      const c = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<Chat, 'id'>) }))
        .sort((a, b) => (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt));
      setChats(c);
    });

    return () => { unsubRooms(); unsubBookings(); unsubChats(); };
  }, [profile.uid]);

  // Subscribe to messages for the open chat
  useEffect(() => {
    if (!selectedChatId) {
      setChatMessages([]);
      return;
    }
    const q = query(collection(db, 'chat_messages'), where('chatId', '==', selectedChatId));
    const unsub = onSnapshot(q, (snap) => {
      const msgs = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<ChatMessage, 'id'>) }))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      setChatMessages(msgs);
    });
    return () => unsub();
  }, [selectedChatId]);

  // Mark chat as read when landlord opens it
  useEffect(() => {
    if (!selectedChatId) return;
    const chat = chats.find((c) => c.id === selectedChatId);
    if (chat && (chat.unreadByLandlord ?? 0) > 0) {
      updateDoc(doc(db, 'chats', selectedChatId), { unreadByLandlord: 0 }).catch(console.error);
    }
  }, [selectedChatId, chats]);

  // Auto-scroll messages to bottom
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // ── Derived ──
  const filteredRooms = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return myRooms;
    return myRooms.filter((r) => `${r.name} ${r.city} ${r.address}`.toLowerCase().includes(q));
  }, [myRooms, search]);

  const activeRoomsCount = myRooms.filter((r) => r.available).length;
  const totalEarningsMock = bookings
    .filter((b) => b.status === 'completed')
    .reduce((acc, curr) => acc + (curr.totalPrice || 0), 0);
  const upcomingBookingsCount = bookings.filter((b) => b.status === 'confirmed').length;
  const pendingRequestsCount = bookings.filter((b) => b.status === 'pending').length;
  const unreadChatsCount = chats.filter((c) => (c.unreadByLandlord ?? 0) > 0).length;

  const bookingsByDay = useMemo(() => {
    const map: Record<string, RoomBooking[]> = {};
    bookings.forEach((b) => {
      const key = b.date ?? new Date(b.createdAt).toLocaleDateString('en-CA');
      if (!map[key]) map[key] = [];
      map[key].push(b);
    });
    return map;
  }, [bookings]);

  const financesData = useMemo(() => {
    const completed = bookings.filter((b) => b.status === 'completed');
    const confirmed = bookings.filter((b) => b.status === 'confirmed');
    const cancelled = bookings.filter((b) => b.status === 'cancelled');
    const totalEarned = completed.reduce((s, b) => s + (b.totalPrice ?? 0), 0);
    const pendingPayout = confirmed.reduce((s, b) => s + (b.totalPrice ?? 0), 0);
    const cancelledValue = cancelled.reduce((s, b) => s + (b.totalPrice ?? 0), 0);

    const byRoom: Record<string, number> = {};
    completed.forEach((b) => {
      byRoom[b.roomName] = (byRoom[b.roomName] ?? 0) + (b.totalPrice ?? 0);
    });
    const maxRoom = Math.max(1, ...Object.values(byRoom));
    const roomEarnings = Object.entries(byRoom)
      .sort(([, a], [, b]) => b - a)
      .map(([name, total]) => ({ name, total, pct: Math.round((total / maxRoom) * 100) }));

    const monthlyMap: Record<string, number> = {};
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      monthlyMap[`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`] = 0;
    }
    completed.forEach((b) => {
      const key = (b.date ?? new Date(b.createdAt).toLocaleDateString('en-CA')).slice(0, 7);
      if (key in monthlyMap) monthlyMap[key] += b.totalPrice ?? 0;
    });
    const maxMonthly = Math.max(1, ...Object.values(monthlyMap));
    const monthlyEarnings = Object.entries(monthlyMap).map(([month, total]) => ({
      month,
      total,
      label: new Date(month + '-02').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      pct: Math.round((total / maxMonthly) * 100),
    }));

    return { totalEarned, pendingPayout, cancelledValue, totalBookings: bookings.length, roomEarnings, monthlyEarnings };
  }, [bookings]);

  // Calendar grid
  const calYear = calendarDate.getFullYear();
  const calMonth = calendarDate.getMonth();
  const calMonthLabel = calendarDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const calFirstDow = new Date(calYear, calMonth, 1).getDay();
  const calDaysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const calCells: (number | null)[] = [
    ...Array(calFirstDow).fill(null),
    ...Array.from({ length: calDaysInMonth }, (_, i) => i + 1),
  ];
  while (calCells.length % 7 !== 0) calCells.push(null);
  const calTodayKey = new Date().toLocaleDateString('en-CA');

  const displayedBookings = [...bookings]
    .filter(
      (b) =>
        !selectedCalendarDay ||
        (b.date ?? new Date(b.createdAt).toLocaleDateString('en-CA')) === selectedCalendarDay
    )
    .sort((a, b) => new Date(a.date || a.createdAt).getTime() - new Date(b.date || b.createdAt).getTime());

  // ── Handlers ──
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
      setPhotoPreviews((prev) => {
        const next = [...prev];
        next[index] = base64;
        return next;
      });
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
      dailyRate: String(r.dailyRate),
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
      setCreateStep((prev) => prev + 1);
      return;
    }

    const daily = Number(String(form.dailyRate).trim());
    if (!Number.isFinite(daily) || daily <= 0) {
      alert('Please enter a valid daily rate.');
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
        dailyRate: daily,
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

  const handleStartChat = async (booking: RoomBooking) => {
    const existing = chats.find(
      (c) => c.doctorId === booking.doctorId && c.roomId === booking.roomId
    );
    if (existing) {
      setSelectedChatId(existing.id);
      setCurrentView('messages');
      return;
    }
    try {
      const chatRef = await addDoc(collection(db, 'chats'), {
        participants: [profile.uid, booking.doctorId],
        roomId: booking.roomId,
        roomName: booking.roomName,
        landlordId: profile.uid,
        landlordName: profile.name,
        doctorId: booking.doctorId,
        doctorName: booking.doctorName,
        lastMessage: '',
        lastMessageAt: new Date().toISOString(),
        unreadByLandlord: 0,
        unreadByDoctor: 0,
        bookingId: booking.id,
        createdAt: new Date().toISOString(),
      });
      setSelectedChatId(chatRef.id);
      setCurrentView('messages');
    } catch (err) {
      console.error('Create chat error:', err);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = chatInput.trim();
    if (!text || !selectedChatId || sendingMessage) return;
    setSendingMessage(true);
    setChatInput('');
    try {
      const now = new Date().toISOString();
      const currentChat = chats.find((c) => c.id === selectedChatId);
      await addDoc(collection(db, 'chat_messages'), {
        chatId: selectedChatId,
        senderId: profile.uid,
        senderName: profile.name,
        text,
        createdAt: now,
      });
      await updateDoc(doc(db, 'chats', selectedChatId), {
        lastMessage: text,
        lastMessageAt: now,
        unreadByDoctor: (currentChat?.unreadByDoctor ?? 0) + 1,
      });
    } catch (err) {
      console.error('Send message error:', err);
    } finally {
      setSendingMessage(false);
    }
  };

  const navItems = [
    { view: 'overview' as LandlordView, label: 'Overview', icon: 'grid_view', badge: 0 },
    { view: 'bookings' as LandlordView, label: 'Bookings', icon: 'event_available', badge: pendingRequestsCount },
    { view: 'rooms' as LandlordView, label: 'My Listings', icon: 'apartment', badge: 0 },
    { view: 'finances' as LandlordView, label: 'Finances', icon: 'payments', badge: 0 },
    { view: 'messages' as LandlordView, label: 'Messages', icon: 'chat', badge: unreadChatsCount },
    { view: 'create' as LandlordView, label: editingRoom ? 'Edit Listing' : 'New Listing', icon: 'add_circle', badge: 0 },
  ];

  const handleNavClick = (view: LandlordView) => {
    setCurrentView(view);
    if (view !== 'create') {
      setEditingRoom(null);
      setForm(emptyForm);
      setPhotoPreviews([null, null, null]);
      setCreateStep(1);
    }
    if (view !== 'messages') {
      setSelectedChatId(null);
    }
  };

  return (
    <div className="flex -mx-4 sm:-mx-6 lg:-mx-8 -mt-8 min-h-[calc(100vh-80px)]">

      {/* ── SIDEBAR (desktop) ── */}
      <aside className="hidden md:flex flex-col w-[220px] shrink-0 bg-white border-r border-slate-200 sticky top-20 h-[calc(100vh-80px)] overflow-y-auto">
        <div className="px-5 py-6 border-b border-slate-100">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Host Dashboard</p>
          <h1 className="text-xl font-black text-slate-900 tracking-tight mt-0.5">Kura Spaces</h1>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map((item) => {
            const isActive = currentView === item.view;
            const isCreate = item.view === 'create';
            return (
              <button
                key={item.view}
                onClick={() => handleNavClick(item.view)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold transition-all text-left ${
                  isActive
                    ? 'bg-slate-900 text-white'
                    : isCreate
                    ? 'text-blue-600 hover:bg-blue-50'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <span
                  className={`material-symbols-outlined text-[20px] ${
                    isActive ? 'text-white' : isCreate ? 'text-blue-500' : 'text-slate-400'
                  }`}
                >
                  {item.icon}
                </span>
                <span className="flex-1">{item.label}</span>
                {item.badge > 0 && (
                  <span className="flex items-center justify-center min-w-[20px] h-5 px-1 text-[10px] bg-red-500 text-white rounded-full font-black animate-bounce">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="px-5 py-4 border-t border-slate-100">
          <p className="text-sm font-bold text-slate-900 truncate">{profile.name}</p>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mt-0.5">Host</p>
        </div>
      </aside>

      {/* ── CONTENT COLUMN ── */}
      <div className="flex-1 min-w-0 flex flex-col">

        {/* Mobile top bar */}
        <div className="md:hidden bg-white border-b border-slate-200 px-4 py-3 sticky top-0 z-30">
          <h1 className="text-lg font-black text-slate-900 tracking-tight">Host Dashboard</h1>
        </div>

        {/* Mobile scrollable nav */}
        <nav className="md:hidden flex items-center gap-1.5 overflow-x-auto px-3 py-2 bg-white border-b border-slate-200 hide-scrollbar">
          {navItems.map((item) => {
            const isActive = currentView === item.view;
            return (
              <button
                key={item.view}
                onClick={() => handleNavClick(item.view)}
                className={`flex items-center gap-1.5 whitespace-nowrap px-4 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all ${
                  isActive ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
                }`}
              >
                <span className="material-symbols-outlined text-[15px]">{item.icon}</span>
                {item.label}
                {item.badge > 0 && (
                  <span className="w-4 h-4 text-[9px] bg-red-500 text-white rounded-full flex items-center justify-center font-black">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* ── PAGE CONTENT ── */}
        <main className="flex-1 p-6 md:p-8 pb-24 space-y-8 bg-slate-50">

          {error && (
            <div className="bg-red-50 border-l-4 border-red-500 p-6 rounded-2xl flex items-center gap-4 shadow-sm animate-in fade-in">
              <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center text-red-600 shrink-0">
                <span className="material-symbols-outlined">error</span>
              </div>
              <div>
                <h3 className="text-lg font-black text-red-900">Database Access Error</h3>
                <p className="text-red-700 text-sm font-medium">{error}</p>
              </div>
            </div>
          )}

          {/* ── OVERVIEW ── */}
          {currentView === 'overview' && (
            <section className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
              {pendingRequestsCount > 0 && (
                <div className="bg-amber-50 border-l-4 border-amber-500 p-6 rounded-2xl flex items-center justify-between shadow-sm animate-in fade-in">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center text-amber-600">
                      <span className="material-symbols-outlined">notification_important</span>
                    </div>
                    <div>
                      <h3 className="text-lg font-black text-amber-900">
                        You have {pendingRequestsCount} pending request{pendingRequestsCount > 1 ? 's' : ''}!
                      </h3>
                      <p className="text-amber-700 text-sm font-medium">A doctor is waiting for your approval to rent your space.</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setCurrentView('bookings')}
                    className="px-6 py-3 bg-amber-500 text-white font-black uppercase text-[11px] tracking-widest rounded-xl hover:bg-amber-600 transition-colors shadow-sm"
                  >
                    Review Requests
                  </button>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white border border-slate-200 rounded-[2rem] p-8 shadow-sm relative overflow-hidden group">
                  <div className="absolute top-0 right-0 p-8 text-slate-100 group-hover:scale-110 group-hover:-rotate-12 transition-transform duration-500">
                    <span className="material-symbols-outlined text-8xl">apartment</span>
                  </div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 relative z-10">Total Listings</p>
                  <h2 className="text-5xl font-black text-slate-900 mt-2 relative z-10">{myRooms.length}</h2>
                  <p className="text-sm text-slate-500 font-medium mt-2 relative z-10">{activeRoomsCount} currently active</p>
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
                    {bookings.slice(0, 5).map((b) => (
                      <div key={b.id} className="flex items-center justify-between p-4 rounded-2xl border border-slate-100 hover:bg-slate-50 transition-colors">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center text-blue-600">
                            <span className="material-symbols-outlined">event_available</span>
                          </div>
                          <div>
                            <p className="font-bold text-slate-900">
                              {b.doctorName} <span className="font-medium text-slate-500">requested</span> {b.roomName}
                            </p>
                            <p className="text-xs text-slate-500 mt-1">
                              {b.date || new Date(b.createdAt).toLocaleDateString()}
                              {b.startTime ? ` • ${b.startTime} - ${b.endTime}` : ''}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          {b.totalPrice ? (
                            <p className="font-black text-slate-900">${b.totalPrice}</p>
                          ) : (
                            <p className="font-bold text-slate-400 text-xs uppercase">Requested</p>
                          )}
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

          {/* ── CREATE LISTING WIZARD ── */}
          {currentView === 'create' && (
            <section className="bg-white border border-slate-200 rounded-[2.5rem] p-8 md:p-12 shadow-sm animate-in fade-in slide-in-from-bottom-4">
              <div className="flex items-center justify-between mb-10">
                <div>
                  <h2 className="text-2xl font-black text-slate-900 tracking-tight">{editingRoom ? 'Edit listing' : 'Create a listing'}</h2>
                  <p className="text-slate-500 text-sm mt-1">Step {createStep} of 5</p>
                </div>
                <div className="w-1/3 h-2 bg-slate-100 rounded-full overflow-hidden flex">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <div key={s} className={`flex-1 h-full ${s <= createStep ? 'bg-slate-900' : ''} border-r border-white/20 last:border-0 transition-all duration-500`} />
                  ))}
                </div>
              </div>

              <form onSubmit={submitForm}>
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

                {createStep === 4 && (
                  <div className="space-y-10 animate-in fade-in">
                    <h3 className="text-xl font-bold text-slate-900 mb-6">Set your price and policies</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div className="space-y-8">
                        <div>
                          <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Daily Rate ($)</label>
                          <input
                            value={form.dailyRate}
                            onChange={(e) => setForm((p) => ({ ...p, dailyRate: e.target.value }))}
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
                              <input type="checkbox" className="sr-only peer" checked={form.instantBook} onChange={(e) => setForm((p) => ({ ...p, instantBook: e.target.checked }))} />
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
                                onClick={() => setForm((p) => ({ ...p, cancellationPolicy: pol }))}
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
                                {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((label, i) => {
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
                          {CATEGORIES.map((cat) => {
                            const isSelected = form.allowedCategories.has(cat.id);
                            return (
                              <button
                                key={cat.id}
                                type="button"
                                onClick={() => {
                                  setForm((p) => {
                                    const newCats = new Set(p.allowedCategories);
                                    if (newCats.has(cat.id)) {
                                      newCats.delete(cat.id);
                                      const newSpecs = new Set(p.allowedSpecialties);
                                      (SPECIALTIES[cat.id] || []).forEach((s) => newSpecs.delete(s.id));
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
                      {Array.from(form.allowedCategories)
                        .filter((c) => SPECIALTIES[c])
                        .map((catId) => {
                          const categoryLabel = CATEGORIES.find((c) => c.id === catId)?.label;
                          return (
                            <div key={catId} className="bg-slate-50 border border-slate-200 p-6 rounded-3xl animate-in fade-in">
                              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-4">{categoryLabel} Specialties</label>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setForm((p) => {
                                      const newSpecs = new Set(p.allowedSpecialties);
                                      const allCategorySpecs = SPECIALTIES[catId].map((s) => s.id);
                                      const hasAll = allCategorySpecs.every((s) => newSpecs.has(s));
                                      if (hasAll) allCategorySpecs.forEach((s) => newSpecs.delete(s));
                                      else allCategorySpecs.forEach((s) => newSpecs.add(s));
                                      return { ...p, allowedSpecialties: newSpecs };
                                    });
                                  }}
                                  className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:bg-slate-100 transition-colors"
                                >
                                  Select All / None
                                </button>
                                {SPECIALTIES[catId].map((spec) => {
                                  const isSelected = form.allowedSpecialties.has(spec.id);
                                  return (
                                    <button
                                      key={spec.id}
                                      type="button"
                                      onClick={() => {
                                        setForm((p) => {
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
                      if (createStep > 1) setCreateStep((p) => p - 1);
                      else { setForm(emptyForm); setCurrentView('rooms'); }
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
                    {submitting ? 'Saving...' : createStep < 5 ? 'Next' : editingRoom ? 'Save Changes' : 'Publish Listing'}
                  </button>
                </div>
              </form>
            </section>
          )}

          {/* ── MY LISTINGS ── */}
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
                        <p className="text-lg font-black text-slate-900 shrink-0">${r.dailyRate}<span className="text-xs text-slate-500 font-normal">/day</span></p>
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
                          {r.allowedCategories.map((cat) => (
                            <span key={cat} className="px-2 py-1 bg-slate-100 text-slate-600 rounded-md text-[9px] font-black uppercase tracking-widest">{cat}</span>
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

          {/* ── BOOKINGS + CALENDAR ── */}
          {currentView === 'bookings' && (
            <section className="bg-white border border-slate-200 rounded-[2.5rem] p-8 md:p-10 shadow-sm animate-in fade-in slide-in-from-bottom-4">
              <h2 className="text-2xl font-black text-slate-900 tracking-tight mb-8">Booking Calendar</h2>

              {/* Calendar widget */}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 mb-6">
                <div className="flex items-center justify-between mb-4">
                  <button
                    onClick={() => { setCalendarDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1)); setSelectedCalendarDay(null); }}
                    className="w-9 h-9 rounded-full bg-white border border-slate-200 flex items-center justify-center hover:bg-slate-100 transition-colors"
                  >
                    <span className="material-symbols-outlined text-[18px]">chevron_left</span>
                  </button>
                  <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">{calMonthLabel}</h3>
                  <button
                    onClick={() => { setCalendarDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1)); setSelectedCalendarDay(null); }}
                    className="w-9 h-9 rounded-full bg-white border border-slate-200 flex items-center justify-center hover:bg-slate-100 transition-colors"
                  >
                    <span className="material-symbols-outlined text-[18px]">chevron_right</span>
                  </button>
                </div>

                <div className="grid grid-cols-7 mb-1">
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                    <div key={d} className="text-center text-[10px] font-black uppercase tracking-widest text-slate-400 py-1">{d}</div>
                  ))}
                </div>

                <div className="grid grid-cols-7 gap-1">
                  {calCells.map((day, idx) => {
                    if (day === null) return <div key={`blank-${idx}`} />;
                    const key = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    const dayBookings = bookingsByDay[key] ?? [];
                    const isSelected = selectedCalendarDay === key;
                    const isToday = key === calTodayKey;
                    const statusSet = new Set(dayBookings.map((b) => b.status));
                    return (
                      <button
                        key={key}
                        onClick={() => setSelectedCalendarDay((prev) => (prev === key ? null : key))}
                        className={`relative flex flex-col items-center justify-start pt-1.5 pb-1 rounded-xl min-h-[44px] transition-all text-sm font-bold ${
                          isSelected
                            ? 'bg-slate-900 text-white'
                            : isToday
                            ? 'bg-blue-50 text-blue-700 border border-blue-200'
                            : dayBookings.length > 0
                            ? 'bg-white hover:bg-slate-100 text-slate-900 border border-slate-200'
                            : 'hover:bg-slate-100 text-slate-500'
                        }`}
                      >
                        {day}
                        {dayBookings.length > 0 && (
                          <div className="flex gap-0.5 mt-0.5 flex-wrap justify-center">
                            {statusSet.has('pending') && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />}
                            {statusSet.has('confirmed') && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />}
                            {statusSet.has('completed') && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />}
                            {statusSet.has('cancelled') && <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>

                {selectedCalendarDay && (
                  <p className="text-center text-xs text-slate-500 mt-3 font-medium">
                    Showing bookings for <strong>{selectedCalendarDay}</strong> —{' '}
                    <button onClick={() => setSelectedCalendarDay(null)} className="text-blue-600 font-bold hover:underline">Clear filter</button>
                  </p>
                )}
              </div>

              {/* Legend */}
              <div className="flex flex-wrap gap-4 mb-6">
                {[
                  { color: 'bg-amber-400', label: 'Pending' },
                  { color: 'bg-emerald-500', label: 'Confirmed' },
                  { color: 'bg-blue-500', label: 'Completed' },
                  { color: 'bg-red-400', label: 'Cancelled' },
                ].map((item) => (
                  <div key={item.label} className="flex items-center gap-1.5">
                    <span className={`w-2.5 h-2.5 rounded-full ${item.color}`} />
                    <span className="text-xs font-bold text-slate-500">{item.label}</span>
                  </div>
                ))}
              </div>

              {displayedBookings.length === 0 ? (
                <div className="text-center py-16">
                  <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-6">
                    <span className="material-symbols-outlined text-slate-300 text-4xl">event_busy</span>
                  </div>
                  <h3 className="text-xl font-black text-slate-900">
                    {selectedCalendarDay ? 'No bookings on this date' : 'No bookings yet'}
                  </h3>
                  <p className="text-slate-500 mt-2 text-sm">
                    {selectedCalendarDay ? 'Select a different day or clear the filter.' : 'When professionals book your spaces, they will appear here.'}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse min-w-[860px]">
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
                      {displayedBookings.map((b) => (
                        <tr key={b.id} className="hover:bg-slate-50 transition-colors">
                          <td className="py-5">
                            <p className="font-bold text-slate-900">{b.date || new Date(b.createdAt).toLocaleDateString()}</p>
                            {b.startTime && <p className="text-xs text-slate-500 mt-1">{b.startTime} - {b.endTime}</p>}
                          </td>
                          <td className="py-5 font-medium text-slate-700">{b.roomName}</td>
                          <td className="py-5">
                            <div className="flex items-center gap-2.5">
                              <div className="w-8 h-8 rounded-xl bg-slate-100 overflow-hidden border border-slate-200 shrink-0">
                                <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${b.doctorName}`} alt="" className="w-full h-full object-cover" />
                              </div>
                              <span className="font-medium text-slate-700">{b.doctorName}</span>
                            </div>
                          </td>
                          <td className="py-5 max-w-[180px] truncate">
                            {b.totalPrice ? (
                              <span className="font-black text-slate-900">${b.totalPrice}</span>
                            ) : (
                              <span className="text-xs text-slate-500 truncate">{b.note || 'No message'}</span>
                            )}
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
                            <div className="flex gap-2 flex-wrap">
                              {b.status === 'pending' && (
                                <>
                                  <button
                                    onClick={async () => {
                                      try { await updateDoc(doc(db, 'room_requests', b.id), { status: 'confirmed' }); }
                                      catch { alert('Failed to confirm'); }
                                    }}
                                    className="px-3 py-1.5 bg-slate-900 text-white text-[9px] font-black uppercase tracking-widest rounded-lg hover:bg-black transition-colors"
                                  >
                                    Approve
                                  </button>
                                  <button
                                    onClick={async () => {
                                      try { await updateDoc(doc(db, 'room_requests', b.id), { status: 'cancelled' }); }
                                      catch { alert('Failed to decline'); }
                                    }}
                                    className="px-3 py-1.5 bg-slate-100 text-slate-600 text-[9px] font-black uppercase tracking-widest rounded-lg hover:bg-slate-200 transition-colors"
                                  >
                                    Decline
                                  </button>
                                </>
                              )}
                              <button
                                onClick={() => handleStartChat(b)}
                                className="px-3 py-1.5 bg-blue-50 text-blue-700 text-[9px] font-black uppercase tracking-widest rounded-lg hover:bg-blue-100 transition-colors flex items-center gap-1 border border-blue-100"
                              >
                                <span className="material-symbols-outlined text-[12px]">chat</span>
                                Chat
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {/* ── FINANCES ── */}
          {currentView === 'finances' && (
            <section className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white border border-slate-200 rounded-[2rem] p-6 shadow-sm relative overflow-hidden group">
                  <div className="absolute top-0 right-0 p-5 text-emerald-50 group-hover:scale-110 transition-transform duration-500">
                    <span className="material-symbols-outlined text-6xl">trending_up</span>
                  </div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-emerald-600 relative z-10">Total Earned</p>
                  <h2 className="text-4xl font-black text-slate-900 mt-2 relative z-10">${financesData.totalEarned}</h2>
                  <p className="text-xs text-slate-500 font-medium mt-1 relative z-10">From completed bookings</p>
                </div>
                <div className="bg-white border border-slate-200 rounded-[2rem] p-6 shadow-sm relative overflow-hidden group">
                  <div className="absolute top-0 right-0 p-5 text-amber-50 group-hover:scale-110 transition-transform duration-500">
                    <span className="material-symbols-outlined text-6xl">schedule</span>
                  </div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-amber-600 relative z-10">Pending Payout</p>
                  <h2 className="text-4xl font-black text-slate-900 mt-2 relative z-10">${financesData.pendingPayout}</h2>
                  <p className="text-xs text-slate-500 font-medium mt-1 relative z-10">Confirmed, not yet complete</p>
                </div>
                <div className="bg-white border border-slate-200 rounded-[2rem] p-6 shadow-sm relative overflow-hidden group">
                  <div className="absolute top-0 right-0 p-5 text-red-50 group-hover:scale-110 transition-transform duration-500">
                    <span className="material-symbols-outlined text-6xl">cancel</span>
                  </div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-red-500 relative z-10">Cancelled Value</p>
                  <h2 className="text-4xl font-black text-slate-900 mt-2 relative z-10">${financesData.cancelledValue}</h2>
                  <p className="text-xs text-slate-500 font-medium mt-1 relative z-10">Lost revenue</p>
                </div>
                <div className="bg-slate-900 border border-slate-800 rounded-[2rem] p-6 shadow-lg relative overflow-hidden group">
                  <div className="absolute top-0 right-0 p-5 text-slate-800 group-hover:scale-110 transition-transform duration-500">
                    <span className="material-symbols-outlined text-6xl">receipt_long</span>
                  </div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 relative z-10">Total Bookings</p>
                  <h2 className="text-4xl font-black text-white mt-2 relative z-10">{financesData.totalBookings}</h2>
                  <p className="text-xs text-slate-400 font-medium mt-1 relative z-10">All time</p>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-[2.5rem] p-8 shadow-sm">
                <h3 className="text-xl font-black text-slate-900 tracking-tight mb-6">Monthly Earnings</h3>
                {financesData.monthlyEarnings.every((m) => m.total === 0) ? (
                  <div className="text-center py-12">
                    <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
                      <span className="material-symbols-outlined text-slate-300 text-3xl">bar_chart</span>
                    </div>
                    <p className="text-slate-400 text-sm font-medium">No completed bookings with prices recorded yet.</p>
                  </div>
                ) : (
                  <div className="flex items-end gap-2 sm:gap-3 h-44">
                    {financesData.monthlyEarnings.map((m) => (
                      <div key={m.month} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                        <p className="text-[10px] font-black text-slate-700 text-center leading-tight">{m.total > 0 ? `$${m.total}` : ''}</p>
                        <div
                          className="w-full rounded-t-lg bg-slate-900 transition-all duration-700"
                          style={{ height: `${Math.max(m.pct, m.total > 0 ? 4 : 0)}%` }}
                        />
                        <p className="text-[10px] font-bold text-slate-500 uppercase text-center">{m.label}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {financesData.roomEarnings.length > 0 ? (
                <div className="bg-white border border-slate-200 rounded-[2.5rem] p-8 shadow-sm">
                  <h3 className="text-xl font-black text-slate-900 tracking-tight mb-6">Earnings by Room</h3>
                  <div className="space-y-5">
                    {financesData.roomEarnings.map((r) => (
                      <div key={r.name} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-bold text-slate-700 truncate max-w-[60%]">{r.name}</p>
                          <p className="text-sm font-black text-slate-900">${r.total}</p>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
                          <div className="h-3 rounded-full bg-slate-900 transition-all duration-700" style={{ width: `${r.pct}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="bg-white border border-slate-200 rounded-[2.5rem] p-8 shadow-sm text-center">
                  <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
                    <span className="material-symbols-outlined text-slate-300 text-3xl">analytics</span>
                  </div>
                  <p className="text-slate-400 text-sm font-medium">Per-room earnings will appear once bookings are completed.</p>
                </div>
              )}
            </section>
          )}

          {/* ── MESSAGES ── */}
          {currentView === 'messages' && (
            <section className="animate-in fade-in slide-in-from-bottom-4">
              <div className="flex gap-5 h-[calc(100vh-220px)] min-h-[500px]">

                {/* Conversation list */}
                <div className={`${selectedChatId ? 'hidden md:flex' : 'flex'} flex-col w-full md:w-80 shrink-0 bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm`}>
                  <div className="p-5 border-b border-slate-100">
                    <h2 className="text-lg font-black text-slate-900 tracking-tight">Messages</h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {chats.length} conversation{chats.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
                    {chats.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                        <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4">
                          <span className="material-symbols-outlined text-slate-300 text-3xl">chat</span>
                        </div>
                        <p className="text-slate-600 text-sm font-bold">No conversations yet.</p>
                        <p className="text-slate-400 text-xs mt-1">Use the Chat button in Bookings to start one.</p>
                      </div>
                    ) : (
                      chats.map((chat) => {
                        const isActive = selectedChatId === chat.id;
                        const hasUnread = (chat.unreadByLandlord ?? 0) > 0;
                        return (
                          <button
                            key={chat.id}
                            onClick={() => setSelectedChatId(chat.id)}
                            className={`w-full flex items-center gap-3.5 p-4 text-left transition-colors ${isActive ? 'bg-slate-50' : 'hover:bg-slate-50'}`}
                          >
                            <div className="w-11 h-11 rounded-2xl bg-slate-100 overflow-hidden shrink-0 border border-slate-200">
                              <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${chat.doctorName}`} alt="" className="w-full h-full object-cover" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-baseline justify-between gap-1">
                                <p className={`text-sm truncate ${hasUnread ? 'font-black text-slate-900' : 'font-bold text-slate-800'}`}>
                                  {chat.doctorName}
                                </p>
                                {chat.lastMessageAt && (
                                  <p className="text-[10px] text-slate-400 shrink-0">
                                    {new Date(chat.lastMessageAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                                  </p>
                                )}
                              </div>
                              <p className="text-[10px] text-slate-400 truncate font-semibold uppercase tracking-wide">{chat.roomName}</p>
                              {chat.lastMessage && (
                                <p className={`text-xs truncate mt-0.5 ${hasUnread ? 'text-slate-700 font-medium' : 'text-slate-400'}`}>
                                  {chat.lastMessage}
                                </p>
                              )}
                            </div>
                            {hasUnread && (
                              <span className="w-5 h-5 rounded-full bg-blue-500 text-white text-[9px] font-black flex items-center justify-center shrink-0">
                                {chat.unreadByLandlord}
                              </span>
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Chat thread / empty placeholder */}
                {selectedChatId ? (() => {
                  const chat = chats.find((c) => c.id === selectedChatId);
                  if (!chat) return null;
                  return (
                    <div className="flex-1 flex flex-col bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm min-w-0">
                      {/* Thread header */}
                      <div className="p-4 border-b border-slate-100 flex items-center gap-3.5">
                        <button
                          onClick={() => setSelectedChatId(null)}
                          className="md:hidden w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center text-slate-600 shrink-0"
                        >
                          <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                        </button>
                        <div className="w-10 h-10 rounded-xl bg-slate-100 overflow-hidden border border-slate-200 shrink-0">
                          <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${chat.doctorName}`} alt="" className="w-full h-full object-cover" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-black text-slate-900 text-sm leading-tight truncate">{chat.doctorName}</p>
                          <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold truncate">{chat.roomName}</p>
                        </div>
                        <button
                          onClick={() => setCurrentView('bookings')}
                          className="px-3 py-1.5 bg-slate-100 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-600 hover:bg-slate-200 transition-colors flex items-center gap-1.5 shrink-0"
                        >
                          <span className="material-symbols-outlined text-[14px]">event_available</span>
                          <span className="hidden sm:inline">Booking</span>
                        </button>
                      </div>

                      {/* Messages */}
                      <div className="flex-1 overflow-y-auto p-5 space-y-4">
                        {chatMessages.length === 0 ? (
                          <div className="flex flex-col items-center justify-center h-full text-center py-12">
                            <div className="w-14 h-14 bg-slate-50 rounded-full flex items-center justify-center mb-3 border border-slate-200">
                              <span className="material-symbols-outlined text-slate-300 text-2xl">chat_bubble</span>
                            </div>
                            <p className="text-slate-600 text-sm font-bold">Start the conversation</p>
                            <p className="text-slate-400 text-xs mt-1">Send a message to {chat.doctorName}.</p>
                          </div>
                        ) : (
                          chatMessages.map((msg) => {
                            const isOwn = msg.senderId === profile.uid;
                            return (
                              <div key={msg.id} className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
                                {!isOwn && (
                                  <div className="w-8 h-8 rounded-xl bg-slate-100 overflow-hidden border border-slate-200 mr-2.5 shrink-0 self-end mb-5">
                                    <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${chat.doctorName}`} alt="" className="w-full h-full object-cover" />
                                  </div>
                                )}
                                <div className={`max-w-[72%] flex flex-col gap-1 ${isOwn ? 'items-end' : 'items-start'}`}>
                                  <div className={`px-4 py-3 rounded-2xl text-sm leading-relaxed ${isOwn ? 'bg-slate-900 text-white rounded-br-md' : 'bg-slate-100 text-slate-800 rounded-bl-md'}`}>
                                    {msg.text}
                                  </div>
                                  <p className="text-[10px] text-slate-400 px-1">
                                    {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  </p>
                                </div>
                              </div>
                            );
                          })
                        )}
                        <div ref={chatBottomRef} />
                      </div>

                      {/* Input */}
                      <div className="p-4 border-t border-slate-100">
                        <form onSubmit={handleSendMessage} className="flex gap-3">
                          <input
                            type="text"
                            value={chatInput}
                            onChange={(e) => setChatInput(e.target.value)}
                            placeholder={`Message ${chat.doctorName}…`}
                            disabled={sendingMessage}
                            className="flex-1 bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-900 transition-all placeholder-slate-400 disabled:opacity-60"
                          />
                          <button
                            type="submit"
                            disabled={sendingMessage || !chatInput.trim()}
                            className="w-12 h-12 rounded-2xl bg-slate-900 text-white flex items-center justify-center hover:bg-black transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-sm shrink-0"
                          >
                            <span className="material-symbols-outlined text-[20px]">send</span>
                          </button>
                        </form>
                      </div>
                    </div>
                  );
                })() : (
                  <div className="flex-1 hidden md:flex flex-col items-center justify-center bg-white border border-slate-200 rounded-3xl shadow-sm text-center p-10">
                    <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-5 border border-slate-100">
                      <span className="material-symbols-outlined text-slate-300 text-4xl">chat</span>
                    </div>
                    <h3 className="text-xl font-black text-slate-900 tracking-tight">Select a conversation</h3>
                    <p className="text-slate-500 text-sm mt-2 max-w-xs leading-relaxed">
                      Choose a chat from the list, or open the Bookings tab and click Chat on any request.
                    </p>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* ── SUCCESS MODAL ── */}
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

        </main>
      </div>
    </div>
  );
};

export default LandlordDashboard;
