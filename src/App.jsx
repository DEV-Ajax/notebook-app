import React, { useState, useEffect, useRef } from "react";
import { Plus, LogOut, Image as ImageIcon, Save, Trash2, X, Loader2, Mail, Lock, BookOpen, Cloud, CloudOff } from "lucide-react";

// ============================================================================
// FIREBASE CONFIG — replace with your project's config
// Get this from Firebase Console > Project Settings > General > Your apps
// ============================================================================
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyAclE_KpCI-IbZHI8imLVCVGyAluioAd9U",
  authDomain: "note-bd610.firebaseapp.com",
  projectId: "note-bd610",
  storageBucket: "note-bd610.firebasestorage.app",
  messagingSenderId: "619524511344",
  appId: "1:619524511344:web:3c57563b1bc926ddd006b5",
  measurementId: "G-SENEX287RG"
};
// ============================================================================
// GOOGLE DRIVE CONFIG — for photo storage
// Create OAuth Client ID (Web) in Google Cloud Console, enable Drive API
// ============================================================================
const GOOGLE_CLIENT_ID = "619524511344-bofm0e8c3cvudtt7av1853quutdd0570.apps.googleusercontent.com";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

// ----------------------------------------------------------------------------
// Firebase SDK loaded dynamically (modular v10 via CDN ESM)
// ----------------------------------------------------------------------------
let firebaseApp, auth, db;
let firebaseReady = false;

async function initFirebase() {
  if (firebaseReady) return;
  const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js");
  const authMod = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js");
  const firestoreMod = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");

  firebaseApp = initializeApp(firebaseConfig);
  auth = authMod.getAuth(firebaseApp);
  db = firestoreMod.getFirestore(firebaseApp);

  window.__fb = { authMod, firestoreMod, auth, db };
  firebaseReady = true;
}

// ----------------------------------------------------------------------------
// Google Identity Services for Drive OAuth (token client)
// ----------------------------------------------------------------------------
function loadGsiScript() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

async function getDriveAccessToken() {
  await loadGsiScript();
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: DRIVE_SCOPE,
      callback: (resp) => {
        if (resp.error) return reject(resp);
        resolve(resp.access_token);
      },
    });
    client.requestAccessToken();
  });
}

async function uploadPhotoToDrive(file, accessToken) {
  const metadata = {
    name: `notebook_${Date.now()}_${file.name}`,
    mimeType: file.type,
  };

  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append("file", file);

  const uploadRes = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink,webContentLink",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form,
    }
  );
  if (!uploadRes.ok) throw new Error("Drive upload failed");
  const uploaded = await uploadRes.json();

  // Make file viewable via link (anyone with link, read-only)
  await fetch(`https://www.googleapis.com/drive/v3/files/${uploaded.id}/permissions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  });

  return {
    fileId: uploaded.id,
    viewLink: uploaded.webViewLink,
    // Direct embeddable thumbnail
    thumbnail: `https://drive.google.com/thumbnail?id=${uploaded.id}&sz=w1000`,
  };
}

