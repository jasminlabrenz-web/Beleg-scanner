# 📸 Beleg-Scanner

Belege fotografieren oder hochladen → automatisch in Google Drive.

## 🚀 Deployment auf Vercel (kostenlos)

### Schritt 1: Google Cloud einrichten

1. Gehe zu [Google Cloud Console](https://console.cloud.google.com/)
2. Erstelle ein neues Projekt (z.B. "Beleg-Scanner")
3. Gehe zu **APIs & Services → Library** und aktiviere die **Google Drive API**
4. Gehe zu **APIs & Services → Credentials**
5. Klicke **+ CREATE CREDENTIALS → OAuth 2.0 Client ID**
6. Wähle **Web Application**
7. Unter **Authorized redirect URIs** füge hinzu:
   - `http://localhost:5173/` (zum Testen)
   - `https://deine-app.vercel.app/` (nach Deployment)
8. Kopiere die **Client ID**

### Schritt 2: Auf Vercel deployen

1. Gehe zu [vercel.com](https://vercel.com) und erstelle einen Account
2. Klicke **"Add New Project"**
3. Lade den gesamten `beleg-scanner` Ordner hoch (oder verbinde dein GitHub-Repo)
4. Unter **Environment Variables** füge hinzu:
   - `VITE_GOOGLE_CLIENT_ID` = deine Google Client ID
5. Klicke **Deploy**
6. Deine App ist jetzt online! 🎉

### Schritt 3: Google Redirect URI aktualisieren

1. Gehe zurück zur Google Cloud Console → Credentials
2. Füge deine neue Vercel-URL als Redirect URI hinzu:
   - `https://beleg-scanner-xxxxx.vercel.app/`
3. Speichern

### Schritt 4: Link an Kundin geben

Schicke deiner Kundin einfach die Vercel-URL. Sie muss:
1. Den Link öffnen (funktioniert am Handy und PC)
2. Sich mit ihrem Google-Account anmelden
3. Belege fotografieren oder hochladen
4. Die Belege landen automatisch im gewählten Drive-Ordner

**Tipp:** Am Handy kann sie die Seite zum Homescreen hinzufügen — dann öffnet sie sich wie eine App.

## 📱 Features

- **Kamera**: Beleg direkt fotografieren (Rück- & Frontkamera)
- **Drag & Drop**: Dateien vom Mac/PC reinziehen
- **Datei-Upload**: JPG, PNG, PDF hochladen
- **Kategorien**: Rechnung, Quittung, Vertrag, Kontoauszug, Sonstiges
- **Upload-Historie**: Sieht welche Belege schon hochgeladen wurden
- **PWA**: Installierbar als App auf dem Homescreen
- **Kein Login nötig außer Google**: Keine extra Accounts

## 🔧 Lokal testen

```bash
npm install
npm run dev
```

Erstelle eine `.env` Datei:
```
VITE_GOOGLE_CLIENT_ID=deine-client-id.apps.googleusercontent.com
```

## 📁 Ordner anpassen

In `src/App.jsx` findest du oben die `DEFAULT_FOLDERS` Variable. Ändere die Ordner-IDs auf die Google Drive Ordner deiner Kundin:

```js
const DEFAULT_FOLDERS = [
  { id: "ORDNER-ID-HIER", name: "Belege 2026" },
  // ...
];
```

Die Ordner-ID findest du in der Google Drive URL:
`https://drive.google.com/drive/folders/DIESE-ID-HIER`
