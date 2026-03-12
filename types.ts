export type UserRole = 'doctor' | 'patient' | 'landlord';

export interface WorkingHours {
  start: string; // "08:30"
  end: string;   // "18:00"
  days: number[]; // [1, 2, 3, 4, 5] (Mon-Fri)
}

export interface Education {
  bachelor?: string;
  master?: string;
  phd?: string;
  specialization?: string;
}

export interface UserProfile {
  uid: string;
  email: string;
  role: UserRole;
  name: string;
  category?: string;
  specialty?: string;
  bio?: string;
  graduation?: string; // Legacy field
  education?: Education; // Structured academic background
  linkedin?: string;
  location?: string;
  avatarSeed?: string;
  profilePicture?: string;
  backgroundPicture?: string;
  createdAt?: string;
  availability?: WorkingHours; // Custom professional availability
}

export interface Appointment {
  id: string;
  doctorId: string;
  doctorName: string;
  patientId: string;
  patientName: string;
  date: string; // ISO string "2023-10-25T08:30:00"
  type: 'virtual' | 'in-person';
  status: 'pending' | 'done' | 'cancelled';
  doctorComment?: string;
  hasReceipt?: boolean;
  reviewed?: boolean;
  createdAt: string;
  location?: string;
}

export interface Review {
  id: string;
  doctorId: string;
  patientId: string;
  patientName: string;
  rating: number;
  comment: string;
  createdAt: string;
}

export interface Medication {
  id: string;
  patientId: string;
  name: string;
  dosage: string;      // e.g. "200 mg"
  times: string[];     // e.g. ["09:00", "20:00"]
  days: number[];      // 0=Sun … 6=Sat, empty means every day
  active: boolean;
  createdAt: string;
}

export interface MedicationLog {
  id: string;
  medicationId: string;
  patientId: string;
  date: string;        // "YYYY-MM-DD"
  time: string;        // "HH:MM"
  takenAt: string;     // ISO timestamp
}

export interface PatientNote {
  id: string;
  doctorId: string;
  patientId: string;
  patientName: string;
  content: string;
  visitDate: string;   // ISO string — pre-filled from appointment date
  createdAt: string;   // ISO string — when the note was saved
}