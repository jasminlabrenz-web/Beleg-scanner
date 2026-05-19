import { useState, useRef, useEffect, useCallback } from "react";
import { jsPDF } from "jspdf";

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

// ============================================================
// DESIGN TOKENS — Brand: Blue #7371FC, Rose #fc60a8 · Apple-Look
// ============================================================
const APPLE_FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif';
const BRAND_BLUE = "#7371FC";
const BRAND_ROSE = "#fc60a8";
const TEXT_PRIMARY = "#1d1d1f";
const TEXT_SECONDARY = "#6e6e73";
const TEXT_TERTIARY = "#86868b";
const SURFACE_PRIMARY = "#FFFFFF";
const SURFACE_SECONDARY = "#F5F5F7";
const SURFACE_TERTIARY = "#FBFBFD";
const BORDER_SUBTLE = "rgba(0,0,0,0.08)";
const BORDER_MEDIUM = "rgba(0,0,0,0.12)";
const SHADOW_SOFT = "0 1px 2px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.06)";
const SHADOW_LIFTED = "0 4px 12px rgba(0,0,0,0.06), 0 12px 32px rgba(0,0,0,0.08)";

const DEFAULT_FOLDERS = [
  { id: "1WVRpggmT2pHkzv0DzVAWu9r2vcDB0GP6", name: "Mai" },
  { id: "1guqonjZ7Zq2cHdWZSy9enUYv_n0wiryn", name: "Juni" },
  { id: "1OS3hu7Ll8bkPq_zQxHtnugHPqqpDa3Gi", name: "Juli" },
  { id: "1hTwp4vhC2rEfXmAET71yLisgeyuQPIWY", name: "August" },
  { id: "1xvpIseZPenDbfO4MTBL99bY9JVEOKnOI", name: "September" },
  { id: "1sVEdya1SYEMqvFyNdBcohDn6fZm_pXtg", name: "Oktober" },
  { id: "1M8DYDGOTzuT5h5UUDjiEmEgo14epQHEV", name: "November" },
  { id: "1QLeP2j1XSW707HRmhruAkNxqBVgsxniY", name: "Dezember" },
];

const MONTH_NAMES = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];

function folderForDate(datum) {
  if (!datum) return null;
  const parts = datum.split("-");
  if (parts.length !== 3) return null;
  const m = parseInt(parts[1], 10) - 1;
  if (Number.isNaN(m) || m < 0 || m > 11) return null;
  return DEFAULT_FOLDERS.find(f => f.name === MONTH_NAMES[m]) || null;
}

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

async function uploadBlobToDrive(accessToken, fileName, blob, mimeType, folderId) {
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

async function uploadFileToDrive(accessToken, fileName, base64Data, mimeType, folderId) {
  const byteString = atob(base64Data);
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
  const blob = new Blob([ab], { type: mimeType });
  return uploadBlobToDrive(accessToken, fileName, blob, mimeType, folderId);
}

async function getOrCreateSubfolder(accessToken, parentId, name) {
  const cacheKey = `subfolder_${parentId}_${name}`;
  const cached = localStorage.getItem(cacheKey);

  // Cache validieren: existiert der Folder noch, ist er nicht im Papierkorb,
  // und liegt er tatsächlich noch im erwarteten Parent?
  if (cached) {
    try {
      const checkResp = await fetch(
        `https://www.googleapis.com/drive/v3/files/${cached}?fields=id,trashed,parents`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (checkResp.ok) {
        const meta = await checkResp.json();
        if (!meta.trashed && Array.isArray(meta.parents) && meta.parents.includes(parentId)) {
          return cached;
        }
      } else if (checkResp.status === 401) {
        clearAccessToken();
        throw new Error("Session abgelaufen. Bitte neu einloggen.");
      }
    } catch (e) {
      if (e.message && e.message.includes("abgelaufen")) throw e;
      // Sonstige Netzwerkfehler: ignorieren, Fallback auf neue Anlage
    }
    localStorage.removeItem(cacheKey);
  }

  const q = `'${parentId}' in parents and name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const listUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`;
  const listResp = await fetch(listUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (listResp.ok) {
    const data = await listResp.json();
    if (data.files && data.files.length > 0) {
      localStorage.setItem(cacheKey, data.files[0].id);
      return data.files[0].id;
    }
  } else if (listResp.status === 401) {
    clearAccessToken();
    throw new Error("Session abgelaufen. Bitte neu einloggen.");
  }

  const createResp = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] }),
  });
  if (!createResp.ok) {
    const err = await createResp.json().catch(() => ({}));
    throw new Error(err.error?.message || `Ordner anlegen fehlgeschlagen (${createResp.status})`);
  }
  const created = await createResp.json();
  localStorage.setItem(cacheKey, created.id);
  return created.id;
}

