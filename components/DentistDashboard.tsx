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
} from 'firebase/firestore';
import type {
  UserProfile,
  Appointment,
  WorkingHours,
  Education,
  ToothCondition,
  ToothChart,
  TreatmentProcedure,
  TreatmentPlan,
  DentalNote,
} from '../types';

interface DentistDashboardProps {
  profile: UserProfile;
}

type DentistView = 'overview' | 'patients' | 'schedule' | 'profile';

const DEFAULT_HOURS: WorkingHours = { start: '08:00', end: '19:00', days: [1, 2, 3, 4, 5] };

const FDI_UPPER: number[][] = [
  [18, 17, 16, 15, 14, 13, 12, 11],
  [21, 22, 23, 24, 25, 26, 27, 28],
];
const FDI_LOWER: number[][] = [
  [48, 47, 46, 45, 44, 43, 42, 41],
  [31, 32, 33, 34, 35, 36, 37, 38],
];

const TOOTH_STATUS_CONFIG: Record<ToothCondition['status'], { color: string; label: string }> = {
  healthy:      { color: '#4ade80', label: 'Healthy' },
  cavity:       { color: '#ef4444', label: 'Cavity' },
  filled:       { color: '#3b82f6', label: 'Filled' },
  crown:        { color: '#eab308', label: 'Crown' },
  missing:      { color: '#6b7280', label: 'Missing' },
  'root-canal': { color: '#f97316', label: 'Root Canal' },
  implant:      { color: '#a855f7', label: 'Implant' },
};

const DENTAL_PROCEDURES = [
  'Cleaning / Prophylaxis', 'Composite Filling', 'Amalgam Filling', 'Root Canal Treatment',
  'Crown Placement', 'Tooth Extraction', 'Implant Placement', 'Bridge', 'Veneer',
  'Teeth Whitening', 'Orthodontic Consultation', 'Gum Scaling', 'Bone Graft',
  'Night Guard', 'Partial Denture', 'Complete Denture', 'Fluoride Treatment', 'Sealant',
];

function parseTeeth(raw: Record<string, ToothCondition>): Record<number, ToothCondition> {
  return Object.entries(raw).reduce((acc, [k, v]) => ({ ...acc, [Number(k)]: v }), {} as Record<number, ToothCondition>);
}

