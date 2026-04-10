import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, addDoc, onSnapshot, query, orderBy, serverTimestamp, where, doc, getDoc, setDoc, getDocs, writeBatch, updateDoc, deleteDoc, limit, arrayUnion, arrayRemove } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

const firebaseConfig = {
    apiKey: "AIzaSyDaiBqHYvI-_xNVO2y5LARD6yBnepQg73Q",
    authDomain: "hamsa-34767.firebaseapp.com",
    projectId: "hamsa-34767",
    storageBucket: "hamsa-34767.firebasestorage.app",
    messagingSenderId: "405288768605",
    appId: "1:405288768605:web:9dd85d2edad0cfda1b69b4",
    measurementId: "G-G2QMJNENRV"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
const storage = getStorage(app);
const googleProvider = new GoogleAuthProvider();

export {
    auth, db, storage, googleProvider,
    onAuthStateChanged, signInWithPopup, signOut,
    collection, addDoc, onSnapshot, query, orderBy, serverTimestamp, where, doc, getDoc, setDoc, getDocs, writeBatch, updateDoc, deleteDoc, limit, arrayUnion, arrayRemove
};