
import { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../firebase';
// Fix: Combine onAuthStateChanged and User type import to ensure proper resolution of exported members.
import type { User } from 'firebase/auth';
import { onAuthStateChanged } from 'firebase/auth';
import type { UserProfile } from '../types';

/**
 * Custom hook to manage user authentication and profile state.
 * Uses onSnapshot to reactively fetch the user's role from Firestore.
 */
export const useUserRole = () => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubscribeProfile: (() => void) | null = null;

    // Listen for Auth state changes
    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      
      // Clean up previous profile listener if it exists
      if (unsubscribeProfile) {
        unsubscribeProfile();
        unsubscribeProfile = null;
      }

      if (currentUser) {
        // Use onSnapshot for real-time updates and to handle the signup race condition gracefully.
        // If the document doesn't exist yet (during signup), onSnapshot will fire when it's created.
        unsubscribeProfile = onSnapshot(
          doc(db, 'users', currentUser.uid),
          (docSnap) => {
            if (docSnap.exists()) {
              setProfile(docSnap.data() as UserProfile);
            } else {
              // User is logged in but profile doc hasn't been created yet
              setProfile(null);
            }
            setLoading(false);
          },
          (error) => {
            // "Missing or insufficient permissions" usually means rules don't allow reading this doc.
            // During signup, this can happen briefly before the doc is created if rules are strict.
            if (error.code !== 'permission-denied') {
              console.error("Firestore Profile Error:", error);
            }
            setProfile(null);
            setLoading(false);
          }
        );
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeProfile) unsubscribeProfile();
    };
  }, []);

  return { user, profile, loading };
};