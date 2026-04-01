import { useState, useRef, useEffect, useCallback } from "react";

// ============================================================
// KONFIGURATION — hier anpassen!
// ============================================================
// Du brauchst eine Google Cloud Client ID.
// Anleitung: https://console.cloud.google.com → APIs & Services → Credentials → OAuth 2.0 Client ID (Web)
// Erlaubte Redirect URIs: deine Vercel-URL + http://localhost:5173 zum Testen
// Scopes: https://www.googleapis.com/auth/drive.file
// ============================================================
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";
const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_API_KEY || "";

const DEFAULT_FOLDERS = [
  { id: "1wpUyCfh4XSXoysVnVUZxkol8H9KzuLhN", name: "März" },
  { id: "1c-q56hFiknGU9b4OUHwE6xZ-g7i3yotm", name: "April" },
  { id: "1arlYM5innCGpY0TTUlwZ47vKEcslvmLx", name: "Mai" },
];

const KATEGORIEN = ["Rechnung", "Quittung", "Vertrag", "Kontoauszug", "Sonstiges"];
const TAB = { HOME: "home", CAMERA: "camera", PREVIEW: "preview", SETUP: "setup" };

// ============================================================
// GOOGLE AUTH & DRIVE HELPERS
// ============================================================
function getAccessToken() { return localStorage.getItem("gdrive_token"); }
function setAccessToken(t) { localStorage.setItem("gdrive_token", t); }
function clearAccessToken() { localStorage.removeItem("gdrive_token"); }