const DentistDashboard: React.FC<DentistDashboardProps> = ({ profile }) => {
  // Core data
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [toothCharts, setToothCharts] = useState<ToothChart[]>([]);
  const [treatmentPlans, setTreatmentPlans] = useState<TreatmentPlan[]>([]);
  const [dentalNotes, setDentalNotes] = useState<DentalNote[]>([]);
  const [loading, setLoading] = useState(true);

  // Navigation
  const [currentView, setCurrentView] = useState<DentistView>('overview');

  // Patient panel
  const [selectedPatient, setSelectedPatient] = useState<{
    patientId: string; patientName: string; visitDate?: string;
  } | null>(null);
  const [patientPanelTab, setPatientPanelTab] = useState<'chart' | 'plan' | 'notes'>('chart');

  // Tooth chart editing
  const [editingChart, setEditingChart] = useState<Record<number, ToothCondition>>({});
  const [selectedTooth, setSelectedTooth] = useState<number | null>(null);
  const [toothStatusDraft, setToothStatusDraft] = useState<ToothCondition['status']>('healthy');
  const [toothNoteDraft, setToothNoteDraft] = useState('');
  const [savingChart, setSavingChart] = useState(false);

  // Treatment plan
  const [editingPlan, setEditingPlan] = useState<TreatmentProcedure[]>([]);
  const [newProc, setNewProc] = useState<Omit<TreatmentProcedure, 'id'>>({
    procedure: '', material: '', cost: 0, status: 'pending', tooth: undefined, notes: '',
  });
  const [savingPlan, setSavingPlan] = useState(false);

  // Dental note form
  const [noteForm, setNoteForm] = useState({
    visitDate: '', chiefComplaint: '', diagnosis: '', treatment: '', materials: '', nextVisit: '',
  });
  const [savingNote, setSavingNote] = useState(false);

  // Wrap-up modal
  const [wrapUpId, setWrapUpId] = useState<string | null>(null);
  const [wrapUpComment, setWrapUpComment] = useState('');
  const [wrapUpDiagnosis, setWrapUpDiagnosis] = useState('');
  const [wrapUpTreatment, setWrapUpTreatment] = useState('');
  const [submittingWrapUp, setSubmittingWrapUp] = useState(false);

  // Schedule
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [calendarViewDate, setCalendarViewDate] = useState(new Date());

  // Patients view
  const [patientSearch, setPatientSearch] = useState('');

  // Profile edit
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editData, setEditData] = useState<Partial<UserProfile>>({});
  const [saving, setSaving] = useState(false);
  const profileInputRef = useRef<HTMLInputElement>(null);
  const backgroundInputRef = useRef<HTMLInputElement>(null);

  // Always-current refs to avoid stale closures in the seeding useEffect
  const toothChartsRef = useRef<ToothChart[]>([]);
  const treatmentPlansRef = useRef<TreatmentPlan[]>([]);

  // Save success feedback
  const [saveSuccess, setSaveSuccess] = useState<'chart' | 'plan' | 'note' | null>(null);

  // ── Firestore listeners ──────────────────────────────────────────────────
  useEffect(() => {
    const q1 = query(collection(db, 'appointments'), where('doctorId', '==', profile.uid));
    const unsub1 = onSnapshot(q1, snap => {
      const apps = snap.docs.map(d => ({ id: d.id, ...d.data() } as Appointment));
      apps.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      setAppointments(apps);
      setLoading(false);
    }, () => setLoading(false));

    const q2 = query(collection(db, 'tooth_charts'), where('doctorId', '==', profile.uid));
    const unsub2 = onSnapshot(q2, snap =>
      setToothCharts(snap.docs.map(d => ({ id: d.id, ...d.data() } as ToothChart)))
    );

    const q3 = query(collection(db, 'treatment_plans'), where('doctorId', '==', profile.uid));
    const unsub3 = onSnapshot(q3, snap =>
      setTreatmentPlans(snap.docs.map(d => ({ id: d.id, ...d.data() } as TreatmentPlan)))
    );

    const q4 = query(collection(db, 'dental_notes'), where('doctorId', '==', profile.uid));
    const unsub4 = onSnapshot(q4, snap => {
      const notes = snap.docs.map(d => ({ id: d.id, ...d.data() } as DentalNote));
      notes.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setDentalNotes(notes);
    });

    return () => { unsub1(); unsub2(); unsub3(); unsub4(); };
  }, [profile.uid]);

  // Keep refs in sync so the seeding effect always sees the latest Firestore data
  useEffect(() => { toothChartsRef.current = toothCharts; }, [toothCharts]);
  useEffect(() => { treatmentPlansRef.current = treatmentPlans; }, [treatmentPlans]);

  // ── Seed patient panel state when patient selected ───────────────────────
  // Reads from refs (not state) so the effect always sees the latest data,
  // even if toothCharts/treatmentPlans updated after the effect was scheduled.
  useEffect(() => {
    if (!selectedPatient) return;
    setPatientPanelTab('chart');
    setSelectedTooth(null);
    setSaveSuccess(null);
    const chart = toothChartsRef.current.find(c => c.patientId === selectedPatient.patientId);
    setEditingChart(chart ? parseTeeth(chart.teeth as unknown as Record<string, ToothCondition>) : {});
    const plan = treatmentPlansRef.current.find(p => p.patientId === selectedPatient.patientId && p.status === 'active');
    setEditingPlan(plan?.procedures ?? []);
    setNoteForm({
      visitDate: selectedPatient.visitDate?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
      chiefComplaint: '', diagnosis: '', treatment: '', materials: '', nextVisit: '',
    });
  }, [selectedPatient]);

  // ── Calendar helpers ─────────────────────────────────────────────────────
  const weekDates = useMemo(() => {
    const start = new Date(selectedDate);
    const day = start.getDay();
    start.setDate(start.getDate() - day + (day === 0 ? -6 : 1));
    return Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  }, [selectedDate]);

  const monthDays = useMemo(() => {
    const year = calendarViewDate.getFullYear();
    const month = calendarViewDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const days: (Date | null)[] = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) days.push(new Date(year, month, i));
    return days;
  }, [calendarViewDate]);

  const timeSlots = useMemo(() => {
    return Array.from({ length: (19 - 8) * 2 + 1 }, (_, i) => {
      const h = Math.floor(8 + i / 2);
      const m = i % 2 === 0 ? '00' : '30';
      return `${h.toString().padStart(2, '0')}:${m}`;
    });
  }, []);

  const changeMonth = (offset: number) =>
    setCalendarViewDate(new Date(calendarViewDate.getFullYear(), calendarViewDate.getMonth() + offset, 1));

  const changeWeek = (offset: number) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + offset * 7);
    setSelectedDate(d);
  };

  // ── Firestore write handlers ─────────────────────────────────────────────
  const handleSaveChart = async () => {
    if (!selectedPatient || savingChart) return;
    setSavingChart(true);
    try {
      const existing = toothCharts.find(c => c.patientId === selectedPatient.patientId);
      const data = {
        doctorId: profile.uid,
        patientId: selectedPatient.patientId,
        patientName: selectedPatient.patientName,
        teeth: editingChart,
        updatedAt: new Date().toISOString(),
      };
      if (existing) {
        await updateDoc(doc(db, 'tooth_charts', existing.id), data);
      } else {
        await addDoc(collection(db, 'tooth_charts'), data);
      }
      setSaveSuccess('chart');
      setTimeout(() => setSaveSuccess(null), 2500);
    } catch {
      alert('Failed to save tooth chart.');
    } finally {
      setSavingChart(false);
    }
  };

  const handleSavePlan = async () => {
    if (!selectedPatient || savingPlan) return;
    setSavingPlan(true);
    try {
      const existing = treatmentPlans.find(p => p.patientId === selectedPatient.patientId && p.status === 'active');
      const now = new Date().toISOString();
      if (existing) {
        await updateDoc(doc(db, 'treatment_plans', existing.id), { procedures: editingPlan, updatedAt: now });
      } else {
        await addDoc(collection(db, 'treatment_plans'), {
          doctorId: profile.uid,
          patientId: selectedPatient.patientId,
          patientName: selectedPatient.patientName,
          procedures: editingPlan,
          status: 'active',
          createdAt: now,
          updatedAt: now,
        });
      }
      setSaveSuccess('plan');
      setTimeout(() => setSaveSuccess(null), 2500);
    } catch {
      alert('Failed to save treatment plan.');
    } finally {
      setSavingPlan(false);
    }
  };

  const handleSaveDentalNote = async () => {
    if (!selectedPatient || savingNote) return;
    if (!noteForm.chiefComplaint.trim() || !noteForm.diagnosis.trim() || !noteForm.treatment.trim()) return;
    setSavingNote(true);
    try {
      await addDoc(collection(db, 'dental_notes'), {
        doctorId: profile.uid,
        patientId: selectedPatient.patientId,
        patientName: selectedPatient.patientName,
        visitDate: noteForm.visitDate,
        chiefComplaint: noteForm.chiefComplaint.trim(),
        diagnosis: noteForm.diagnosis.trim(),
        treatment: noteForm.treatment.trim(),
        materials: noteForm.materials.trim() || '',
        toothNumbers: [],
        nextVisit: noteForm.nextVisit.trim() || '',
        createdAt: new Date().toISOString(),
      });
      setNoteForm({ visitDate: new Date().toISOString().slice(0, 10), chiefComplaint: '', diagnosis: '', treatment: '', materials: '', nextVisit: '' });
      setSaveSuccess('note');
      setTimeout(() => setSaveSuccess(null), 2500);
    } catch {
      alert('Failed to save note.');
    } finally {
      setSavingNote(false);
    }
  };

  const handleSubmitWrapUp = async () => {
    if (!wrapUpId || submittingWrapUp) return;
    const app = appointments.find(a => a.id === wrapUpId);
    if (!app) return;
    setSubmittingWrapUp(true);
    try {
      await updateDoc(doc(db, 'appointments', wrapUpId), { status: 'done', doctorComment: wrapUpComment });
      await addDoc(collection(db, 'dental_notes'), {
        doctorId: profile.uid,
        patientId: app.patientId,
        patientName: app.patientName,
        visitDate: app.date,
        chiefComplaint: '',
        diagnosis: wrapUpDiagnosis,
        treatment: wrapUpTreatment,
        materials: '',
        toothNumbers: [],
        nextVisit: '',
        createdAt: new Date().toISOString(),
      });
      setWrapUpId(null); setWrapUpComment(''); setWrapUpDiagnosis(''); setWrapUpTreatment('');
    } catch {
      alert('Failed to finalize visit.');
    } finally {
      setSubmittingWrapUp(false);
    }
  };

  // ── Profile helpers ──────────────────────────────────────────────────────
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
      availability: profile.availability || DEFAULT_HOURS,
    });
    setIsEditingProfile(true);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, field: 'profilePicture' | 'backgroundPicture') => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 800000) { alert('Image too large. Please use an image under 800KB.'); return; }
    const reader = new FileReader();
    reader.onloadend = () => setEditData(prev => ({ ...prev, [field]: reader.result as string }));
    reader.readAsDataURL(file);
  };

  const handleSaveProfile = async () => {
    setSaving(true);
    try {
      await updateDoc(doc(db, 'users', profile.uid), editData);
      setIsEditingProfile(false);
    } catch {
      alert('Failed to update profile.');
    } finally {
      setSaving(false);
    }
  };

  // ── Derived data ─────────────────────────────────────────────────────────
  const patientList = useMemo(() => {
    const map = new Map<string, { patientId: string; patientName: string; lastVisit: string; visitCount: number; hasActivePlan: boolean; noteCount: number; markedTeeth: number }>();
    appointments.forEach(a => {
      const existing = map.get(a.patientId);
      const hasActivePlan = treatmentPlans.some(p => p.patientId === a.patientId && p.status === 'active');
      const noteCount = dentalNotes.filter(n => n.patientId === a.patientId).length;
      const chart = toothCharts.find(c => c.patientId === a.patientId);
      const markedTeeth = chart ? Object.keys(chart.teeth).length : 0;
      if (!existing || new Date(a.date) > new Date(existing.lastVisit)) {
        map.set(a.patientId, { patientId: a.patientId, patientName: a.patientName, lastVisit: a.date, visitCount: (existing?.visitCount ?? 0) + 1, hasActivePlan, noteCount, markedTeeth });
      } else {
        map.set(a.patientId, { ...existing, visitCount: existing.visitCount + 1, hasActivePlan, noteCount, markedTeeth });
      }
    });
    return Array.from(map.values()).sort((a, b) => new Date(b.lastVisit).getTime() - new Date(a.lastVisit).getTime());
  }, [appointments, treatmentPlans, dentalNotes, toothCharts]);

  // ── Tooth button render ──────────────────────────────────────────────────
  const renderTooth = (toothNum: number) => {
    const condition = editingChart[toothNum];
    const isSelected = selectedTooth === toothNum;
    const color = condition ? TOOTH_STATUS_CONFIG[condition.status].color : '#e2e8f0';
    const isMissing = condition?.status === 'missing';
    return (
      <button
        key={toothNum}
        title={`Tooth ${toothNum}${condition ? `: ${TOOTH_STATUS_CONFIG[condition.status].label}` : ''}`}
        onClick={() => { setSelectedTooth(toothNum); setToothStatusDraft(condition?.status ?? 'healthy'); setToothNoteDraft(condition?.note ?? ''); }}
        className={`relative w-8 h-8 rounded-lg flex items-center justify-center transition-all ${isSelected ? 'ring-2 ring-slate-900 ring-offset-1 scale-110 z-10' : 'hover:scale-105'} ${isMissing ? 'opacity-50' : ''}`}
        style={{ background: color }}
      >
        {isMissing
          ? <span className="text-white text-[10px] font-black">✕</span>
          : <span className="text-[9px] font-black" style={{ color: condition ? '#fff' : '#94a3b8' }}>{toothNum}</span>
        }
      </button>
    );
  };

  // ── VIEWS ────────────────────────────────────────────────────────────────

  const renderOverview = () => {
    const today = new Date();
    const todayApps = appointments.filter(a => new Date(a.date).toDateString() === today.toDateString());
    const pendingApps = appointments.filter(a => a.status === 'pending');
    const activePlans = treatmentPlans.filter(p => p.status === 'active').length;
    const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthPatients = new Set(appointments.filter(a => new Date(a.date) >= thisMonth).map(a => a.patientId)).size;
    const upcoming = appointments.filter(a => new Date(a.date) > today && a.status !== 'done').slice(0, 5);
    const recentNotes = dentalNotes.slice(0, 5);

    return (
      <div className="space-y-6 animate-in fade-in duration-500">
        {/* Stats */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {[
            { label: "Today's Patients", value: todayApps.length, icon: 'today', color: 'text-blue-500', bg: 'bg-blue-50' },
            { label: 'Pending', value: pendingApps.length, icon: 'schedule', color: 'text-yellow-500', bg: 'bg-yellow-50' },
            { label: 'Active Treatment Plans', value: activePlans, icon: 'assignment', color: 'text-purple-500', bg: 'bg-purple-50' },
            { label: 'Patients This Month', value: monthPatients, icon: 'groups', color: 'text-emerald-500', bg: 'bg-emerald-50' },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
              <div className={`w-10 h-10 rounded-xl ${s.bg} ${s.color} flex items-center justify-center mb-3`}>
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>{s.icon}</span>
              </div>
              <p className="text-3xl font-black text-slate-900">{s.value}</p>
              <p className="text-xs text-slate-400 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* Today's chair schedule */}
          <div className="xl:col-span-2 bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-black text-slate-900 text-sm">Today's Chair Schedule</h3>
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                {today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              </span>
            </div>
            {todayApps.length === 0 ? (
              <div className="py-14 text-center">
                <span className="material-symbols-outlined block text-slate-200 mb-3" style={{ fontSize: '40px' }}>event_busy</span>
                <p className="text-slate-400 text-sm font-medium">No appointments today</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-50">
                {todayApps.map(app => (
                  <div key={app.id} className="px-5 py-4 flex items-center gap-4 hover:bg-slate-50/50 transition cursor-pointer"
                    onClick={() => setSelectedPatient({ patientId: app.patientId, patientName: app.patientName, visitDate: app.date })}>
                    <div className="w-10 h-10 rounded-full bg-slate-100 overflow-hidden shrink-0">
                      <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${app.patientName}`} alt="" className="w-full h-full" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-slate-900 text-sm truncate">{app.patientName}</p>
                      <p className="text-[11px] text-slate-400 font-bold mt-0.5">
                        {new Date(app.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {app.type === 'virtual' ? 'Virtual' : 'In-Chair'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full ${
                        app.status === 'done' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                      }`}>{app.status}</span>
                      {app.status === 'pending' && (
                        <button
                          onClick={e => { e.stopPropagation(); setWrapUpId(app.id); setWrapUpComment(''); setWrapUpDiagnosis(''); setWrapUpTreatment(''); }}
                          className="px-3 py-1.5 bg-slate-900 text-white text-[9px] font-black uppercase tracking-widest rounded-xl hover:bg-black transition"
                        >
                          Complete
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right column */}
          <div className="space-y-4">
            {/* Upcoming */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100">
                <h3 className="font-black text-slate-900 text-sm">Upcoming</h3>
              </div>
              {upcoming.length === 0 ? (
                <p className="px-5 py-4 text-xs text-slate-400">No upcoming appointments.</p>
              ) : (
                <div className="divide-y divide-slate-50">
                  {upcoming.map(a => (
                    <div key={a.id} className="px-5 py-3">
                      <p className="font-bold text-slate-900 text-xs truncate">{a.patientName}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        {new Date(a.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                        {' · '}{new Date(a.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Recent notes */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100">
                <h3 className="font-black text-slate-900 text-sm">Recent Notes</h3>
              </div>
              {recentNotes.length === 0 ? (
                <p className="px-5 py-4 text-xs text-slate-400">No notes yet.</p>
              ) : (
                <div className="divide-y divide-slate-50">
                  {recentNotes.map(n => (
                    <div key={n.id} className="px-5 py-3">
                      <p className="font-bold text-slate-900 text-xs truncate">{n.patientName}</p>
                      <p className="text-[10px] text-slate-500 mt-0.5 truncate">{n.diagnosis}</p>
                      <p className="text-[10px] text-slate-300 mt-0.5">{new Date(n.createdAt).toLocaleDateString()}</p>
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

  const renderPatients = () => {
    const filtered = patientList.filter(p =>
      p.patientName.toLowerCase().includes(patientSearch.toLowerCase())
    );
    return (
      <div className="space-y-6 animate-in fade-in duration-500">
        <div className="flex items-center gap-4">
          <input
            value={patientSearch}
            onChange={e => setPatientSearch(e.target.value)}
            placeholder="Search patients…"
            className="w-72 bg-white border border-slate-200 rounded-2xl px-5 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 text-slate-900"
          />
          <p className="text-xs text-slate-400 font-bold">{filtered.length} patient{filtered.length !== 1 ? 's' : ''}</p>
        </div>
        {filtered.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-100 p-14 text-center">
            <span className="material-symbols-outlined block text-slate-200 mb-3" style={{ fontSize: '44px' }}>people</span>
            <p className="text-slate-400 text-sm font-medium">No patients found</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map(p => (
              <button
                key={p.patientId}
                onClick={() => setSelectedPatient({ patientId: p.patientId, patientName: p.patientName })}
                className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 text-left hover:shadow-md hover:-translate-y-0.5 transition-all"
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-11 h-11 rounded-full bg-slate-100 overflow-hidden shrink-0">
                    <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${p.patientName}`} alt="" className="w-full h-full" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-slate-900 text-sm truncate">{p.patientName}</p>
                    <p className="text-[10px] text-slate-400 font-bold mt-0.5">Last visit {new Date(p.lastVisit).toLocaleDateString()}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full bg-slate-100 text-slate-500">
                    {p.visitCount} visit{p.visitCount !== 1 ? 's' : ''}
                  </span>
                  {p.noteCount > 0 && (
                    <span className="text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full bg-blue-50 text-blue-600">
                      {p.noteCount} note{p.noteCount !== 1 ? 's' : ''}
                    </span>
                  )}
                  {p.markedTeeth > 0 && (
                    <span className="text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full bg-orange-50 text-orange-600">
                      {p.markedTeeth} teeth
                    </span>
                  )}
                  {p.hasActivePlan && (
                    <span className="text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full bg-[#A2F0D3]/40 text-emerald-700">
                      Active plan
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
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
              {['S','M','T','W','T','F','S'].map((d, i) => <div key={i}>{d}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {monthDays.map((date, i) => {
                const hasApp = date ? appointments.some(a => new Date(a.date).toDateString() === date.toDateString()) : false;
                return (
                  <button
                    key={i}
                    disabled={!date}
                    onClick={() => date && setSelectedDate(date)}
                    className={`h-8 w-8 flex items-center justify-center rounded-lg text-xs font-bold transition-all relative ${
                      !date ? 'invisible' :
                      date.toDateString() === selectedDate.toDateString()
                        ? 'bg-[#A2F0D3] text-black shadow-lg'
                        : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {date?.getDate()}
                    {hasApp && <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-[#A2F0D3]" />}
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 ml-1">Legend</h4>
          <div className="space-y-2">
            {[{ label: 'Virtual Visit', color: 'bg-indigo-400' }, { label: 'In-Chair Visit', color: 'bg-[#A2F0D3]' }].map(s => (
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
            const upcoming = appointments.filter(a => new Date(a.date) >= new Date() && a.status !== 'done').slice(0, 5);
            if (upcoming.length === 0) return <p className="text-xs text-slate-400 px-2">No upcoming appointments.</p>;
            return (
              <div className="space-y-2">
                {upcoming.map(a => (
                  <div key={a.id} className={`rounded-xl p-3 border ${a.type === 'virtual' ? 'bg-indigo-50 border-indigo-100' : 'bg-[#A2F0D3]/20 border-[#A2F0D3]/40'}`}>
                    <p className="text-xs font-black text-slate-900 truncate">{a.patientName}</p>
                    <p className="text-[10px] font-bold text-slate-500 mt-1">
                      {new Date(a.date).toLocaleDateString('default', { weekday: 'short', month: 'short', day: 'numeric' })} · {new Date(a.date).toLocaleTimeString('default', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                ))}
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
              {weekDates[0].toLocaleDateString('default', { day: 'numeric', month: 'short' })} – {weekDates[6].toLocaleDateString('default', { day: 'numeric', month: 'short', year: 'numeric' })}
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
                  {['SUN','MON','TUE','WED','THU','FRI','SAT'][date.getDay()]}
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
            <div className="w-16 flex-shrink-0 border-r border-slate-100 bg-white">
              {timeSlots.map(time => (
                <div key={time} className="h-20 border-b border-slate-50/50 flex items-start justify-end pr-3 pt-1">
                  <span className="text-[10px] font-black text-slate-300">{time}</span>
                </div>
              ))}
            </div>
            <div className="flex-1 grid grid-cols-7 min-h-full">
              {weekDates.map((_, dayIdx) => (
                <div key={dayIdx} className="border-r border-slate-50 relative min-h-full last:border-r-0">
                  {timeSlots.map(time => <div key={time} className="h-20 border-b border-slate-50/50" />)}
                  {appointments
                    .filter(a => new Date(a.date).toDateString() === weekDates[dayIdx].toDateString())
                    .map(app => {
                      const d = new Date(app.date);
                      const topPos = ((d.getHours() - 8) * 2 + d.getMinutes() / 30) * 80;
                      return (
                        <div
                          key={app.id}
                          style={{ top: `${topPos + 8}px`, height: '70px' }}
                          className={`absolute left-2 right-2 rounded-xl p-2 shadow-sm border border-white/20 cursor-pointer hover:scale-[1.02] hover:shadow-lg transition-all z-10 ${
                            app.type === 'virtual' ? 'bg-indigo-50 border-indigo-100' : 'bg-[#A2F0D3]/30 border-[#A2F0D3]/50'
                          }`}
                          onClick={() => {
                            if (app.status === 'pending') {
                              setWrapUpId(app.id); setWrapUpComment(''); setWrapUpDiagnosis(''); setWrapUpTreatment('');
                            } else {
                              setSelectedPatient({ patientId: app.patientId, patientName: app.patientName, visitDate: app.date });
                            }
                          }}
                        >
                          <h5 className="text-[10px] font-black text-slate-900 truncate">{app.patientName}</h5>
                          <p className="text-[9px] font-bold text-slate-500 uppercase tracking-tighter mt-0.5 truncate">
                            {d.toLocaleTimeString('default', { hour: '2-digit', minute: '2-digit' })} · {app.type}
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

  const renderProfile = () => (
    <div className="max-w-4xl mx-auto space-y-8 animate-in slide-in-from-bottom-4 duration-500 text-slate-900">
      <div className="bg-white rounded-[3.5rem] shadow-sm border border-slate-200 overflow-hidden">
        <div className="h-72 relative bg-slate-900">
          <div className="absolute inset-0 overflow-hidden">
            {(isEditingProfile ? editData.backgroundPicture : profile.backgroundPicture) ? (
              <img src={isEditingProfile ? editData.backgroundPicture : profile.backgroundPicture} className="w-full h-full object-cover opacity-80" alt="" />
            ) : (
              <div className="w-full h-full bg-gradient-to-r from-slate-900 via-teal-900 to-slate-800 opacity-60" />
            )}
            {isEditingProfile && (
              <button onClick={() => backgroundInputRef.current?.click()} className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                <span className="font-bold text-white text-sm">Change Cover</span>
              </button>
            )}
            <input type="file" ref={backgroundInputRef} className="hidden" accept="image/*" onChange={e => handleFileChange(e, 'backgroundPicture')} />
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
                  <span className="material-symbols-outlined" style={{ fontSize: '32px' }}>photo_camera</span>
                </button>
              )}
              <input type="file" ref={profileInputRef} className="hidden" accept="image/*" onChange={e => handleFileChange(e, 'profilePicture')} />
            </div>
          </div>
          {!isEditingProfile && (
            <button onClick={handleStartEdit} className="absolute bottom-6 right-10 bg-white text-slate-900 px-8 py-3 rounded-full text-[10px] font-black uppercase tracking-widest hover:scale-105 shadow-xl transition-all">
              Edit Profile
            </button>
          )}
        </div>

        <div className="pt-28 px-12 pb-12">
          {isEditingProfile ? (
            <div className="space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-2 ml-1">Full Name</label>
                  <input type="text" value={editData.name ?? ''} onChange={e => setEditData({ ...editData, name: e.target.value })} className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 text-slate-900" />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-2 ml-1">Specialty</label>
                  <input type="text" value={editData.specialty ?? ''} onChange={e => setEditData({ ...editData, specialty: e.target.value })} className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 text-slate-900" />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-2 ml-1">Location</label>
                  <input type="text" value={editData.location ?? ''} onChange={e => setEditData({ ...editData, location: e.target.value })} className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 text-slate-900" />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-2 ml-1">LinkedIn URL</label>
                  <input type="text" value={editData.linkedin ?? ''} onChange={e => setEditData({ ...editData, linkedin: e.target.value })} className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 text-slate-900" />
                </div>
              </div>
              <section className="bg-slate-50 p-8 rounded-[2.5rem] border border-slate-200 space-y-6">
                <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Academic Background</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {(['bachelor', 'master', 'phd', 'specialization'] as (keyof Education)[]).map(field => (
                    <div key={field}>
                      <label className="block text-[10px] font-black uppercase tracking-widest text-slate-600 mb-2 ml-1">{field === 'phd' ? 'PhD / Doctorate' : field === 'specialization' ? 'Specialization / Residency' : field === 'master' ? "Master's Degree" : "Bachelor's Degree"}</label>
                      <input type="text" value={(editData.education as Education)?.[field] ?? ''} onChange={e => setEditData({ ...editData, education: { ...(editData.education as Education)!, [field]: e.target.value } })} className="w-full px-6 py-4 bg-white border border-slate-200 rounded-2xl outline-none text-slate-900" />
                    </div>
                  ))}
                </div>
              </section>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-2 ml-1">Bio</label>
                <textarea value={editData.bio ?? ''} onChange={e => setEditData({ ...editData, bio: e.target.value })} rows={4} className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none resize-none text-slate-900" />
              </div>
              <div className="flex space-x-4">
                <button onClick={() => setIsEditingProfile(false)} className="flex-1 py-4 bg-slate-100 text-slate-500 font-black uppercase tracking-widest text-[10px] rounded-2xl">Cancel</button>
                <button onClick={handleSaveProfile} disabled={saving} className="flex-1 py-4 bg-slate-900 text-white font-black uppercase tracking-widest text-[10px] rounded-2xl disabled:opacity-50 shadow-xl">
                  {saving ? 'Saving...' : 'Save Profile'}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-10">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div>
                  <h1 className="text-4xl font-black text-slate-900 tracking-tighter">{profile.name}</h1>
                  <div className="flex flex-wrap items-center gap-3 mt-4">
                    <span className="px-5 py-1.5 bg-teal-50 text-teal-700 text-[9px] font-black rounded-full uppercase tracking-[0.2em]">Dentistry</span>
                    {profile.specialty && <span className="px-5 py-1.5 bg-slate-100 text-slate-500 text-[9px] font-black rounded-full uppercase tracking-[0.2em]">{profile.specialty}</span>}
                    {profile.location && <span className="px-5 py-1.5 bg-slate-100 text-slate-500 text-[9px] font-black rounded-full uppercase tracking-[0.2em]">{profile.location}</span>}
                  </div>
                </div>
                {profile.linkedin && (
                  <a href={profile.linkedin} target="_blank" rel="noopener noreferrer" className="px-8 py-3 bg-[#0077b5] text-white rounded-full font-black text-[10px] uppercase tracking-widest flex items-center hover:scale-105 transition-all shadow-lg">
                    LinkedIn
                  </a>
                )}
              </div>
              {profile.bio && (
                <section>
                  <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-4">About Me</h3>
                  <p className="text-slate-600 text-xl leading-relaxed font-medium italic">"{profile.bio}"</p>
                </section>
              )}
              {profile.education && (
                <section>
                  <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-6">Academic Background</h3>
                  <div className="space-y-4">
                    {profile.education.phd && <div className="flex items-start gap-4"><div className="w-12 h-12 rounded-2xl bg-blue-600 text-white flex items-center justify-center font-black text-xs shrink-0">PhD</div><div className="pt-2"><h4 className="font-bold text-slate-900">{profile.education.phd}</h4><p className="text-slate-400 text-xs font-black uppercase tracking-widest mt-1">Doctorate</p></div></div>}
                    {profile.education.specialization && <div className="flex items-start gap-4"><div className="w-12 h-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center font-black text-xs shrink-0">SPEC</div><div className="pt-2"><h4 className="font-bold text-slate-900">{profile.education.specialization}</h4><p className="text-slate-400 text-xs font-black uppercase tracking-widest mt-1">Specialization</p></div></div>}
                    {profile.education.master && <div className="flex items-start gap-4"><div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center font-black text-xs shrink-0">MSC</div><div className="pt-2"><h4 className="font-bold text-slate-900">{profile.education.master}</h4><p className="text-slate-400 text-xs font-black uppercase tracking-widest mt-1">Master's</p></div></div>}
                    {(profile.education.bachelor || profile.graduation) && <div className="flex items-start gap-4"><div className="w-12 h-12 rounded-2xl bg-slate-900 text-white flex items-center justify-center font-black text-xs shrink-0">BA</div><div className="pt-2"><h4 className="font-bold text-slate-900">{profile.education.bachelor || profile.graduation}</h4><p className="text-slate-400 text-xs font-black uppercase tracking-widest mt-1">Bachelor's</p></div></div>}
                  </div>
                </section>
              )}
              {profile.availability && (
                <section className="bg-slate-50 p-8 rounded-[2.5rem] border border-slate-200/50 max-w-sm">
                  <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-4">Working Hours</h3>
                  <p className="font-bold text-slate-900">{profile.availability.start} – {profile.availability.end}</p>
                </section>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  // ── Patient Panel (modal) ────────────────────────────────────────────────
  const renderPatientPanel = () => {
    if (!selectedPatient) return null;
    const patientApps = appointments.filter(a => a.patientId === selectedPatient.patientId);
    const visitCount = patientApps.length;
    const existingChart = toothCharts.find(c => c.patientId === selectedPatient.patientId);
    const existingPlan = treatmentPlans.find(p => p.patientId === selectedPatient.patientId && p.status === 'active');
    const patientDentalNotes = dentalNotes.filter(n => n.patientId === selectedPatient.patientId);

    return (
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-end sm:items-center justify-end p-0 sm:p-6 z-[110] animate-in fade-in duration-200"
        onClick={() => setSelectedPatient(null)}
      >
        <div
          className="bg-white rounded-t-[2.5rem] sm:rounded-[2.5rem] w-full sm:w-[660px] max-h-[92vh] flex flex-col shadow-2xl animate-in slide-in-from-bottom-8 sm:slide-in-from-right-8 duration-300"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-8 pt-8 pb-5 border-b border-slate-100 shrink-0">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl overflow-hidden bg-slate-100 shrink-0">
                <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${selectedPatient.patientName}`} alt="" className="w-full h-full" />
              </div>
              <div>
                <h2 className="text-xl font-black text-slate-900 tracking-tighter">{selectedPatient.patientName}</h2>
                <div className="flex items-center gap-2 mt-1.5">
                  <span className="text-xs font-bold text-slate-400">{visitCount} {visitCount === 1 ? 'visit' : 'visits'}</span>
                  {existingPlan && <span className="text-[10px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full bg-[#A2F0D3]/40 text-emerald-700">Active plan</span>}
                </div>
              </div>
            </div>
            <button onClick={() => setSelectedPatient(null)} className="w-9 h-9 rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center hover:bg-slate-200 transition shrink-0">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </div>

          {/* Save success banner */}
          {saveSuccess && (
            <div className="mx-8 mt-4 px-4 py-2.5 bg-[#A2F0D3]/20 border border-[#A2F0D3]/40 rounded-xl flex items-center gap-2 animate-in fade-in duration-200 shrink-0">
              <span className="material-symbols-outlined text-emerald-600" style={{ fontSize: '16px' }}>check_circle</span>
              <p className="text-xs font-bold text-emerald-700">
                {saveSuccess === 'chart' ? 'Tooth chart saved!' : saveSuccess === 'plan' ? 'Treatment plan saved!' : 'Note saved!'}
              </p>
            </div>
          )}

          {/* Tabs */}
          <div className="flex items-center gap-2 px-8 pt-5 pb-0 shrink-0">
            {(['chart', 'plan', 'notes'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setPatientPanelTab(tab)}
                className={`px-5 py-2 text-[10px] font-black uppercase tracking-widest rounded-full transition-all ${patientPanelTab === tab ? 'bg-slate-900 text-white' : 'text-slate-400 hover:text-slate-600'}`}
              >
                {tab === 'chart' ? 'Tooth Chart' : tab === 'plan' ? 'Treatment Plan' : 'Visit Notes'}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto px-8 py-6 no-scrollbar">

            {/* ── TOOTH CHART TAB ── */}
            {patientPanelTab === 'chart' && (
              <div className="space-y-5">
                {/* Legend */}
                <div className="flex flex-wrap gap-3">
                  {(Object.entries(TOOTH_STATUS_CONFIG) as [ToothCondition['status'], { color: string; label: string }][]).map(([status, cfg]) => (
                    <span key={status} className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500">
                      <span className="w-3 h-3 rounded-full inline-block shrink-0" style={{ background: cfg.color }} />
                      {cfg.label}
                    </span>
                  ))}
                </div>

                {/* Upper jaw */}
                <div className="space-y-1">
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 text-center">Upper</p>
                  <div className="flex justify-center items-center gap-0.5">
                    {FDI_UPPER[0].map(n => renderTooth(n))}
                    <div className="w-px h-6 bg-slate-200 mx-2" />
                    {FDI_UPPER[1].map(n => renderTooth(n))}
                  </div>
                </div>

                <div className="h-2" />

                {/* Lower jaw */}
                <div className="space-y-1">
                  <div className="flex justify-center items-center gap-0.5">
                    {FDI_LOWER[0].map(n => renderTooth(n))}
                    <div className="w-px h-6 bg-slate-200 mx-2" />
                    {FDI_LOWER[1].map(n => renderTooth(n))}
                  </div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 text-center">Lower</p>
                </div>

                {/* Selected tooth editor */}
                {selectedTooth !== null && (
                  <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 space-y-3">
                    <p className="text-xs font-black uppercase tracking-widest text-slate-500">Tooth #{selectedTooth}</p>
                    <div className="grid grid-cols-4 gap-2">
                      {(Object.keys(TOOTH_STATUS_CONFIG) as ToothCondition['status'][]).map(s => (
                        <button
                          key={s}
                          onClick={() => setToothStatusDraft(s)}
                          className={`py-1.5 px-1 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all border ${toothStatusDraft === s ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-500 hover:border-slate-400'}`}
                        >
                          {TOOTH_STATUS_CONFIG[s].label}
                        </button>
                      ))}
                    </div>
                    <input
                      value={toothNoteDraft}
                      onChange={e => setToothNoteDraft(e.target.value)}
                      placeholder="Note (optional)"
                      className="w-full px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 text-slate-900"
                    />
                    <button
                      onClick={() => {
                        setEditingChart(prev => ({ ...prev, [selectedTooth]: { status: toothStatusDraft, note: toothNoteDraft || undefined } }));
                        setSelectedTooth(null);
                        setToothNoteDraft('');
                      }}
                      className="w-full py-2 bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest rounded-xl"
                    >
                      Apply
                    </button>
                  </div>
                )}

                {existingChart && (
                  <p className="text-[10px] text-slate-400 text-center">Last updated {new Date(existingChart.updatedAt).toLocaleDateString()}</p>
                )}

                <button
                  onClick={handleSaveChart}
                  disabled={savingChart}
                  className="w-full py-3 bg-[#A2F0D3] text-slate-900 font-black uppercase text-[10px] tracking-widest rounded-2xl shadow-sm disabled:opacity-40 transition-all hover:brightness-95"
                >
                  {savingChart ? 'Saving...' : 'Save Tooth Chart'}
                </button>
              </div>
            )}

            {/* ── TREATMENT PLAN TAB ── */}
            {patientPanelTab === 'plan' && (
              <div className="space-y-4">
                {editingPlan.length === 0 ? (
                  <div className="text-center py-8 text-slate-400 text-sm">No procedures planned yet.</div>
                ) : (
                  <div className="space-y-2">
                    {editingPlan.map((proc, i) => (
                      <div key={proc.id} className="flex items-center gap-3 bg-slate-50 rounded-xl p-3 border border-slate-100">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-slate-900 truncate">{proc.procedure}</p>
                          <p className="text-[10px] text-slate-400 mt-0.5">
                            {proc.tooth ? `Tooth #${proc.tooth} · ` : ''}{proc.material ? `${proc.material} · ` : ''}${proc.cost.toFixed(2)}
                          </p>
                        </div>
                        <button
                          onClick={() => {
                            const next: TreatmentProcedure['status'] = proc.status === 'pending' ? 'in-progress' : proc.status === 'in-progress' ? 'completed' : 'pending';
                            setEditingPlan(prev => prev.map((p, idx) => idx === i ? { ...p, status: next } : p));
                          }}
                          className={`shrink-0 px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${
                            proc.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                            proc.status === 'in-progress' ? 'bg-blue-100 text-blue-700' :
                            'bg-green-100 text-green-700'
                          }`}
                        >
                          {proc.status}
                        </button>
                        <button onClick={() => setEditingPlan(prev => prev.filter((_, idx) => idx !== i))} className="text-slate-300 hover:text-red-400 transition shrink-0">
                          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>close</span>
                        </button>
                      </div>
                    ))}
                    <p className="text-right text-xs font-black text-slate-500">
                      Total: ${editingPlan.reduce((s, p) => s + p.cost, 0).toFixed(2)}
                    </p>
                  </div>
                )}

                {/* Add procedure form */}
                <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 space-y-2">
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Add Procedure</p>
                  <select
                    value={newProc.procedure}
                    onChange={e => setNewProc(p => ({ ...p, procedure: e.target.value }))}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm outline-none text-slate-900"
                  >
                    <option value="">Select procedure…</option>
                    {DENTAL_PROCEDURES.map(dp => <option key={dp} value={dp}>{dp}</option>)}
                  </select>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      value={newProc.tooth ?? ''}
                      onChange={e => setNewProc(p => ({ ...p, tooth: e.target.value ? Number(e.target.value) : undefined }))}
                      placeholder="Tooth # (optional)"
                      type="number"
                      className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm outline-none text-slate-900"
                    />
                    <input
                      value={newProc.cost || ''}
                      onChange={e => setNewProc(p => ({ ...p, cost: Number(e.target.value) || 0 }))}
                      placeholder="Cost $"
                      type="number"
                      className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm outline-none text-slate-900"
                    />
                  </div>
                  <input
                    value={newProc.material ?? ''}
                    onChange={e => setNewProc(p => ({ ...p, material: e.target.value }))}
                    placeholder="Material (optional)"
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm outline-none text-slate-900"
                  />
                  <button
                    onClick={() => {
                      if (!newProc.procedure.trim()) return;
                      setEditingPlan(prev => [...prev, { ...newProc, id: Date.now().toString() }]);
                      setNewProc({ procedure: '', material: '', cost: 0, status: 'pending', tooth: undefined, notes: '' });
                    }}
                    className="w-full py-2 bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest rounded-xl"
                  >
                    Add to Plan
                  </button>
                </div>

                <button
                  onClick={handleSavePlan}
                  disabled={savingPlan}
                  className="w-full py-3 bg-[#A2F0D3] text-slate-900 font-black uppercase text-[10px] tracking-widest rounded-2xl disabled:opacity-40 hover:brightness-95 transition-all"
                >
                  {savingPlan ? 'Saving...' : existingPlan ? 'Update Treatment Plan' : 'Create Treatment Plan'}
                </button>
              </div>
            )}

            {/* ── VISIT NOTES TAB ── */}
            {patientPanelTab === 'notes' && (
              <div className="space-y-4">
                {/* History */}
                {patientDentalNotes.length > 0 && (
                  <div className="space-y-3">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">History ({patientDentalNotes.length})</p>
                    <div className="space-y-3 max-h-56 overflow-y-auto no-scrollbar">
                      {patientDentalNotes.map(note => (
                        <div key={note.id} className="bg-slate-50 rounded-2xl p-4 border border-slate-100 text-sm space-y-1.5">
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                            {new Date(note.visitDate || note.createdAt).toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}
                          </p>
                          {note.chiefComplaint && <p><span className="font-bold text-slate-600">Complaint:</span> <span className="text-slate-700">{note.chiefComplaint}</span></p>}
                          <p><span className="font-bold text-slate-600">Diagnosis:</span> <span className="text-slate-700">{note.diagnosis}</span></p>
                          <p><span className="font-bold text-slate-600">Treatment:</span> <span className="text-slate-700">{note.treatment}</span></p>
                          {note.materials && <p className="text-slate-400 text-xs">Materials: {note.materials}</p>}
                          {note.nextVisit && <p className="text-emerald-600 text-xs font-bold">Next visit: {note.nextVisit}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* New note form */}
                <div className="space-y-2">
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">New Note</p>
                  <input
                    type="date"
                    value={noteForm.visitDate}
                    onChange={e => setNoteForm(f => ({ ...f, visitDate: e.target.value }))}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none text-slate-900"
                  />
                  <textarea
                    value={noteForm.chiefComplaint}
                    onChange={e => setNoteForm(f => ({ ...f, chiefComplaint: e.target.value }))}
                    placeholder="Chief complaint…"
                    rows={2}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none resize-none text-slate-900"
                  />
                  <textarea
                    value={noteForm.diagnosis}
                    onChange={e => setNoteForm(f => ({ ...f, diagnosis: e.target.value }))}
                    placeholder="Diagnosis…"
                    rows={2}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none resize-none text-slate-900"
                  />
                  <textarea
                    value={noteForm.treatment}
                    onChange={e => setNoteForm(f => ({ ...f, treatment: e.target.value }))}
                    placeholder="Treatment performed…"
                    rows={2}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none resize-none text-slate-900"
                  />
                  <input
                    value={noteForm.materials}
                    onChange={e => setNoteForm(f => ({ ...f, materials: e.target.value }))}
                    placeholder="Materials used (optional)"
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none text-slate-900"
                  />
                  <input
                    value={noteForm.nextVisit}
                    onChange={e => setNoteForm(f => ({ ...f, nextVisit: e.target.value }))}
                    placeholder="Next visit (optional, e.g. 2 weeks)"
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none text-slate-900"
                  />
                  <button
                    onClick={handleSaveDentalNote}
                    disabled={savingNote || !noteForm.chiefComplaint.trim() || !noteForm.diagnosis.trim() || !noteForm.treatment.trim()}
                    className="w-full py-3 bg-slate-900 text-white font-black uppercase text-[10px] tracking-widest rounded-2xl disabled:opacity-40 transition-all"
                  >
                    {savingNote ? 'Saving...' : 'Save Note'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ── Nav ──────────────────────────────────────────────────────────────────
  const navItems: { view: DentistView; label: string; icon: string }[] = [
    { view: 'overview',  label: 'Dashboard', icon: 'grid_view' },
    { view: 'patients',  label: 'Patients',  icon: 'people' },
    { view: 'schedule',  label: 'Schedule',  icon: 'calendar_month' },
    { view: 'profile',   label: 'Profile',   icon: 'person' },
  ];

  const viewTitle: Record<DentistView, string> = {
    overview: 'Dashboard',
    patients: 'Patients',
    schedule: 'Schedule',
    profile:  'Profile',
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex min-h-screen bg-slate-50">

      {/* Wrap-up modal */}
      {wrapUpId && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center p-4 z-[100] animate-in fade-in duration-200">
          <div className="bg-white rounded-[3rem] p-10 max-w-md w-full shadow-2xl animate-in zoom-in-95 duration-300 space-y-5">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-500">Dental Visit</p>
              <h3 className="text-2xl font-black text-slate-900 tracking-tighter">Wrap-Up</h3>
            </div>
            <textarea
              value={wrapUpDiagnosis}
              onChange={e => setWrapUpDiagnosis(e.target.value)}
              placeholder="Diagnosis / findings…"
              rows={2}
              className="w-full px-5 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm outline-none resize-none text-slate-900"
            />
            <textarea
              value={wrapUpTreatment}
              onChange={e => setWrapUpTreatment(e.target.value)}
              placeholder="Treatment performed…"
              rows={2}
              className="w-full px-5 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm outline-none resize-none text-slate-900"
            />
            <textarea
              value={wrapUpComment}
              onChange={e => setWrapUpComment(e.target.value)}
              placeholder="Additional notes (optional)…"
              rows={2}
              className="w-full px-5 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm outline-none resize-none text-slate-900"
            />
            <div className="flex gap-3">
              <button
                onClick={() => { setWrapUpId(null); setWrapUpComment(''); setWrapUpDiagnosis(''); setWrapUpTreatment(''); }}
                className="flex-1 py-4 text-slate-400 font-black uppercase text-[10px] tracking-widest hover:bg-slate-100 rounded-2xl transition"
              >
                Discard
              </button>
              <button
                onClick={handleSubmitWrapUp}
                disabled={submittingWrapUp || !wrapUpDiagnosis.trim() || !wrapUpTreatment.trim()}
                className="flex-1 py-4 bg-slate-900 text-white font-black uppercase text-[10px] tracking-widest rounded-2xl hover:bg-black shadow-xl disabled:opacity-40 transition"
              >
                {submittingWrapUp ? 'Saving...' : 'Finalize Visit'}
              </button>
            </div>
          </div>
        </div>
      )}

      {renderPatientPanel()}

      {/* Left sidebar */}
      <aside className="w-60 shrink-0 bg-[#0a1628] flex flex-col fixed inset-y-0 left-0 z-50">
        <div className="px-6 py-5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <img src="/kura-logo.png" alt="Kura" className="w-9 h-9 rounded-[10px] shadow-lg" />
            <span className="text-white font-black text-xl tracking-tighter">Kura</span>
          </div>
        </div>

        <nav className="flex-1 px-3 py-6 space-y-1">
          {navItems.map(item => (
            <button
              key={item.view}
              onClick={() => { setCurrentView(item.view); setSelectedPatient(null); if (item.view === 'profile') setIsEditingProfile(false); }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-sm font-bold text-left ${
                currentView === item.view ? 'bg-white/15 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
              }`}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="px-3 pb-6">
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/5">
            <div className="w-9 h-9 rounded-full bg-[#A2F0D3] flex items-center justify-center text-slate-900 font-black text-sm shrink-0">
              {profile.name?.[0]?.toUpperCase() ?? '?'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-xs font-bold truncate">{profile.name}</p>
              <p className="text-slate-400 text-[10px] capitalize truncate">{profile.specialty || 'Dentist'}</p>
            </div>
            <button onClick={() => signOut(auth)} className="text-slate-400 hover:text-white transition shrink-0" title="Sign out">
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>logout</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main area */}
      <div className="ml-60 flex-1 flex flex-col min-h-screen">
        <header className="bg-white border-b border-slate-100 px-8 h-16 flex items-center justify-between sticky top-0 z-40 shrink-0">
          <h2 className="text-slate-900 font-black text-lg tracking-tighter">{viewTitle[currentView]}</h2>
          <span className="text-slate-400 text-xs font-medium hidden sm:block">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </span>
        </header>

        <main className="flex-1 p-8">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <p className="text-slate-400 text-sm font-bold animate-pulse">Loading…</p>
            </div>
          ) : currentView === 'overview' ? renderOverview()
            : currentView === 'patients' ? renderPatients()
            : currentView === 'schedule' ? renderSchedule()
            : renderProfile()}
        </main>
      </div>
    </div>
  );
};

export default DentistDashboard;
