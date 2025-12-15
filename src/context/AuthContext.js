"use client";
import { useContext, createContext, useState, useEffect } from "react";
import { signInWithPopup, signOut, onAuthStateChanged, GoogleAuthProvider } from "firebase/auth";
import { auth, database } from "@/lib/firebase";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";

const AuthContext = createContext(null);

export const AuthContextProvider = ({ children }) => {
  const [user, setUser] = useState(null);

    const googleSignIn = () => {
        const provider = new GoogleAuthProvider();
        signInWithPopup(auth, provider);
    }

    const logOut = () => {
        signOut(auth);  
    }

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            setUser(currentUser);
            if (currentUser) {
                try {
                    const uid = currentUser.uid;
                    const userRef = doc(database, "users", uid);
                    const snap = await getDoc(userRef);
                    if (!snap.exists()) {
                        let addToCanvas = false;
                        try {
                            const v = localStorage.getItem("addToCanvas");
                            addToCanvas = v ? v === "true" : false;
                        } catch {}
                        await setDoc(userRef, {
                            uid,
                            name: currentUser.displayName || "",
                            email: currentUser.email || "",
                            imageUrl: currentUser.photoURL || "",
                            addToCanvas,
                            createdAt: serverTimestamp(),
                            updatedAt: serverTimestamp(),
                        });
                    } else {
                        // Optionally update last seen / updatedAt
                        try {
                            await setDoc(userRef, { updatedAt: serverTimestamp() }, { merge: true });
                        } catch {}
                    }
                } catch {}
            }
        })
        return () => unsubscribe();
    }, [user]);

  
  return <AuthContext.Provider value={[user, googleSignIn, logOut]}>{children}</AuthContext.Provider>;
};

export const UserAuth = () => {
  return useContext(AuthContext);
};