// ----------------------------------------------------------------------------
// Main App
// ----------------------------------------------------------------------------
export default function App() {
  const [booted, setBooted] = useState(false);
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState("login"); // login | signup
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [notes, setNotes] = useState([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [editing, setEditing] = useState(null); // null | "new" | note object
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [draftPhotos, setDraftPhotos] = useState([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef(null);

  // ---- Boot Firebase + listen to auth state ----
  useEffect(() => {
    let unsub;
    (async () => {
      try {
        await initFirebase();
        const { onAuthStateChanged } = window.__fb.authMod;
        unsub = onAuthStateChanged(auth, (u) => {
          setUser(u);
          setBooted(true);
        });
      } catch (e) {
        console.error(e);
        setBooted(true);
      }
    })();
    return () => unsub && unsub();
  }, []);

  // ---- Subscribe to notes for current user ----
  useEffect(() => {
    if (!user) {
      setNotes([]);
      return;
    }
    setNotesLoading(true);
    const { collection, query, where, orderBy, onSnapshot } = window.__fb.firestoreMod;
    const q = query(
      collection(db, "notes"),
      where("uid", "==", user.uid),
      orderBy("updatedAt", "desc")
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setNotes(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setNotesLoading(false);
      },
      (err) => {
        console.error(err);
        setNotesLoading(false);
      }
    );
    return () => unsub();
  }, [user]);

  // ---- Auth actions ----
  async function handleAuth(e) {
    e.preventDefault();
    setAuthError("");
    setAuthLoading(true);
    try {
      const {
        signInWithEmailAndPassword,
        createUserWithEmailAndPassword,
      } = window.__fb.authMod;
      if (authMode === "login") {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
      }
    } catch (err) {
      setAuthError(humanizeAuthError(err.code));
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleLogout() {
    const { signOut } = window.__fb.authMod;
    await signOut(auth);
  }

  // ---- Note editor actions ----
  function openNewNote() {
    setEditing("new");
    setDraftTitle("");
    setDraftBody("");
    setDraftPhotos([]);
  }

  function openNote(note) {
    setEditing(note);
    setDraftTitle(note.title || "");
    setDraftBody(note.body || "");
    setDraftPhotos(note.photos || []);
  }

  function closeEditor() {
    setEditing(null);
  }

  async function handlePhotoSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingPhoto(true);
    try {
      const token = await getDriveAccessToken();
      const result = await uploadPhotoToDrive(file, token);
      setDraftPhotos((prev) => [...prev, result]);
    } catch (err) {
      console.error(err);
      alert("Photo upload failed. Check your Google Drive setup.");
    } finally {
      setUploadingPhoto(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function removeDraftPhoto(idx) {
    setDraftPhotos((prev) => prev.filter((_, i) => i !== idx));
  }

  async function saveNote() {
    if (!draftTitle.trim() && !draftBody.trim() && draftPhotos.length === 0) {
      closeEditor();
      return;
    }
    setSaving(true);
    try {
      const { collection, addDoc, doc, updateDoc, serverTimestamp } = window.__fb.firestoreMod;
      const payload = {
        uid: user.uid,
        title: draftTitle.trim(),
        body: draftBody,
        photos: draftPhotos,
        updatedAt: serverTimestamp(),
      };
      if (editing === "new") {
        payload.createdAt = serverTimestamp();
        await addDoc(collection(db, "notes"), payload);
      } else {
        await updateDoc(doc(db, "notes", editing.id), payload);
      }
      closeEditor();
    } catch (err) {
      console.error(err);
      alert("Could not save note.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteNote(note) {
    if (!confirm("Delete this note?")) return;
    const { doc, deleteDoc } = window.__fb.firestoreMod;
    await deleteDoc(doc(db, "notes", note.id));
    if (editing && editing.id === note.id) closeEditor();
  }

  // ---- Render states ----
  if (!booted) {
    return (
      <Shell>
        <div className="flex h-full items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
        </div>
      </Shell>
    );
  }

  if (!user) {
    return (
      <Shell>
        <AuthScreen
          mode={authMode}
          setMode={setAuthMode}
          email={email}
          setEmail={setEmail}
          password={password}
          setPassword={setPassword}
          onSubmit={handleAuth}
          loading={authLoading}
          error={authError}
        />
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="flex h-full flex-col">
        <Header user={user} onLogout={handleLogout} />
        <main className="flex-1 overflow-y-auto px-4 pb-28 pt-4">
          {notesLoading ? (
            <div className="flex justify-center pt-16">
              <Loader2 className="h-6 w-6 animate-spin text-cyan-400" />
            </div>
          ) : notes.length === 0 ? (
            <EmptyState onCreate={openNewNote} />
          ) : (
            <NotesGrid notes={notes} onOpen={openNote} onDelete={deleteNote} />
          )}
        </main>

        {!editing && (
          <button
            onClick={openNewNote}
            aria-label="New note"
            className="absolute bottom-6 right-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400 to-violet-500 shadow-[0_0_24px_rgba(34,211,238,0.45)] transition-transform active:scale-95"
          >
            <Plus className="h-7 w-7 text-black" strokeWidth={2.5} />
          </button>
        )}

        {editing && (
          <NoteEditor
            isNew={editing === "new"}
            title={draftTitle}
            body={draftBody}
            photos={draftPhotos}
            uploadingPhoto={uploadingPhoto}
            saving={saving}
            onTitleChange={setDraftTitle}
            onBodyChange={setDraftBody}
            onAddPhoto={() => fileInputRef.current?.click()}
            onRemovePhoto={removeDraftPhoto}
            onClose={closeEditor}
            onSave={saveNote}
            onDelete={editing !== "new" ? () => deleteNote(editing) : null}
          />
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handlePhotoSelect}
        />
      </div>
    </Shell>
  );
}

// ----------------------------------------------------------------------------
// Layout shell — NEXUS aesthetic: deep void background, glass panels, glow
// ----------------------------------------------------------------------------
function Shell({ children }) {
  return (
    <div className="relative h-screen w-full overflow-hidden bg-[#05070d] text-slate-100 font-sans">
      {/* Ambient glow orbs */}
      <div className="pointer-events-none absolute -left-24 -top-24 h-64 w-64 rounded-full bg-cyan-500/20 blur-3xl" />
      <div className="pointer-events-none absolute -right-20 top-1/3 h-72 w-72 rounded-full bg-violet-500/15 blur-3xl" />
      {/* Grid texture */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,1) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
        }}
      />
      <div className="relative z-10 h-full">{children}</div>
    </div>
  );
}

function Header({ user, onLogout }) {
  return (
    <header className="flex items-center justify-between border-b border-white/5 bg-white/[0.02] px-4 py-3.5 backdrop-blur-xl">
      <div className="flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400/20 to-violet-500/20 ring-1 ring-white/10">
          <BookOpen className="h-4.5 w-4.5 text-cyan-300" strokeWidth={2} />
        </div>
        <div className="leading-tight">
          <p className="text-[15px] font-semibold tracking-tight text-white">Notebook</p>
          <p className="truncate text-[11px] text-slate-400 max-w-[160px]">{user.email}</p>
        </div>
      </div>
      <button
        onClick={onLogout}
        aria-label="Log out"
        className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 ring-1 ring-white/10 transition-colors active:bg-white/10"
      >
        <LogOut className="h-4.5 w-4.5 text-slate-300" strokeWidth={2} />
      </button>
    </header>
  );
}

function EmptyState({ onCreate }) {
  return (
    <div className="flex h-[70vh] flex-col items-center justify-center text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400/10 to-violet-500/10 ring-1 ring-white/10">
        <BookOpen className="h-7 w-7 text-cyan-300/70" strokeWidth={1.5} />
      </div>
      <h2 className="text-base font-semibold text-white">No notes yet</h2>
      <p className="mt-1 max-w-[240px] text-sm text-slate-400">
        Capture a thought, attach a photo, and it syncs across your devices.
      </p>
      <button
        onClick={onCreate}
        className="mt-5 rounded-xl bg-gradient-to-r from-cyan-400 to-violet-500 px-5 py-2.5 text-sm font-semibold text-black shadow-[0_0_20px_rgba(34,211,238,0.35)] transition-transform active:scale-95"
      >
        Create your first note
      </button>
    </div>
  );
}

function NotesGrid({ notes, onOpen, onDelete }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {notes.map((note) => (
        <button
          key={note.id}
          onClick={() => onOpen(note)}
          className="group relative flex flex-col overflow-hidden rounded-2xl border border-white/8 bg-white/[0.03] p-3 text-left backdrop-blur-xl transition-colors active:bg-white/[0.06]"
        >
          {note.photos?.[0] && (
            <div className="mb-2 -mx-3 -mt-3 h-24 w-[calc(100%+1.5rem)] overflow-hidden">
              <img
                src={note.photos[0].thumbnail}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover"
              />
            </div>
          )}
          <h3 className="line-clamp-1 text-[13px] font-semibold text-white">
            {note.title || "Untitled"}
          </h3>
          <p className="mt-1 line-clamp-3 text-[12px] leading-snug text-slate-400">
            {note.body || "No additional text"}
          </p>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[10px] text-slate-500">
              {formatDate(note.updatedAt)}
            </span>
            {note.photos?.length > 0 && (
              <span className="flex items-center gap-1 text-[10px] text-cyan-400/80">
                <ImageIcon className="h-3 w-3" />
                {note.photos.length}
              </span>
            )}
          </div>
          <span
            onClick={(e) => {
              e.stopPropagation();
              onDelete(note);
            }}
            role="button"
            aria-label="Delete note"
            className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-lg bg-black/40 opacity-0 backdrop-blur-md transition-opacity group-active:opacity-100 group-hover:opacity-100"
          >
            <Trash2 className="h-3.5 w-3.5 text-rose-400" />
          </span>
        </button>
      ))}
    </div>
  );
}

function NoteEditor({
  isNew,
  title,
  body,
  photos,
  uploadingPhoto,
  saving,
  onTitleChange,
  onBodyChange,
  onAddPhoto,
  onRemovePhoto,
  onClose,
  onSave,
  onDelete,
}) {
  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-[#05070d]">
      <div className="flex items-center justify-between border-b border-white/5 bg-white/[0.02] px-4 py-3.5 backdrop-blur-xl">
        <button
          onClick={onClose}
          aria-label="Close"
          className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 ring-1 ring-white/10 active:bg-white/10"
        >
          <X className="h-4.5 w-4.5 text-slate-300" />
        </button>
        <span className="text-[13px] font-medium text-slate-400">
          {isNew ? "New note" : "Edit note"}
        </span>
        <button
          onClick={onSave}
          disabled={saving}
          aria-label="Save note"
          className="flex h-10 items-center gap-1.5 rounded-xl bg-gradient-to-r from-cyan-400 to-violet-500 px-4 text-[13px] font-semibold text-black shadow-[0_0_16px_rgba(34,211,238,0.3)] active:scale-95 disabled:opacity-60"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-28 pt-4">
        <input
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="Title"
          aria-label="Note title"
          className="w-full bg-transparent text-xl font-semibold text-white placeholder:text-slate-500 focus:outline-none"
        />
        <div className="my-3 h-px bg-white/5" />
        <textarea
          value={body}
          onChange={(e) => onBodyChange(e.target.value)}
          placeholder="Start writing..."
          aria-label="Note body"
          rows={8}
          className="w-full resize-none bg-transparent text-[14px] leading-relaxed text-slate-200 placeholder:text-slate-500 focus:outline-none"
        />

        {photos.length > 0 && (
          <div className="mt-4 grid grid-cols-2 gap-2">
            {photos.map((p, i) => (
              <div key={i} className="group relative overflow-hidden rounded-xl ring-1 ring-white/10">
                <img src={p.thumbnail} alt="" loading="lazy" className="aspect-square w-full object-cover" />
                <button
                  onClick={() => onRemovePhoto(i)}
                  aria-label="Remove photo"
                  className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-lg bg-black/50 backdrop-blur-md"
                >
                  <X className="h-3.5 w-3.5 text-white" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="absolute bottom-0 left-0 right-0 flex items-center gap-2 border-t border-white/5 bg-white/[0.02] px-4 py-3 backdrop-blur-xl">
        <button
          onClick={onAddPhoto}
          disabled={uploadingPhoto}
          className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-white/5 text-[13px] font-medium text-slate-200 ring-1 ring-white/10 active:bg-white/10 disabled:opacity-60"
        >
          {uploadingPhoto ? (
            <Loader2 className="h-4 w-4 animate-spin text-cyan-300" />
          ) : (
            <ImageIcon className="h-4 w-4 text-cyan-300" />
          )}
          {uploadingPhoto ? "Uploading to Drive..." : "Add photo (Drive)"}
        </button>
        {onDelete && (
          <button
            onClick={onDelete}
            aria-label="Delete note"
            className="flex h-11 w-11 items-center justify-center rounded-xl bg-rose-500/10 ring-1 ring-rose-500/20 active:bg-rose-500/20"
          >
            <Trash2 className="h-4.5 w-4.5 text-rose-400" />
          </button>
        )}
      </div>
    </div>
  );
}

function AuthScreen({ mode, setMode, email, setEmail, password, setPassword, onSubmit, loading, error }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6">
      <div className="mb-8 flex flex-col items-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400/20 to-violet-500/20 ring-1 ring-white/10">
          <BookOpen className="h-6 w-6 text-cyan-300" strokeWidth={2} />
        </div>
        <h1 className="mt-4 text-xl font-bold tracking-tight text-white">Notebook</h1>
        <p className="mt-1 text-[13px] text-slate-400">Notes synced. Photos in Drive.</p>
      </div>

      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-3">
        <div className="relative">
          <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            aria-label="Email"
            className="h-12 w-full rounded-xl border border-white/8 bg-white/[0.03] pl-10 pr-3 text-[14px] text-white placeholder:text-slate-500 focus:border-cyan-400/50 focus:outline-none focus:ring-1 focus:ring-cyan-400/30"
          />
        </div>
        <div className="relative">
          <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="password"
            required
            minLength={6}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password (min 6 chars)"
            aria-label="Password"
            className="h-12 w-full rounded-xl border border-white/8 bg-white/[0.03] pl-10 pr-3 text-[14px] text-white placeholder:text-slate-500 focus:border-cyan-400/50 focus:outline-none focus:ring-1 focus:ring-cyan-400/30"
          />
        </div>

        {error && (
          <p role="alert" className="rounded-lg bg-rose-500/10 px-3 py-2 text-[12px] text-rose-300 ring-1 ring-rose-500/20">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 to-violet-500 text-[14px] font-semibold text-black shadow-[0_0_24px_rgba(34,211,238,0.35)] active:scale-[0.99] disabled:opacity-60"
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          {mode === "login" ? "Log in" : "Create account"}
        </button>
      </form>

      <button
        onClick={() => setMode(mode === "login" ? "signup" : "login")}
        className="mt-4 text-[13px] text-slate-400"
      >
        {mode === "login" ? (
          <>Don't have an account? <span className="font-semibold text-cyan-300">Sign up</span></>
        ) : (
          <>Already have an account? <span className="font-semibold text-cyan-300">Log in</span></>
        )}
      </button>

      <div className="mt-10 flex items-center gap-1.5 text-[11px] text-slate-500">
        <Cloud className="h-3.5 w-3.5" />
        Secured by Firebase Auth
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
function humanizeAuthError(code) {
  switch (code) {
    case "auth/invalid-email":
      return "That email address looks invalid.";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Incorrect email or password.";
    case "auth/email-already-in-use":
      return "An account already exists with that email.";
    case "auth/weak-password":
      return "Password must be at least 6 characters.";
    default:
      return "Something went wrong. Please try again.";
  }
}

function formatDate(ts) {
  if (!ts) return "";
  const date = ts.toDate ? ts.toDate() : new Date(ts);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}
