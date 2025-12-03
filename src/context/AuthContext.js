"use client";
import { useContext, createContext, useState, useEffect } from "react";
import {signInWithPopup, signInWithRedirect, signOut, onAuthStateChanged, GoogleAuthProvider} from "firebase/auth";
import { auth } from "@/lib/firebase";

const AuthContext = createContext(null);

export const AuthContextProvider = ({ children }) => {
  const [user, setUser] = useState(null);

    const googleSignIn = async () => {
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: "select_account" });
        try {
            return await signInWithPopup(auth, provider);
        } catch (err) {
            const code = (err && err.code) || "";
            // If popups are blocked or not allowed, fall back to full-page redirect
            if (code === "auth/popup-blocked" || code === "auth/popup-blocked-by-browser") {
                return await signInWithRedirect(auth, provider);
            }
            throw err;
        }
    }

    const logOut = async () => {
        return await signOut(auth);  
    }

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
            setUser(currentUser);
        })
        return () => unsubscribe();
    }, []);

  
  return <AuthContext.Provider value={[user, googleSignIn, logOut]}>{children}</AuthContext.Provider>;
};

export const UserAuth = () => {
  return useContext(AuthContext);
};