function slugify(s) {
  return (s || "")
    .replace(/[äÄ]/g, "ae").replace(/[öÖ]/g, "oe").replace(/[üÜ]/g, "ue").replace(/[ß]/g, "ss")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

async function generateBewirtungsPDF({ datum, anlass, personen, zahlung, dataUrl, type, name }) {
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = 210, pageH = 297, margin = 18;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(16);
  pdf.text("Bewirtungsbeleg", pageW / 2, margin + 4, { align: "center" });
  pdf.setFontSize(9);
  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(120);
  pdf.text("Nachweis nach § 4 Abs. 5 Nr. 2 EStG", pageW / 2, margin + 10, { align: "center" });
  pdf.setTextColor(40);

  let y = margin + 20;
  const rows = [
    ["Tag der Bewirtung", datum || "—"],
    ["Anlass / Grund", anlass || "—"],
    ["Bewirtete Personen", personen || "—"],
    ["Zahlungsart", zahlung === "bar" ? "Bar" : "Bank / Karte"],
  ];

  pdf.setDrawColor(220);
  pdf.setLineWidth(0.2);
  const labelX = margin;
  const valueX = margin + 52;
  const maxValueW = pageW - margin - valueX;

  for (const [k, v] of rows) {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10);
    pdf.text(k, labelX, y);
    pdf.setFont("helvetica", "normal");
    const lines = pdf.splitTextToSize(String(v), maxValueW);
    pdf.text(lines, valueX, y);
    const rowH = Math.max(7, lines.length * 5 + 2);
    pdf.line(margin, y + rowH - 3, pageW - margin, y + rowH - 3);
    y += rowH;
  }

  y += 6;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10);
  pdf.text("Beleg:", margin, y);
  y += 4;

  if (type && type.startsWith("image/")) {
    const img = await new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error("Bild konnte nicht geladen werden"));
      im.src = dataUrl;
    });
    const availW = pageW - 2 * margin;
    const availH = pageH - margin - y;
    let w = availW;
    let h = (img.height / img.width) * w;
    if (h > availH) { h = availH; w = (img.width / img.height) * h; }
    const x = (pageW - w) / 2;
    const fmt = type.includes("png") ? "PNG" : "JPEG";
    pdf.addImage(dataUrl, fmt, x, y, w, h);
  } else {
    pdf.setFont("helvetica", "italic");
    pdf.setFontSize(9);
    pdf.setTextColor(120);
    pdf.text(`(Beleg liegt als separate Datei bei: ${name})`, margin, y + 5);
  }

  return pdf.output("blob");
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
  return <div style={{ width: size, height: size, border: "3px solid rgba(115,113,252,0.12)", borderTopColor: "#7371FC", borderRadius: "50%", animation: "spin 0.75s linear infinite" }} />;
}

