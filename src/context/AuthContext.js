"use client";
import { useContext, createContext, useState, useEffect } from "react";
import {signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged, GoogleAuthProvider} from "firebase/auth";
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
            if (
                code === "auth/popup-blocked" ||
                code === "auth/popup-blocked-by-browser" ||
                code === "auth/operation-not-supported-in-this-environment" ||
                code === "auth/cookie-policy-restricted"
            ) {
                return await signInWithRedirect(auth, provider);
            }
            if (typeof window !== "undefined") {
                console.error("[Auth] signInWithPopup failed:", err);
                alert("Google sign-in failed. Please ensure popups are allowed and try again.");
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
        // Handle completion of redirect-based sign-in flows
        getRedirectResult(auth).catch((err) => {
            if (err && typeof window !== "undefined") {
                console.error("[Auth] getRedirectResult error:", err);
            }
        });
        return () => unsubscribe();
    }, []);

  
  return <AuthContext.Provider value={[user, googleSignIn, logOut]}>{children}</AuthContext.Provider>;
};

export const UserAuth = () => {
  return useContext(AuthContext);
};

