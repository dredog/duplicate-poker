// Firebase Firestore adapter for Duplicate Poker
import { initializeApp } from 'firebase/app'
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "YOUR_API_KEY",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "YOUR_PROJECT.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "YOUR_PROJECT_ID",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "YOUR_PROJECT.appspot.com",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "123456789",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "YOUR_APP_ID"
}

const app = initializeApp(firebaseConfig)
const db = getFirestore(app)

export async function createRoom(code, seed, orbits, seeds, playerName) {
  const ref = doc(db, 'rooms', code)
  await setDoc(ref, { code, seed, seeds, orbits, players: [{ name: playerName, num: 1 }], status: 'waiting', created: Date.now() })
}

export async function getRoom(code) {
  const ref = doc(db, 'rooms', code)
  const snap = await getDoc(ref)
  return snap.exists() ? snap.data() : null
}

export async function joinRoom(code, playerName) {
  const room = await getRoom(code)
  if (!room) return
  if (!room.players.some(p => p.name === playerName)) {
    room.players.push({ name: playerName, num: room.players.length + 1 })
  }
  room.status = 'playing'
  await setDoc(doc(db, 'rooms', code), room)
}

export async function storeOrbitResult(code, playerNum, orbitNum, result) {
  await setDoc(doc(db, 'rooms', code, 'results', `p${playerNum}-o${orbitNum}`), { ...result, timestamp: Date.now() })
}

export async function getOrbitResult(code, playerNum, orbitNum) {
  const snap = await getDoc(doc(db, 'rooms', code, 'results', `p${playerNum}-o${orbitNum}`))
  return snap.exists() ? snap.data() : null
}

export async function getAllResults(code, playerNum, totalOrbits) {
  const results = []
  for (let i = 1; i <= totalOrbits; i++) results.push(await getOrbitResult(code, playerNum, i))
  return results
}

export async function getProfile(name) {
  const snap = await getDoc(doc(db, 'profiles', name.toLowerCase().trim()))
  return snap.exists() ? snap.data() : null
}

export async function saveProfile(name, profile) {
  await setDoc(doc(db, 'profiles', name.toLowerCase().trim()), profile)
}
