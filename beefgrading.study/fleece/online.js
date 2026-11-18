// Posted official keys (Firestore fleece_keys). No network until the first call: Firebase
// modular 10.12.0 is import()ed lazily from www.gstatic.com. Nothing here throws to callers;
// every function resolves {ok:true, ...} or {ok:false, error:'offline'|'auth'|'denied'|'invalid'|'notfound'|'error'}.
// Rules and field set: firestore.rules (fleece_keys). Posting needs Google sign-in (anonymous is rejected).
import { encodeKey, decodeKey, isKeyString } from './keycodec.js';

// Same public web config as data.js FIREBASE_CONFIG (intentionally public, see data.js:15-22).
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAYOHyHewalDzPBXG1TB5jI9Jr-wan2zEU",
  authDomain: "beef-grading-drill.firebaseapp.com",
  projectId: "beef-grading-drill",
  storageBucket: "beef-grading-drill.firebasestorage.app",
  messagingSenderId: "165385647296",
  appId: "1:165385647296:web:b97cc997f58fae7d5fa925"
};
const CDN = 'https://www.gstatic.com/firebasejs/10.12.0/';
const COLL = 'fleece_keys';

let fbPromise = null;
function fb() {
  if (!fbPromise) {
    fbPromise = Promise.all([
      import(CDN + 'firebase-app.js'),
      import(CDN + 'firebase-auth.js'),
      import(CDN + 'firebase-firestore.js'),
    ]).then(([app, auth, fs]) => {
      const a = app.getApps().length ? app.getApp() : app.initializeApp(FIREBASE_CONFIG);
      return { auth, fs, authInst: auth.getAuth(a), db: fs.getFirestore(a) };
    }).catch((e) => { fbPromise = null; throw Object.assign(new Error('load'), { code: 'offline-load', cause: e }); });
  }
  return fbPromise;
}

function fail(e) {
  const code = e && e.code ? String(e.code) : '';
  let error = 'error';
  if (code === 'offline-load' || code === 'unavailable' || code === 'auth/network-request-failed'
    || code === 'failed-precondition' && typeof navigator !== 'undefined' && navigator.onLine === false) error = 'offline';
  else if (code === 'permission-denied') error = 'denied';
  else if (code === 'not-found') error = 'notfound';
  else if (code.startsWith('auth/')) error = 'auth';
  else if (code === 'invalid') error = 'invalid';
  else if (typeof navigator !== 'undefined' && navigator.onLine === false) error = 'offline';
  return { ok: false, error, code };
}

const userInfo = (u) => (u ? { uid: u.uid, name: String(u.displayName || '').slice(0, 60), anonymous: !!u.isAnonymous } : null);
const ms = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : 0);

function official(id, d) {
  if (!d || typeof d.title !== 'string' || !isKeyString(d.key)) return null;
  return {
    id,
    title: d.title.slice(0, 80),
    n: Number.isInteger(d.n) && d.n >= 1 && d.n <= 20 ? d.n : 20,
    key: d.key,
    fleeces: decodeKey(d.key),
    ownerUid: typeof d.ownerUid === 'string' ? d.ownerUid : '',
    ownerName: typeof d.ownerName === 'string' ? d.ownerName.slice(0, 60) : '',
    createdAt: ms(d.createdAt),
  };
}

export async function listOfficials(limit = 30) {
  try {
    const { fs, db } = await fb();
    const lim = Number.isInteger(limit) ? Math.max(1, Math.min(100, limit)) : 30;
    const snap = await fs.getDocs(fs.query(fs.collection(db, COLL), fs.orderBy('createdAt', 'desc'), fs.limit(lim)));
    const items = [];
    snap.forEach((doc) => { const o = official(doc.id, doc.data()); if (o) items.push(o); });
    return { ok: true, items };
  } catch (e) { return fail(e); }
}

export async function getOfficial(id) {
  try {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return fail({ code: 'invalid' });
    const { fs, db } = await fb();
    const snap = await fs.getDoc(fs.doc(db, COLL, id));
    const o = snap.exists() ? official(snap.id, snap.data()) : null;
    return o ? { ok: true, official: o } : { ok: false, error: 'notfound' };
  } catch (e) { return fail(e); }
}

// Resolves {ok:true, user} where user is {uid, name, anonymous} or null.
export async function currentUser() {
  try {
    const { authInst } = await fb();
    if (typeof authInst.authStateReady === 'function') await authInst.authStateReady();
    return { ok: true, user: userInfo(authInst.currentUser) };
  } catch (e) { return fail(e); }
}

// {title, n, key}: key is the 120-char string or an array of fleece objects. Signs in with a Google popup if needed.
export async function postOfficial(input) {
  const o = input && typeof input === 'object' ? input : {};
  const title = String(o.title == null ? '' : o.title).trim().slice(0, 80);
  const n = o.n;
  if (!title || !Number.isInteger(n) || n < 1 || n > 20) return fail({ code: 'invalid' });
  const key = typeof o.key === 'string' ? o.key : Array.isArray(o.key) ? encodeKey(o.key, n) : '';
  if (!isKeyString(key)) return fail({ code: 'invalid' });
  try {
    const { auth, fs, authInst, db } = await fb();
    if (typeof authInst.authStateReady === 'function') await authInst.authStateReady();
    let u = authInst.currentUser;
    if (!u || u.isAnonymous) u = (await auth.signInWithPopup(authInst, new auth.GoogleAuthProvider())).user;
    const ref = await fs.addDoc(fs.collection(db, COLL), {
      v: 1, title, n, key,
      ownerUid: u.uid,
      ownerName: String(u.displayName || '').slice(0, 60),
      createdAt: fs.serverTimestamp(),
    });
    return { ok: true, id: ref.id };
  } catch (e) { return fail(e); }
}

export async function deleteOfficial(id) {
  try {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return fail({ code: 'invalid' });
    const { fs, db } = await fb();
    await fs.deleteDoc(fs.doc(db, COLL, id));
    return { ok: true };
  } catch (e) { return fail(e); }
}