function startGoogleAuth() {
  const redirectUri = window.location.origin + "/";
  const scope = "https://www.googleapis.com/auth/drive.file";
  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=token&scope=${encodeURIComponent(scope)}&prompt=consent`;
  window.location.href = url;
}

function parseHashToken() {
  const hash = window.location.hash;
  if (!hash.includes("access_token")) return null;
  const params = new URLSearchParams(hash.substring(1));
  return params.get("access_token");
}

async function uploadFileToDrive(accessToken, fileName, base64Data, mimeType, folderId) {
  // Convert base64 to blob
  const byteString = atob(base64Data);
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
  const blob = new Blob([ab], { type: mimeType });

  // Multipart upload
  const metadata = { name: fileName, mimeType, parents: [folderId] };
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append("file", blob);

  const resp = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    if (resp.status === 401) { clearAccessToken(); throw new Error("Session abgelaufen. Bitte neu einloggen."); }
    throw new Error(err.error?.message || `Upload fehlgeschlagen (${resp.status})`);
  }
  return resp.json();
}

// ============================================================
// ICON COMPONENT
// ============================================================
function Icon({ name, size = 20, color = "currentColor" }) {
  const p = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: color, strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" };
  const icons = {
    camera: <svg {...p}><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>,
    upload: <svg {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>,
    folder: <svg {...p}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>,
    check: <svg {...p}><polyline points="20 6 9 17 4 12"/></svg>,
    x: <svg {...p}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
    flip: <svg {...p}><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>,
    file: <svg {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>,
    trash: <svg {...p}><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>,
    back: <svg {...p}><polyline points="15 18 9 12 15 6"/></svg>,
    plus: <svg {...p}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
    settings: <svg {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
    logout: <svg {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
    google: <svg {...p} stroke="none"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>,
  };
  return icons[name] || null;
}

function Spinner({ size = 44 }) {
  return <div style={{ width: size, height: size, border: "3px solid rgba(232,25,122,0.12)", borderTopColor: "#E8197A", borderRadius: "50%", animation: "spin 0.75s linear infinite" }} />;
}

// ============================================================
// MAIN APP
// ============================================================
export default function BelegScanner() {
  const [tab, setTab] = useState(TAB.HOME);
  const [folder, setFolder] = useState(DEFAULT_FOLDERS[0].id);
  const [kat, setKat] = useState("Rechnung");
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [results, setResults] = useState([]);
  const [history, setHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem("beleg_history") || "[]"); } catch { return []; }
  });
  const [dragOver, setDragOver] = useState(false);
  const [err, setErr] = useState("");
  const [stream, setStream] = useState(null);
  const [facing, setFacing] = useState("environment");
  const [authed, setAuthed] = useState(!!getAccessToken());
  const [userName, setUserName] = useState(localStorage.getItem("gdrive_user") || "");
  const vidRef = useRef(null);
  const canRef = useRef(null);
  const fileRef = useRef(null);

  // Check for OAuth callback
  useEffect(() => {
    const token = parseHashToken();
    if (token) {
      setAccessToken(token);
      setAuthed(true);
      window.history.replaceState(null, "", window.location.pathname);
      // Fetch user info
      fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${token}` },
      }).then(r => r.json()).then(d => {
        if (d.name) { setUserName(d.name); localStorage.setItem("gdrive_user", d.name); }
      }).catch(() => {});
    }
  }, []);

  // Save history to localStorage
  useEffect(() => {
    localStorage.setItem("beleg_history", JSON.stringify(history.slice(0, 50)));
  }, [history]);

  const ts = () => {
    const n = new Date();
    return `${n.toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit",year:"numeric"}).replace(/\./g,"-")}_${n.toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"}).replace(":","")}`; 
  };

  // ========== CAMERA ==========
  const startCam = async () => {
    try {
      const ms = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      setStream(ms); setTab(TAB.CAMERA);
      setTimeout(() => { if (vidRef.current) vidRef.current.srcObject = ms; }, 100);
    } catch { setErr("Kamera-Zugriff verweigert. Bitte erlaube den Zugriff in deinen Browser-Einstellungen."); }
  };
  const stopCam = useCallback(() => { if (stream) { stream.getTracks().forEach(t => t.stop()); setStream(null); } }, [stream]);
  const flipCam = async () => {
    stopCam(); const nm = facing === "environment" ? "user" : "environment"; setFacing(nm);
    try {
      const ms = await navigator.mediaDevices.getUserMedia({ video: { facingMode: nm, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      setStream(ms); setTimeout(() => { if (vidRef.current) vidRef.current.srcObject = ms; }, 100);
    } catch {}
  };
  const snap = () => {
    const v = vidRef.current, c = canRef.current; if (!v || !c) return;
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d").drawImage(v, 0, 0);
    const du = c.toDataURL("image/jpeg", 0.9);
    setFiles(p => [...p, { id: Date.now(), name: `${kat}_${ts()}.jpg`, dataUrl: du, type: "image/jpeg", size: Math.round(du.length * 0.75), kat }]);
    stopCam(); setTab(TAB.PREVIEW);
  };

  // ========== FILE UPLOAD ==========
  const addFiles = (fl) => {
    Array.from(fl).forEach(f => {
      const r = new FileReader();
      r.onload = e => setFiles(p => [...p, { id: Date.now() + Math.random(), name: f.name, dataUrl: e.target.result, type: f.type, size: f.size, kat }]);
      r.readAsDataURL(f);
    });
    setTab(TAB.PREVIEW);
  };
  const onDrop = e => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); };
  const onFileInput = e => { if (e.target.files.length) addFiles(e.target.files); e.target.value = ""; };

  // ========== UPLOAD TO DRIVE ==========
  const uploadAll = async () => {
    const token = getAccessToken();
    if (!token) { setErr("Bitte erst mit Google einloggen."); return; }
    if (!files.length) return;
    setUploading(true); setResults([]); setUploadProgress(0);
    const fn = DEFAULT_FOLDERS.find(f => f.id === folder)?.name || "Belege";
    const res = [];

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      setUploadProgress(Math.round(((i) / files.length) * 100));
      try {
        const base64 = f.dataUrl.split(",")[1];
        await uploadFileToDrive(token, f.name, base64, f.type, folder);
        res.push({ id: f.id, name: f.name, ok: true, msg: "Erfolgreich hochgeladen" });
      } catch (e) {
        res.push({ id: f.id, name: f.name, ok: false, msg: e.message });
        if (e.message.includes("abgelaufen")) { setAuthed(false); break; }
      }
    }

    setUploadProgress(100);
    setResults(res);
    const ok = res.filter(r => r.ok);
    if (ok.length) {
      setHistory(p => [...ok.map(r => ({ name: r.name, folder: fn, ts: new Date().toLocaleString("de-DE") })), ...p]);
    }
    setUploading(false);
  };

  const rmFile = id => setFiles(p => p.filter(f => f.id !== id));
  const clearAll = () => { setFiles([]); setResults([]); setTab(TAB.HOME); };
  const logout = () => { clearAccessToken(); setAuthed(false); setUserName(""); localStorage.removeItem("gdrive_user"); };

  useEffect(() => () => { if (stream) stream.getTracks().forEach(t => t.stop()); }, [stream]);

  const folderName = DEFAULT_FOLDERS.find(f => f.id === folder)?.name;
  const needsSetup = !GOOGLE_CLIENT_ID;

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(155deg, #06060b 0%, #0d0d18 45%, #091015 100%)", fontFamily: "'Montserrat',sans-serif", color: "#eee", position: "relative" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;600;700;800;900&display=swap');
        @keyframes slideUp{from{opacity:0;transform:translateY(22px)}to{opacity:1;transform:translateY(0)}}
        @keyframes fadeIn{from{opacity:0}to{opacity:1}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(232,25,122,0.3)}50%{box-shadow:0 0 0 12px rgba(232,25,122,0)}}
        @keyframes dragPulse{0%,100%{border-color:rgba(27,221,221,0.25)}50%{border-color:rgba(27,221,221,0.7)}}
        @keyframes glow{0%,100%{opacity:.35}50%{opacity:.7}}
        @keyframes progressBar{from{width:0}to{width:100%}}
        *{box-sizing:border-box;margin:0;padding:0}
        body{background:#06060b}
        input,select,button{font-family:'Montserrat',sans-serif}
        ::-webkit-scrollbar{width:3px}
        ::-webkit-scrollbar-thumb{background:rgba(232,25,122,0.2);border-radius:4px}
      `}</style>

      <div style={{position:"fixed",top:-140,right:-140,width:380,height:380,borderRadius:"50%",background:"radial-gradient(circle,rgba(232,25,122,0.05) 0%,transparent 70%)",pointerEvents:"none",animation:"glow 7s ease-in-out infinite"}}/>
      <div style={{position:"fixed",bottom:-120,left:-100,width:320,height:320,borderRadius:"50%",background:"radial-gradient(circle,rgba(27,221,221,0.04) 0%,transparent 70%)",pointerEvents:"none",animation:"glow 9s ease-in-out infinite 3s"}}/>

      <div style={{ position:"relative", zIndex:1, maxWidth:500, margin:"0 auto", padding:"10px 16px 36px" }}>

        {/* HEADER */}
        <div style={{ textAlign:"center", padding:"22px 0 6px", animation:"slideUp 0.5s ease-out" }}>
          <div style={{ display:"inline-flex", alignItems:"center", gap:9, background:"linear-gradient(135deg,rgba(232,25,122,0.08),rgba(27,221,221,0.05))", borderRadius:14, padding:"9px 22px", border:"1px solid rgba(232,25,122,0.13)" }}>
            <span style={{fontSize:22}}>📸</span>
            <span style={{ fontSize:18, fontWeight:800, letterSpacing:"-0.03em", background:"linear-gradient(135deg,#E8197A,#1BDDDD)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>Beleg-Scanner</span>
          </div>
          <p style={{ marginTop:7, fontSize:10.5, color:"rgba(255,255,255,0.3)", fontWeight:500, letterSpacing:"0.07em", textTransform:"uppercase" }}>
            Fotografieren · Hochladen → Google Drive
          </p>
        </div>

        {/* AUTH BAR */}
        {!needsSetup && (
          <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:8, padding:"8px 0 14px", animation:"fadeIn 0.5s ease-out 0.1s both" }}>
            {authed ? (
              <>
                <div style={{ width:8, height:8, borderRadius:"50%", background:"#1BDDDD" }} />
                <span style={{ fontSize:11.5, color:"rgba(255,255,255,0.45)", fontWeight:500 }}>
                  {userName ? `Eingeloggt als ${userName}` : "Mit Google verbunden"}
                </span>
                <button onClick={logout} style={{ background:"none", border:"none", cursor:"pointer", padding:2, opacity:0.4 }}>
                  <Icon name="logout" size={14} color="#ff6b6b" />
                </button>
              </>
            ) : (
              <button onClick={startGoogleAuth} style={{
                display:"flex", alignItems:"center", gap:8,
                padding:"10px 20px", borderRadius:12,
                background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)",
                color:"#eee", fontSize:13, fontWeight:600, cursor:"pointer",
              }}>
                <Icon name="google" size={18} /> Mit Google anmelden
              </button>
            )}
          </div>
        )}

        {/* MAIN CARD */}
        <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.05)", borderRadius:20, overflow:"hidden", animation:"slideUp 0.6s ease-out 0.06s both" }}>

          {/* ====== SETUP NEEDED ====== */}
          {needsSetup && tab !== TAB.SETUP && (
            <div style={{ padding: 24, textAlign: "center" }}>
              <div style={{ fontSize: 40, marginBottom: 16 }}>⚙️</div>
              <p style={{ fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.7)", marginBottom: 8 }}>
                Einrichtung erforderlich
              </p>
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", lineHeight: 1.6, marginBottom: 20 }}>
                Du brauchst eine Google Cloud Client ID, damit die App auf Google Drive zugreifen kann.
              </p>
              <button onClick={() => setTab(TAB.SETUP)} style={{ ...btnP, width: "100%" }}>
                <Icon name="settings" size={18} /> Einrichtung starten
              </button>
            </div>
          )}

          {/* ====== SETUP PAGE ====== */}
          {tab === TAB.SETUP && (
            <div style={{ padding: 20, animation: "slideUp 0.3s ease-out" }}>
              <label style={lbl}>So richtest du die App ein:</label>
              <div style={{ marginTop: 12, fontSize: 12.5, color: "rgba(255,255,255,0.55)", lineHeight: 1.8 }}>
                <p><strong style={{ color: "#E8197A" }}>1.</strong> Gehe zu <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer" style={{ color: "#1BDDDD" }}>Google Cloud Console</a></p>
                <p><strong style={{ color: "#E8197A" }}>2.</strong> Erstelle ein neues Projekt oder wähle ein bestehendes</p>
                <p><strong style={{ color: "#E8197A" }}>3.</strong> Aktiviere die "Google Drive API"</p>
                <p><strong style={{ color: "#E8197A" }}>4.</strong> Erstelle unter "Credentials" eine "OAuth 2.0 Client ID" (Typ: Web Application)</p>
                <p><strong style={{ color: "#E8197A" }}>5.</strong> Füge als Redirect URI hinzu: <code style={{ background: "rgba(255,255,255,0.05)", padding: "2px 6px", borderRadius: 4, fontSize: 11 }}>{window.location.origin}/</code></p>
                <p><strong style={{ color: "#E8197A" }}>6.</strong> Kopiere die Client ID</p>
                <p><strong style={{ color: "#E8197A" }}>7.</strong> Setze sie in Vercel als Umgebungsvariable: <code style={{ background: "rgba(255,255,255,0.05)", padding: "2px 6px", borderRadius: 4, fontSize: 11 }}>VITE_GOOGLE_CLIENT_ID</code></p>
              </div>
              <button onClick={() => setTab(TAB.HOME)} style={{ ...btnO, width: "100%", marginTop: 20 }}>Zurück</button>
            </div>
          )}

          {/* ====== HOME ====== */}
          {!needsSetup && tab === TAB.HOME && (
            <div style={{ padding: 20 }}>
              <label style={lbl}>Zielordner</label>
              <select value={folder} onChange={e => setFolder(e.target.value)} style={sel}>
                {DEFAULT_FOLDERS.map(f => <option key={f.id} value={f.id} style={{background:"#13131e"}}>{f.name}</option>)}
              </select>

              <label style={{...lbl,marginTop:16}}>Kategorie</label>
              <div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:6}}>
                {KATEGORIEN.map(k=>(
                  <button key={k} onClick={()=>setKat(k)} style={{
                    padding:"6px 14px",borderRadius:20,fontSize:12,fontWeight:600,cursor:"pointer",transition:"all 0.15s",
                    border:kat===k?"1px solid #E8197A":"1px solid rgba(255,255,255,0.07)",
                    background:kat===k?"rgba(232,25,122,0.1)":"transparent",
                    color:kat===k?"#E8197A":"rgba(255,255,255,0.45)",
                  }}>{k}</button>
                ))}
              </div>

              {/* Drop zone */}
              <div
                onDragOver={e=>{e.preventDefault();setDragOver(true)}}
                onDragLeave={()=>setDragOver(false)}
                onDrop={onDrop}
                onClick={()=>fileRef.current?.click()}
                style={{
                  marginTop:20,padding:"28px 16px",
                  border:dragOver?"2px solid #1BDDDD":"2px dashed rgba(255,255,255,0.08)",
                  borderRadius:16,textAlign:"center",cursor:"pointer",
                  background:dragOver?"rgba(27,221,221,0.05)":"rgba(255,255,255,0.01)",
                  transition:"all 0.2s",animation:dragOver?"dragPulse 1s infinite":"none",
                }}
              >
                <div style={{marginBottom:8,opacity:0.45}}><Icon name="upload" size={26} color={dragOver?"#1BDDDD":"#E8197A"}/></div>
                <p style={{fontSize:13.5,fontWeight:600,color:dragOver?"#1BDDDD":"rgba(255,255,255,0.55)"}}>
                  {dragOver?"Hier ablegen!":"Dateien hierher ziehen"}
                </p>
                <p style={{fontSize:11,color:"rgba(255,255,255,0.25)",marginTop:3}}>oder klicken · JPG, PNG, PDF</p>
              </div>
              <input ref={fileRef} type="file" accept="image/*,.pdf" multiple onChange={onFileInput} style={{display:"none"}}/>

              {/* Camera button */}
              <button onClick={startCam} style={{...btnP,width:"100%",marginTop:16,animation:"pulse 2.5s infinite"}}>
                <Icon name="camera" size={18}/> Beleg fotografieren
              </button>

              {/* Queue badge */}
              {files.length > 0 && (
                <button onClick={()=>setTab(TAB.PREVIEW)} style={{
                  width:"100%",marginTop:10,padding:"12px 16px",borderRadius:12,cursor:"pointer",
                  background:"rgba(232,25,122,0.06)",border:"1px solid rgba(232,25,122,0.15)",
                  display:"flex",alignItems:"center",gap:10,color:"#E8197A",fontSize:13,fontWeight:600,
                }}>
                  <Icon name="file" size={16} color="#E8197A"/>
                  {files.length} {files.length===1?"Beleg":"Belege"} bereit zum Hochladen
                  <span style={{marginLeft:"auto",fontSize:11,opacity:0.6}}>→</span>
                </button>
              )}

              {err && (
                <div style={{marginTop:12,padding:"10px 14px",borderRadius:10,background:"rgba(255,70,70,0.07)",border:"1px solid rgba(255,70,70,0.18)",fontSize:12,color:"#ff6b6b",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span>{err}</span>
                  <button onClick={()=>setErr("")} style={{background:"none",border:"none",color:"#ff6b6b",fontWeight:700,cursor:"pointer",fontSize:11}}>OK</button>
                </div>
              )}

              {/* History */}
              {history.length>0&&(
                <div style={{marginTop:22}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <label style={lbl}>Letzte Uploads</label>
                    <button onClick={()=>{setHistory([]);localStorage.removeItem("beleg_history")}} style={{background:"none",border:"none",color:"rgba(255,255,255,0.25)",fontSize:10,cursor:"pointer"}}>Leeren</button>
                  </div>
                  <div style={{marginTop:7,display:"flex",flexDirection:"column",gap:5}}>
                    {history.slice(0,8).map((h,i)=>(
                      <div key={i} style={{display:"flex",alignItems:"center",gap:9,padding:"9px 12px",borderRadius:10,background:"rgba(255,255,255,0.015)",border:"1px solid rgba(255,255,255,0.035)"}}>
                        <div style={{width:30,height:30,borderRadius:7,background:"rgba(27,221,221,0.07)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                          <Icon name="check" size={14} color="#1BDDDD"/>
                        </div>
                        <div style={{flex:1,minWidth:0}}>
                          <p style={{fontSize:12,fontWeight:600,color:"rgba(255,255,255,0.7)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{h.name}</p>
                          <p style={{fontSize:10,color:"rgba(255,255,255,0.25)"}}>{h.folder} · {h.ts}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ====== CAMERA ====== */}
          {tab===TAB.CAMERA&&(
            <div style={{position:"relative",background:"#000"}}>
              <video ref={vidRef} autoPlay playsInline muted style={{width:"100%",display:"block",minHeight:370}}/>
              <div style={{position:"absolute",inset:26,border:"2px solid rgba(232,25,122,0.25)",borderRadius:14,pointerEvents:"none"}}>
                {[{t:-2,l:-2,bT:"3px solid #E8197A",bL:"3px solid #E8197A"},{t:-2,r:-2,bT:"3px solid #E8197A",bR:"3px solid #E8197A"},{b:-2,l:-2,bB:"3px solid #1BDDDD",bL:"3px solid #1BDDDD"},{b:-2,r:-2,bB:"3px solid #1BDDDD",bR:"3px solid #1BDDDD"}].map((s,i)=>(
                  <div key={i} style={{position:"absolute",width:20,height:20,borderRadius:3,top:s.t,left:s.l,right:s.r,bottom:s.b,borderTop:s.bT,borderLeft:s.bL,borderRight:s.bR,borderBottom:s.bB}}/>
                ))}
              </div>
              <p style={{position:"absolute",top:10,width:"100%",textAlign:"center",fontSize:11,color:"rgba(255,255,255,0.55)",fontWeight:500,textShadow:"0 1px 8px rgba(0,0,0,0.8)"}}>Beleg im Rahmen positionieren</p>
              <div style={{position:"absolute",bottom:0,left:0,right:0,padding:"22px",background:"linear-gradient(transparent,rgba(0,0,0,0.88))",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <button onClick={()=>{stopCam();setTab(TAB.HOME)}} style={camB}><Icon name="x" size={19}/></button>
                <button onClick={snap} style={{width:66,height:66,borderRadius:"50%",background:"linear-gradient(135deg,#E8197A,#c41568)",border:"4px solid rgba(255,255,255,0.22)",cursor:"pointer",boxShadow:"0 0 26px rgba(232,25,122,0.4)"}}/>
                <button onClick={flipCam} style={camB}><Icon name="flip" size={18}/></button>
              </div>
              <canvas ref={canRef} style={{display:"none"}}/>
            </div>
          )}

          {/* ====== PREVIEW / QUEUE ====== */}
          {tab===TAB.PREVIEW&&(
            <div style={{animation:"slideUp 0.3s ease-out"}}>
              <div style={{padding:20}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <button onClick={()=>setTab(TAB.HOME)} style={{background:"none",border:"none",cursor:"pointer",color:"rgba(255,255,255,0.4)",padding:2}}><Icon name="back" size={18}/></button>
                    <label style={{...lbl,margin:0}}>{files.length} {files.length===1?"Beleg":"Belege"}</label>
                  </div>
                  <button onClick={()=>fileRef.current?.click()} style={{background:"none",border:"none",color:"#1BDDDD",fontSize:12,fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",gap:4}}>
                    <Icon name="plus" size={14} color="#1BDDDD"/> Weitere
                  </button>
                  <input ref={fileRef} type="file" accept="image/*,.pdf" multiple onChange={onFileInput} style={{display:"none"}}/>
                </div>

                <div style={{marginTop:10,display:"flex",flexDirection:"column",gap:7,maxHeight:260,overflowY:"auto",paddingRight:3}}>
                  {files.map(f=>(
                    <div key={f.id} style={{display:"flex",alignItems:"center",gap:9,padding:9,borderRadius:11,background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.05)"}}>
                      {f.type.startsWith("image/")&&f.dataUrl?(
                        <img src={f.dataUrl} alt="" style={{width:44,height:44,borderRadius:7,objectFit:"cover"}}/>
                      ):(
                        <div style={{width:44,height:44,borderRadius:7,background:"rgba(232,25,122,0.06)",display:"flex",alignItems:"center",justifyContent:"center"}}><Icon name="file" size={18} color="#E8197A"/></div>
                      )}
                      <div style={{flex:1,minWidth:0}}>
                        <input value={f.name} onChange={e=>setFiles(p=>p.map(pf=>pf.id===f.id?{...pf,name:e.target.value}:pf))} style={{
                          width:"100%",background:"transparent",border:"none",borderBottom:"1px solid rgba(255,255,255,0.06)",color:"#eee",fontSize:12,fontWeight:500,padding:"2px 0",outline:"none",
                        }}/>
                        <p style={{fontSize:10,color:"rgba(255,255,255,0.25)",marginTop:2}}>{f.kat} · {f.size>0?`${(f.size/1024).toFixed(0)} KB`:""}</p>
                      </div>
                      <button onClick={()=>rmFile(f.id)} style={{background:"none",border:"none",cursor:"pointer",padding:3,opacity:0.35}}>
                        <Icon name="trash" size={15} color="#ff6b6b"/>
                      </button>
                    </div>
                  ))}
                </div>

                <div style={{marginTop:12,padding:"9px 12px",borderRadius:9,background:"rgba(27,221,221,0.03)",border:"1px solid rgba(27,221,221,0.08)",display:"flex",alignItems:"center",gap:7,fontSize:11.5,color:"rgba(255,255,255,0.4)"}}>
                  <Icon name="folder" size={14} color="#1BDDDD"/> {folderName}
                </div>

                {/* Upload progress */}
                {uploading && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ height: 4, borderRadius: 2, background: "rgba(255,255,255,0.05)", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${uploadProgress}%`, background: "linear-gradient(90deg, #E8197A, #1BDDDD)", borderRadius: 2, transition: "width 0.3s" }} />
                    </div>
                    <p style={{ fontSize: 10.5, color: "rgba(255,255,255,0.35)", marginTop: 4, textAlign: "center" }}>{uploadProgress}%</p>
                  </div>
                )}

                {results.length>0&&(
                  <div style={{marginTop:12,display:"flex",flexDirection:"column",gap:5}}>
                    {results.map(r=>(
                      <div key={r.id} style={{padding:"9px 12px",borderRadius:9,background:r.ok?"rgba(27,221,221,0.05)":"rgba(255,70,70,0.06)",border:`1px solid ${r.ok?"rgba(27,221,221,0.12)":"rgba(255,70,70,0.15)"}`,display:"flex",alignItems:"center",gap:7}}>
                        <Icon name={r.ok?"check":"x"} size={14} color={r.ok?"#1BDDDD":"#ff5050"}/>
                        <div><p style={{fontSize:11.5,fontWeight:600,color:"rgba(255,255,255,0.65)"}}>{r.name}</p><p style={{fontSize:10,color:"rgba(255,255,255,0.3)"}}>{r.msg}</p></div>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{display:"flex",gap:9,marginTop:16}}>
                  <button onClick={clearAll} style={{...btnO,flex:1}}>{results.length?"Fertig":"Verwerfen"}</button>
                  {!results.length&&(
                    <button onClick={uploadAll} disabled={uploading||!files.length||!authed} style={{...btnP,flex:2,opacity:(uploading||!authed)?0.55:1}}>
                      {uploading?<Spinner size={18}/>:<Icon name="upload" size={17}/>}
                      {uploading?"Lädt hoch...":!authed?"Erst einloggen":`${files.length} hochladen`}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* FOOTER */}
        <p style={{ textAlign: "center", marginTop: 20, fontSize: 10, color: "rgba(255,255,255,0.15)", animation: "fadeIn 0.6s ease-out 0.4s both" }}>
          Beleg-Scanner · Deine Belege, sicher in Google Drive
        </p>
      </div>
    </div>
  );
}

const lbl={display:"block",fontSize:10,fontWeight:700,color:"rgba(255,255,255,0.35)",textTransform:"uppercase",letterSpacing:"0.08em"};
const sel={width:"100%",marginTop:6,padding:"10px 14px",background:"rgba(255,255,255,0.035)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:11,color:"#eee",fontSize:13,outline:"none",cursor:"pointer",appearance:"none",backgroundImage:`url("data:image/svg+xml,%3Csvg width='12' height='8' viewBox='0 0 12 8' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L6 6L11 1' stroke='%23E8197A' stroke-width='2' stroke-linecap='round'/%3E%3C/svg%3E")`,backgroundRepeat:"no-repeat",backgroundPosition:"right 14px center"};
const btnP={padding:"13px 18px",borderRadius:13,background:"linear-gradient(135deg,#E8197A,#c41568)",border:"none",color:"#fff",fontSize:13.5,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:7,transition:"all 0.15s"};
const btnO={padding:"13px",borderRadius:13,background:"rgba(255,255,255,0.025)",border:"1px solid rgba(255,255,255,0.07)",color:"rgba(255,255,255,0.55)",fontSize:13,fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:7};
const camB={width:42,height:42,borderRadius:"50%",background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.13)",color:"#fff",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"};