// ============================================================
// PRIVACY POLICY (route: /privacy)
// ============================================================
function PrivacyPolicy() {
  return (
    <div style={{minHeight:"100vh",background:"#FFFFFF",color:TEXT_PRIMARY,fontFamily:APPLE_FONT,padding:"56px 24px",WebkitFontSmoothing:"antialiased"}}>
      <style>{`*{box-sizing:border-box;margin:0;padding:0}body{background:#FFFFFF;color:${TEXT_PRIMARY}}a{color:${BRAND_BLUE};text-decoration:none;font-weight:500}a:hover{text-decoration:underline}h1,h2{margin-bottom:14px;letter-spacing:-0.02em}h2{margin-top:28px}p,li{line-height:1.6;color:${TEXT_SECONDARY};font-size:15px}ul{margin-left:22px;margin-top:8px}`}</style>
      <div style={{maxWidth:680,margin:"0 auto"}}>
        <a href="/" style={{fontSize:14,color:TEXT_SECONDARY}}>← zurück zur App</a>
        <h1 style={{marginTop:24,fontSize:34,fontWeight:700,background:`linear-gradient(135deg,${BRAND_BLUE},${BRAND_ROSE})`,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",letterSpacing:"-0.03em"}}>Datenschutzerklärung</h1>
        <p style={{fontSize:14,color:TEXT_TERTIARY,marginTop:6}}>Beleg-Scanner · Stand Mai 2026</p>

        <h2 style={{fontSize:20,fontWeight:600,color:TEXT_PRIMARY}}>Verantwortlicher</h2>
        <p>NoLimitCA<br/>Jasmin Labrenz<br/>An der Varreler Bäke 49 a<br/>28259 Bremen, Deutschland<br/>E-Mail: <a href="mailto:jasmin@jasminlabrenz.com">jasmin@jasminlabrenz.com</a></p>

        <h2 style={{fontSize:20,fontWeight:600,color:TEXT_PRIMARY}}>Welche Daten verarbeiten wir</h2>
        <p>Beleg-Scanner ist eine reine Browser-Anwendung. Wir betreiben keine eigene Datenbank und speichern keine personenbezogenen Daten auf eigenen Servern.</p>

        <h2 style={{fontSize:20,fontWeight:600,color:TEXT_PRIMARY}}>Beim Login mit Google</h2>
        <p>Wenn du dich mit deinem Google-Konto anmeldest, übermittelt Google deinen Namen und einen Zugriffstoken an die App. Beides wird ausschließlich lokal in deinem Browser gespeichert (im sogenannten localStorage). Mit „Abmelden" werden diese Daten gelöscht.</p>

        <h2 style={{fontSize:20,fontWeight:600,color:TEXT_PRIMARY}}>Beim Hochladen von Belegen</h2>
        <p>Die fotografierten oder hochgeladenen Belege werden direkt von deinem Browser an Google Drive übertragen — in einen Ordner, auf den dir Zugriff gewährt wurde. Wir leiten diese Dateien nicht über eigene Server.</p>

        <h2 style={{fontSize:20,fontWeight:600,color:TEXT_PRIMARY}}>Berechtigungen</h2>
        <p>Die App nutzt ausschließlich den Google-Drive-Scope <code style={{background:SURFACE_SECONDARY,padding:"2px 7px",borderRadius:6,fontSize:13,color:TEXT_PRIMARY}}>drive.file</code>. Damit kann sie nur Dateien sehen und ändern, die sie selbst über dich angelegt hat. Sie hat keinen Zugriff auf andere Inhalte deines Drives.</p>

        <h2 style={{fontSize:20,fontWeight:600,color:TEXT_PRIMARY}}>Drittanbieter</h2>
        <ul>
          <li>Google LLC, 1600 Amphitheatre Parkway, Mountain View, CA 94043, USA — für OAuth-Login und Drive-Speicherung.</li>
          <li>Vercel Inc., 340 S Lemon Ave #4133, Walnut, CA 91789, USA — Hosting der Anwendung.</li>
        </ul>

        <h2 style={{fontSize:20,fontWeight:600,color:TEXT_PRIMARY}}>Cookies</h2>
        <p>Wir setzen keine Cookies. Lokal gespeichert werden ausschließlich der Google-Zugriffstoken und dein Anzeigename — beides löschbar durch Logout oder Löschen der Browserdaten.</p>

        <h2 style={{fontSize:20,fontWeight:600,color:TEXT_PRIMARY}}>Deine Rechte</h2>
        <p>Du hast jederzeit das Recht auf Auskunft, Berichtigung, Löschung und Widerspruch nach DSGVO. Da wir selbst keine personenbezogenen Daten speichern, erfolgt die Datenlöschung primär durch Löschen deiner Drive-Dateien und der Browser-Daten.</p>

        <h2 style={{fontSize:20,fontWeight:600,color:TEXT_PRIMARY}}>Kontakt</h2>
        <p>Bei Fragen zum Datenschutz: <a href="mailto:jasmin@jasminlabrenz.com">jasmin@jasminlabrenz.com</a></p>

        <p style={{marginTop:40,fontSize:13,color:TEXT_TERTIARY}}>Stand: Mai 2026</p>
      </div>
    </div>
  );
}

// ============================================================
// ROUTER
// ============================================================
export default function App() {
  if (typeof window !== "undefined" && window.location.pathname === "/privacy") {
    return <PrivacyPolicy />;
  }
  return <BelegScanner />;
}

// ============================================================
// MAIN APP
// ============================================================
function BelegScanner() {
  const [tab, setTab] = useState(TAB.HOME);
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
  const todayIso = () => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}-${String(n.getDate()).padStart(2,"0")}`;
  };
  const defaultMeta = () => ({ datum: todayIso(), zahlung: "bar", isBewirtung: false, anlass: "", personen: "" });
  const updateFileMeta = (id, patch) => setFiles(p => p.map(f => f.id === id ? { ...f, ...patch } : f));

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
    setFiles(p => [...p, { id: Date.now(), name: `${kat}_${ts()}.jpg`, dataUrl: du, type: "image/jpeg", size: Math.round(du.length * 0.75), kat, ...defaultMeta() }]);
    stopCam(); setTab(TAB.PREVIEW);
  };

  // ========== FILE UPLOAD ==========
  const addFiles = (fl) => {
    Array.from(fl).forEach(f => {
      const r = new FileReader();
      r.onload = e => setFiles(p => [...p, { id: Date.now() + Math.random(), name: f.name, dataUrl: e.target.result, type: f.type, size: f.size, kat, ...defaultMeta() }]);
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
    const res = [];

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      setUploadProgress(Math.round(((i) / files.length) * 100));
      try {
        const monthFolder = folderForDate(f.datum);
        if (!monthFolder) {
          throw new Error(`Kein Ordner für ${f.datum || "(leeres Datum)"} — Datum prüfen`);
        }
        const monatsName = monthFolder.name;
        const subName = f.zahlung === "bank" ? "Bank" : "Bar";
        const targetFolderId = await getOrCreateSubfolder(token, monthFolder.id, subName);

        let uploadedName;
        if (f.isBewirtung) {
          const pdfBlob = await generateBewirtungsPDF(f);
          const stichwort = slugify(f.anlass) || slugify(f.personen) || "beleg";
          uploadedName = `Bewirtung_${f.datum || "ohne-datum"}_${stichwort}.pdf`;
          await uploadBlobToDrive(token, uploadedName, pdfBlob, "application/pdf", targetFolderId);
        } else {
          const base64 = f.dataUrl.split(",")[1];
          const ext = f.type === "application/pdf" ? "pdf" : (f.type.includes("png") ? "png" : "jpg");
          uploadedName = `${f.kat}_${f.datum || "ohne-datum"}_${String(f.id).slice(-4)}.${ext}`;
          await uploadFileToDrive(token, uploadedName, base64, f.type, targetFolderId);
        }
        res.push({ id: f.id, name: uploadedName, folder: `${monatsName} / ${subName}`, ok: true, msg: "Erfolgreich hochgeladen" });
      } catch (e) {
        res.push({ id: f.id, name: f.name, ok: false, msg: e.message });
        if (e.message.includes("abgelaufen")) { setAuthed(false); break; }
      }
    }

    setUploadProgress(100);
    setResults(res);
    const ok = res.filter(r => r.ok);
    if (ok.length) {
      setHistory(p => [...ok.map(r => ({ name: r.name, folder: r.folder, ts: new Date().toLocaleString("de-DE") })), ...p]);
    }
    setUploading(false);
  };

  const rmFile = id => setFiles(p => p.filter(f => f.id !== id));
  const clearAll = () => { setFiles([]); setResults([]); setTab(TAB.HOME); };
  const logout = () => { clearAccessToken(); setAuthed(false); setUserName(""); localStorage.removeItem("gdrive_user"); };

  useEffect(() => () => { if (stream) stream.getTracks().forEach(t => t.stop()); }, [stream]);

  const needsSetup = !GOOGLE_CLIENT_ID;

  return (
    <div style={{ minHeight: "100vh", background: "#FFFFFF", fontFamily: APPLE_FONT, color: TEXT_PRIMARY, position: "relative", WebkitFontSmoothing: "antialiased", MozOsxFontSmoothing: "grayscale" }}>
      <style>{`
        @keyframes slideUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
        @keyframes fadeIn{from{opacity:0}to{opacity:1}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(115,113,252,0.28)}70%{box-shadow:0 0 0 14px rgba(115,113,252,0)}100%{box-shadow:0 0 0 0 rgba(115,113,252,0)}}
        @keyframes dragPulse{0%,100%{border-color:rgba(115,113,252,0.35)}50%{border-color:rgba(115,113,252,0.8)}}
        @keyframes progressBar{from{width:0}to{width:100%}}
        *{box-sizing:border-box;margin:0;padding:0}
        body{background:#FFFFFF;color:${TEXT_PRIMARY}}
        input,select,button,textarea{font-family:${APPLE_FONT};-webkit-font-smoothing:antialiased}
        ::-webkit-scrollbar{width:6px;height:6px}
        ::-webkit-scrollbar-thumb{background:rgba(0,0,0,0.15);border-radius:6px}
        ::-webkit-scrollbar-thumb:hover{background:rgba(0,0,0,0.25)}
      `}</style>

      <div style={{ position:"relative", zIndex:1, maxWidth:500, margin:"0 auto", padding:"10px 16px 36px" }}>

        {/* HEADER */}
        <div style={{ textAlign:"center", padding:"32px 0 14px", animation:"slideUp 0.5s ease-out" }}>
          <div style={{ display:"inline-flex", alignItems:"center", gap:10 }}>
            <span style={{fontSize:26}}>📸</span>
            <span style={{ fontSize:28, fontWeight:700, letterSpacing:"-0.025em", background:`linear-gradient(135deg,${BRAND_BLUE},${BRAND_ROSE})`, WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>Beleg-Scanner</span>
          </div>
          <p style={{ marginTop:10, fontSize:14, color:TEXT_SECONDARY, fontWeight:400, letterSpacing:"-0.01em" }}>
            Fotografieren · Hochladen · Google Drive
          </p>
        </div>

        {/* AUTH BAR */}
        {!needsSetup && (
          <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:8, padding:"4px 0 18px", animation:"fadeIn 0.5s ease-out 0.1s both" }}>
            {authed ? (
              <div style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 14px", borderRadius:100, background:SURFACE_SECONDARY }}>
                <div style={{ width:7, height:7, borderRadius:"50%", background:"#34c759" }} />
                <span style={{ fontSize:12.5, color:TEXT_SECONDARY, fontWeight:500 }}>
                  {userName ? userName : "Mit Google verbunden"}
                </span>
                <button onClick={logout} style={{ background:"none", border:"none", cursor:"pointer", padding:"2px 4px", marginLeft:2, color:TEXT_TERTIARY, fontSize:11, fontWeight:500 }}>
                  Abmelden
                </button>
              </div>
            ) : (
              <button onClick={startGoogleAuth} style={{
                display:"flex", alignItems:"center", gap:10,
                padding:"12px 22px", borderRadius:12,
                background:SURFACE_PRIMARY, border:`1px solid ${BORDER_MEDIUM}`,
                color:TEXT_PRIMARY, fontSize:14, fontWeight:500, cursor:"pointer",
                boxShadow:SHADOW_SOFT, transition:"all 0.15s",
              }}>
                <Icon name="google" size={18} /> Mit Google anmelden
              </button>
            )}
          </div>
        )}

        {/* MAIN CARD */}
        <div style={{ background:SURFACE_PRIMARY, border:`1px solid ${BORDER_SUBTLE}`, borderRadius:20, overflow:"hidden", animation:"slideUp 0.6s ease-out 0.06s both", boxShadow:SHADOW_SOFT }}>

          {/* ====== SETUP NEEDED ====== */}
          {needsSetup && tab !== TAB.SETUP && (
            <div style={{ padding: 32, textAlign: "center" }}>
              <div style={{ fontSize: 44, marginBottom: 18 }}>⚙️</div>
              <p style={{ fontSize: 17, fontWeight: 600, color: TEXT_PRIMARY, marginBottom: 8, letterSpacing:"-0.01em" }}>
                Einrichtung erforderlich
              </p>
              <p style={{ fontSize: 14, color: TEXT_SECONDARY, lineHeight: 1.5, marginBottom: 22 }}>
                Du brauchst eine Google Cloud Client ID, damit die App auf Google Drive zugreifen kann.
              </p>
              <button onClick={() => setTab(TAB.SETUP)} style={{ ...btnP, width: "100%" }}>
                <Icon name="settings" size={18} /> Einrichtung starten
              </button>
            </div>
          )}

          {/* ====== SETUP PAGE ====== */}
          {tab === TAB.SETUP && (
            <div style={{ padding: 24, animation: "slideUp 0.3s ease-out" }}>
              <label style={lbl}>So richtest du die App ein</label>
              <div style={{ marginTop: 14, fontSize: 14, color: TEXT_SECONDARY, lineHeight: 1.7 }}>
                <p><strong style={{ color: BRAND_BLUE }}>1.</strong> Gehe zu <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer" style={{ color: BRAND_BLUE, textDecoration:"none", fontWeight:500 }}>Google Cloud Console</a></p>
                <p><strong style={{ color: BRAND_BLUE }}>2.</strong> Erstelle ein neues Projekt oder wähle ein bestehendes</p>
                <p><strong style={{ color: BRAND_BLUE }}>3.</strong> Aktiviere die „Google Drive API"</p>
                <p><strong style={{ color: BRAND_BLUE }}>4.</strong> Erstelle unter „Credentials" eine „OAuth 2.0 Client ID" (Typ: Web Application)</p>
                <p><strong style={{ color: BRAND_BLUE }}>5.</strong> Füge als Redirect URI hinzu: <code style={{ background: SURFACE_SECONDARY, padding: "2px 6px", borderRadius: 4, fontSize: 12, color:TEXT_PRIMARY }}>{window.location.origin}/</code></p>
                <p><strong style={{ color: BRAND_BLUE }}>6.</strong> Kopiere die Client ID</p>
                <p><strong style={{ color: BRAND_BLUE }}>7.</strong> Setze sie in Vercel als Umgebungsvariable: <code style={{ background: SURFACE_SECONDARY, padding: "2px 6px", borderRadius: 4, fontSize: 12, color:TEXT_PRIMARY }}>VITE_GOOGLE_CLIENT_ID</code></p>
              </div>
              <button onClick={() => setTab(TAB.HOME)} style={{ ...btnO, width: "100%", marginTop: 22 }}>Zurück</button>
            </div>
          )}

          {/* ====== HOME ====== */}
          {!needsSetup && tab === TAB.HOME && (
            <div style={{ padding: 24 }}>
              <label style={lbl}>Kategorie</label>
              <div style={{display:"flex",flexWrap:"wrap",gap:7,marginTop:8}}>
                {KATEGORIEN.map(k=>(
                  <button key={k} onClick={()=>setKat(k)} style={{
                    padding:"8px 16px",borderRadius:100,fontSize:13,fontWeight:500,cursor:"pointer",transition:"all 0.15s",
                    border:kat===k?`1px solid ${BRAND_BLUE}`:`1px solid ${BORDER_SUBTLE}`,
                    background:kat===k?BRAND_BLUE:SURFACE_PRIMARY,
                    color:kat===k?"#FFFFFF":TEXT_SECONDARY,
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
                  marginTop:22,padding:"32px 16px",
                  border:dragOver?`2px solid ${BRAND_BLUE}`:`2px dashed ${BORDER_MEDIUM}`,
                  borderRadius:16,textAlign:"center",cursor:"pointer",
                  background:dragOver?"rgba(115,113,252,0.04)":SURFACE_TERTIARY,
                  transition:"all 0.2s",animation:dragOver?"dragPulse 1.2s infinite":"none",
                }}
              >
                <div style={{marginBottom:10}}><Icon name="upload" size={28} color={dragOver?BRAND_BLUE:TEXT_TERTIARY}/></div>
                <p style={{fontSize:15,fontWeight:600,color:dragOver?BRAND_BLUE:TEXT_PRIMARY,letterSpacing:"-0.01em"}}>
                  {dragOver?"Hier ablegen":"Dateien hierher ziehen"}
                </p>
                <p style={{fontSize:13,color:TEXT_SECONDARY,marginTop:4}}>oder tippen · JPG, PNG, PDF</p>
              </div>
              <input ref={fileRef} type="file" accept="image/*,.pdf" multiple onChange={onFileInput} style={{display:"none"}}/>

              {/* Camera button */}
              <button onClick={startCam} style={{...btnP,width:"100%",marginTop:14}}>
                <Icon name="camera" size={18}/> Beleg fotografieren
              </button>

              {/* Queue badge */}
              {files.length > 0 && (
                <button onClick={()=>setTab(TAB.PREVIEW)} style={{
                  width:"100%",marginTop:10,padding:"14px 16px",borderRadius:12,cursor:"pointer",
                  background:SURFACE_SECONDARY,border:"none",
                  display:"flex",alignItems:"center",gap:10,color:BRAND_BLUE,fontSize:14,fontWeight:600,
                  transition:"all 0.15s",
                }}>
                  <Icon name="file" size={16} color={BRAND_BLUE}/>
                  {files.length} {files.length===1?"Beleg":"Belege"} bereit zum Hochladen
                  <span style={{marginLeft:"auto",fontSize:14,color:TEXT_TERTIARY}}>›</span>
                </button>
              )}

              {err && (
                <div style={{marginTop:12,padding:"12px 14px",borderRadius:12,background:"#fef0f0",border:"1px solid #ffc8c8",fontSize:13,color:"#c8202b",display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}}>
                  <span>{err}</span>
                  <button onClick={()=>setErr("")} style={{background:"none",border:"none",color:"#c8202b",fontWeight:600,cursor:"pointer",fontSize:12}}>OK</button>
                </div>
              )}

              {/* History */}
              {history.length>0&&(
                <div style={{marginTop:26}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <label style={lbl}>Letzte Uploads</label>
                    <button onClick={()=>{setHistory([]);localStorage.removeItem("beleg_history")}} style={{background:"none",border:"none",color:TEXT_TERTIARY,fontSize:12,cursor:"pointer",fontWeight:500}}>Leeren</button>
                  </div>
                  <div style={{marginTop:10,display:"flex",flexDirection:"column",gap:6}}>
                    {history.slice(0,8).map((h,i)=>(
                      <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",borderRadius:12,background:SURFACE_TERTIARY,border:`1px solid ${BORDER_SUBTLE}`}}>
                        <div style={{width:30,height:30,borderRadius:8,background:"rgba(115,113,252,0.1)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                          <Icon name="check" size={14} color={BRAND_BLUE}/>
                        </div>
                        <div style={{flex:1,minWidth:0}}>
                          <p style={{fontSize:13,fontWeight:500,color:TEXT_PRIMARY,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{h.name}</p>
                          <p style={{fontSize:11.5,color:TEXT_SECONDARY,marginTop:1}}>{h.folder} · {h.ts}</p>
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
              <div style={{position:"absolute",inset:26,border:"2px solid rgba(255,255,255,0.4)",borderRadius:18,pointerEvents:"none"}}>
                {[{t:-2,l:-2,bT:`3px solid ${BRAND_BLUE}`,bL:`3px solid ${BRAND_BLUE}`},{t:-2,r:-2,bT:`3px solid ${BRAND_BLUE}`,bR:`3px solid ${BRAND_BLUE}`},{b:-2,l:-2,bB:`3px solid ${BRAND_ROSE}`,bL:`3px solid ${BRAND_ROSE}`},{b:-2,r:-2,bB:`3px solid ${BRAND_ROSE}`,bR:`3px solid ${BRAND_ROSE}`}].map((s,i)=>(
                  <div key={i} style={{position:"absolute",width:22,height:22,borderRadius:3,top:s.t,left:s.l,right:s.r,bottom:s.b,borderTop:s.bT,borderLeft:s.bL,borderRight:s.bR,borderBottom:s.bB}}/>
                ))}
              </div>
              <p style={{position:"absolute",top:14,width:"100%",textAlign:"center",fontSize:13,color:"#FFFFFF",fontWeight:500,textShadow:"0 1px 8px rgba(0,0,0,0.8)"}}>Beleg im Rahmen positionieren</p>
              <div style={{position:"absolute",bottom:0,left:0,right:0,padding:"24px",background:"linear-gradient(transparent,rgba(0,0,0,0.88))",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <button onClick={()=>{stopCam();setTab(TAB.HOME)}} style={camB}><Icon name="x" size={20}/></button>
                <button onClick={snap} style={{width:72,height:72,borderRadius:"50%",background:"#FFFFFF",border:`4px solid ${BRAND_BLUE}`,cursor:"pointer",boxShadow:"0 4px 24px rgba(115,113,252,0.5)"}}/>
                <button onClick={flipCam} style={camB}><Icon name="flip" size={18}/></button>
              </div>
              <canvas ref={canRef} style={{display:"none"}}/>
            </div>
          )}

          {/* ====== PREVIEW / QUEUE ====== */}
          {tab===TAB.PREVIEW&&(
            <div style={{animation:"slideUp 0.3s ease-out"}}>
              <div style={{padding:24}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <button onClick={()=>setTab(TAB.HOME)} style={{background:"none",border:"none",cursor:"pointer",color:TEXT_SECONDARY,padding:4,display:"flex",alignItems:"center"}}><Icon name="back" size={20}/></button>
                    <label style={{...lbl,margin:0}}>{files.length} {files.length===1?"Beleg":"Belege"}</label>
                  </div>
                  <button onClick={()=>fileRef.current?.click()} style={{background:"none",border:"none",color:BRAND_BLUE,fontSize:14,fontWeight:500,cursor:"pointer",display:"flex",alignItems:"center",gap:4}}>
                    <Icon name="plus" size={16} color={BRAND_BLUE}/> Weitere
                  </button>
                  <input ref={fileRef} type="file" accept="image/*,.pdf" multiple onChange={onFileInput} style={{display:"none"}}/>
                </div>

                <div style={{marginTop:14,display:"flex",flexDirection:"column",gap:12,maxHeight:440,overflowY:"auto",paddingRight:4,marginRight:-4}}>
                  {files.map(f=>(
                    <div key={f.id} style={{padding:14,borderRadius:14,background:SURFACE_TERTIARY,border:`1px solid ${BORDER_SUBTLE}`}}>
                      <div style={{display:"flex",alignItems:"center",gap:11}}>
                        {f.type.startsWith("image/")&&f.dataUrl?(
                          <img src={f.dataUrl} alt="" style={{width:48,height:48,borderRadius:10,objectFit:"cover"}}/>
                        ):(
                          <div style={{width:48,height:48,borderRadius:10,background:"rgba(115,113,252,0.1)",display:"flex",alignItems:"center",justifyContent:"center"}}><Icon name="file" size={20} color={BRAND_BLUE}/></div>
                        )}
                        <div style={{flex:1,minWidth:0}}>
                          <input value={f.name} onChange={e=>updateFileMeta(f.id,{name:e.target.value})} style={{
                            width:"100%",background:"transparent",border:"none",borderBottom:`1px solid ${BORDER_SUBTLE}`,color:TEXT_PRIMARY,fontSize:13.5,fontWeight:500,padding:"3px 0",outline:"none",
                          }}/>
                          <p style={{fontSize:11.5,color:TEXT_SECONDARY,marginTop:3}}>{f.kat} · {f.size>0?`${(f.size/1024).toFixed(0)} KB`:""}</p>
                        </div>
                        <button onClick={()=>rmFile(f.id)} style={{background:"none",border:"none",cursor:"pointer",padding:6,color:TEXT_TERTIARY,display:"flex",alignItems:"center"}}>
                          <Icon name="trash" size={16}/>
                        </button>
                      </div>

                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginTop:14}}>
                        <div>
                          <label style={{...lbl,fontSize:11}}>Datum</label>
                          <input type="date" value={f.datum||""} onChange={e=>updateFileMeta(f.id,{datum:e.target.value})} style={miniInput}/>
                        </div>
                        <div>
                          <label style={{...lbl,fontSize:11}}>Zahlung</label>
                          <div style={{display:"flex",gap:6,marginTop:6}}>
                            {["bar","bank"].map(z=>(
                              <button key={z} onClick={()=>updateFileMeta(f.id,{zahlung:z})} style={{
                                flex:1,padding:"8px 6px",borderRadius:10,fontSize:12.5,fontWeight:500,cursor:"pointer",
                                border:f.zahlung===z?`1px solid ${BRAND_BLUE}`:`1px solid ${BORDER_SUBTLE}`,
                                background:f.zahlung===z?BRAND_BLUE:SURFACE_PRIMARY,
                                color:f.zahlung===z?"#FFFFFF":TEXT_SECONDARY,
                                transition:"all 0.15s",
                              }}>{z==="bar"?"Bar":"Bank/Karte"}</button>
                            ))}
                          </div>
                        </div>
                      </div>

                      <label style={{display:"flex",alignItems:"center",gap:9,marginTop:14,cursor:"pointer",userSelect:"none"}}>
                        <input type="checkbox" checked={!!f.isBewirtung} onChange={e=>updateFileMeta(f.id,{isBewirtung:e.target.checked})} style={{accentColor:BRAND_ROSE,width:16,height:16}}/>
                        <span style={{fontSize:13,fontWeight:500,color:f.isBewirtung?BRAND_ROSE:TEXT_PRIMARY}}>Bewirtungsbeleg (mit Pflichtangaben)</span>
                      </label>

                      {f.isBewirtung && (
                        <div style={{marginTop:10,padding:12,borderRadius:12,background:"rgba(252,96,168,0.05)",border:`1px solid rgba(252,96,168,0.18)`}}>
                          <label style={{...lbl,fontSize:11}}>Anlass / Grund der Bewirtung</label>
                          <input value={f.anlass||""} onChange={e=>updateFileMeta(f.id,{anlass:e.target.value})} placeholder="z.B. Geschäftsessen Projektabstimmung" style={miniInput}/>
                          <label style={{...lbl,fontSize:11,marginTop:11}}>Bewirtete Personen</label>
                          <textarea value={f.personen||""} onChange={e=>updateFileMeta(f.id,{personen:e.target.value})} placeholder="z.B. Max Mustermann (Firma X), Erika Müller (Firma Y)" rows={2} style={{...miniInput,resize:"vertical",minHeight:52,fontFamily:"inherit"}}/>
                          <p style={{fontSize:11.5,color:TEXT_SECONDARY,marginTop:7,lineHeight:1.5}}>Tag der Bewirtung = Beleg-Datum oben. Wird als PDF mit Pflichtangaben + Foto in Drive abgelegt.</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>


                {/* Upload progress */}
                {uploading && (
                  <div style={{ marginTop: 14 }}>
                    <div style={{ height: 6, borderRadius: 3, background: SURFACE_SECONDARY, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${uploadProgress}%`, background: `linear-gradient(90deg, ${BRAND_BLUE}, ${BRAND_ROSE})`, borderRadius: 3, transition: "width 0.3s" }} />
                    </div>
                    <p style={{ fontSize: 12, color: TEXT_SECONDARY, marginTop: 6, textAlign: "center" }}>{uploadProgress}%</p>
                  </div>
                )}

                {results.length>0&&(
                  <div style={{marginTop:14,display:"flex",flexDirection:"column",gap:6}}>
                    {results.map(r=>(
                      <div key={r.id} style={{padding:"11px 13px",borderRadius:12,background:r.ok?"rgba(115,113,252,0.06)":"#fef0f0",border:`1px solid ${r.ok?"rgba(115,113,252,0.18)":"#ffc8c8"}`,display:"flex",alignItems:"center",gap:9}}>
                        <Icon name={r.ok?"check":"x"} size={16} color={r.ok?BRAND_BLUE:"#c8202b"}/>
                        <div><p style={{fontSize:13,fontWeight:500,color:TEXT_PRIMARY}}>{r.name}</p><p style={{fontSize:11.5,color:TEXT_SECONDARY,marginTop:1}}>{r.msg}</p></div>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{display:"flex",gap:10,marginTop:18}}>
                  <button onClick={clearAll} style={{...btnO,flex:1}}>{results.length?"Fertig":"Verwerfen"}</button>
                  {!results.length&&(
                    <button onClick={uploadAll} disabled={uploading||!files.length||!authed} style={{...btnP,flex:2,opacity:(uploading||!authed)?0.55:1,cursor:(uploading||!authed)?"not-allowed":"pointer"}}>
                      {uploading?<Spinner size={18}/>:<Icon name="upload" size={17}/>}
                      {uploading?"Lädt hoch …":!authed?"Erst einloggen":`${files.length} hochladen`}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* FOOTER */}
        <p style={{ textAlign: "center", marginTop: 26, fontSize: 12, color: TEXT_TERTIARY, animation: "fadeIn 0.6s ease-out 0.4s both" }}>
          Deine Belege, sicher in Google Drive
        </p>
        <p style={{ textAlign: "center", marginTop: 6, fontSize: 12 }}>
          <a href="/privacy" style={{color:BRAND_BLUE,textDecoration:"none",fontWeight:500}}>Datenschutz</a>
        </p>
      </div>
    </div>
  );
}

const lbl={display:"block",fontSize:11,fontWeight:600,color:TEXT_SECONDARY,letterSpacing:"-0.005em"};
const sel={width:"100%",marginTop:8,padding:"11px 38px 11px 14px",background:SURFACE_PRIMARY,border:`1px solid ${BORDER_SUBTLE}`,borderRadius:11,color:TEXT_PRIMARY,fontSize:14,outline:"none",cursor:"pointer",appearance:"none",backgroundImage:`url("data:image/svg+xml,%3Csvg width='12' height='8' viewBox='0 0 12 8' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L6 6L11 1' stroke='%237371FC' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,backgroundRepeat:"no-repeat",backgroundPosition:"right 14px center"};
const btnP={padding:"14px 18px",borderRadius:12,background:BRAND_BLUE,border:"none",color:"#FFFFFF",fontSize:15,fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8,transition:"all 0.15s",letterSpacing:"-0.01em",boxShadow:"0 1px 2px rgba(115,113,252,0.2), 0 4px 14px rgba(115,113,252,0.22)"};
const btnO={padding:"14px",borderRadius:12,background:SURFACE_SECONDARY,border:"none",color:TEXT_PRIMARY,fontSize:14.5,fontWeight:500,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:7,transition:"all 0.15s",letterSpacing:"-0.005em"};
const camB={width:46,height:46,borderRadius:"50%",background:"rgba(255,255,255,0.15)",border:"1px solid rgba(255,255,255,0.25)",color:"#FFFFFF",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(8px)",WebkitBackdropFilter:"blur(8px)"};
const miniInput={width:"100%",marginTop:6,padding:"9px 12px",background:SURFACE_PRIMARY,border:`1px solid ${BORDER_SUBTLE}`,borderRadius:10,color:TEXT_PRIMARY,fontSize:13.5,outline:"none",transition:"border-color 0.15s",fontFamily:APPLE_FONT};
