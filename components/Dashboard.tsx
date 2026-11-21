"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import Papa from "papaparse";
import {
  Activity, ArrowDownToLine, ArrowUpRight, BadgeCheck, Check, CheckCircle2,
  ChefHat, ChevronRight, CircleAlert, ClipboardList, Download, FileSpreadsheet,
  Home, LogOut, Mail, Menu, Plus, QrCode, RefreshCw, Search, ShieldCheck, Sparkles,
  Upload, Users, Utensils, Vegan, X, XCircle,
} from "lucide-react";
import QRScanner from "@/components/QRScanner";
import { normalizeAttendeeCsvHeader } from "@/lib/validation";

type View = "overview" | "entry" | "food" | "attendees";
type Summary = {
  total: number; checkedIn: number; notCheckedIn: number; expectedVeg: number; expectedNonVeg: number;
  remainingVeg: number; remainingNonVeg: number; mealsCollected: number; pendingMeals: number;
  mealsVeg: number; mealsNonVeg: number; checkInRate: number;
  targetPopulation: number; remainingRegistrations: number; lastSuccessfulSyncAt: string | null;
  newRegistrationsSinceLastSync: number; synchronizationErrors: number;
  emailDelivery: { sent: number; pending: number; failed: number };
  syncIntegrationAvailable: boolean; syncIntegrationError: string | null;
};
type SyncSettings = {
  automatic_email_enabled: boolean;
  email_on_existing_change: boolean;
  updated_at: string;
  emailConfigured: boolean;
  syncSchemaAvailable: boolean;
  setupError?: string;
};
type Attendee = {
  id: string; pass_token: string; name: string; roll_number: string | null; email: string | null; branch: string | null;
  preference: "VEG" | "NON_VEG"; source: string; checked_in_at: string | null;
  meal_collected_at: string | null; created_at: string;
};
type ScanResponse = {
  status: string; message?: string;
  reservationToken?: string;
  attendee?: Pick<Attendee, "pass_token" | "name" | "roll_number" | "branch" | "preference" | "checked_in_at" | "meal_collected_at">;
  error?: string;
};

const zeroSummary: Summary = {
  total: 0, checkedIn: 0, notCheckedIn: 0, expectedVeg: 0, expectedNonVeg: 0,
  remainingVeg: 0, remainingNonVeg: 0, mealsCollected: 0, pendingMeals: 0,
  mealsVeg: 0, mealsNonVeg: 0, checkInRate: 0, targetPopulation: 380,
  remainingRegistrations: 380, lastSuccessfulSyncAt: null, newRegistrationsSinceLastSync: 0,
  synchronizationErrors: 0, emailDelivery: { sent: 0, pending: 0, failed: 0 },
  syncIntegrationAvailable: false, syncIntegrationError: null,
};

function formatTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatSyncTime(value: string | null) {
  if (!value) return "No successful sync yet";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function Dashboard() {
  const [view, setView] = useState<View>("overview");
  const [authenticated, setAuthenticated] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [pin, setPin] = useState("");
  const [loginError, setLoginError] = useState("");
  const [summary, setSummary] = useState<Summary>(zeroSummary);
  const [syncSettings, setSyncSettings] = useState<SyncSettings | null>(null);
  const [savingSyncSettings, setSavingSyncSettings] = useState(false);
  const [retryingEmails, setRetryingEmails] = useState(false);
  const [sendingPasses, setSendingPasses] = useState(false);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [search, setSearch] = useState("");
  const [scanResult, setScanResult] = useState<ScanResponse | null>(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [noticeIsError, setNoticeIsError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [importIssues, setImportIssues] = useState<{ row: number; reason: string }[]>([]);
  const noticeTimer = useRef<number | null>(null);
  const [newAttendee, setNewAttendee] = useState({ name: "", roll_number: "", branch: "", email: "", preference: "VEG" as "VEG" | "NON_VEG" });

  const refreshSummary = useCallback(async () => {
    const response = await fetch("/api/admin/summary", { cache: "no-store" });
    if (response.status === 401) {
      setAuthenticated(false);
      return false;
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load summary.");
    setSummary(data);
    setAuthenticated(true);
    return true;
  }, []);

  const refreshSyncSettings = useCallback(async () => {
    const response = await fetch("/api/admin/sync-settings", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load email settings.");
    setSyncSettings(data);
  }, []);

  const loadAttendees = useCallback(async (query = "", signal?: AbortSignal) => {
    const response = await fetch(`/api/admin/attendees${query ? `?q=${encodeURIComponent(query)}` : ""}`, { cache: "no-store", signal });
    if (response.status === 401) {
      setAuthenticated(false);
      throw new Error("Staff session expired. Sign in again.");
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load attendees.");
    setAttendees(data.attendees ?? []);
  }, []);

  useEffect(() => {
    let live = true;
    fetch("/api/admin/summary", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) return false;
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load dashboard.");
        if (live) { setSummary(data); setAuthenticated(true); }
        return true;
      })
      .catch((error) => { if (live) setLoginError(error instanceof Error ? error.message : "Server unavailable."); })
      .finally(() => { if (live) setCheckingSession(false); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (!authenticated || view !== "attendees") return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      loadAttendees(search, controller.signal)
        .catch((error) => {
          if (error.name !== "AbortError") {
            setNotice(error.message);
            setNoticeIsError(true);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [authenticated, view, search, loadAttendees]);

  useEffect(() => {
    if (!authenticated) return;
    const timer = window.setInterval(() => {
      void refreshSummary().catch((error) => {
        setNotice(error instanceof Error ? error.message : "Could not refresh dashboard.");
        setNoticeIsError(true);
      });
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [authenticated, view, refreshSummary]);

  useEffect(() => {
    if (!authenticated) return;
    void refreshSyncSettings().catch((error) => {
      setNotice(error instanceof Error ? error.message : "Could not load email settings.");
      setNoticeIsError(true);
    });
  }, [authenticated, refreshSyncSettings]);

  const flash = (message: string, isError = false) => {
    setNotice(message);
    setNoticeIsError(isError);
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => {
      setNotice("");
      noticeTimer.current = null;
    }, 4200);
  };

  useEffect(() => () => {
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
  }, []);

  const signIn = async (event: FormEvent) => {
    event.preventDefault();
    setLoginError("");
    setLoading(true);
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not sign in.");
      setAuthenticated(true);
      setPin("");
      await refreshSummary();
      flash("Staff session started.");
    } catch (error) { setLoginError(error instanceof Error ? error.message : "Could not sign in."); }
    finally { setLoading(false); setCheckingSession(false); }
  };

  const signOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setAuthenticated(false);
    setView("overview");
    setScanResult(null);
  };

  const navItems = [
    { id: "overview" as View, label: "Overview", icon: Home },
    { id: "entry" as View, label: "Entry check-in", icon: QrCode },
    { id: "food" as View, label: "Food counter", icon: Utensils },
    { id: "attendees" as View, label: "Attendees", icon: Users },
  ];

  const navigate = (next: View) => {
    setView(next);
    setMobileMenuOpen(false);
    setScanResult(null);
    if (next === "overview") void refreshSummary().catch((error) => flash(error.message, true));
  };

  const processScan = useCallback(async (code: string) => {
    if (scanBusy) return;
    setScanBusy(true);
    setScanResult(null);
    try {
      const response = await fetch("/api/admin/scan", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: view === "entry" ? "ENTRY" : "MEAL_PREVIEW", code }),
      });
      const data = await response.json() as ScanResponse;
      setScanResult(data);
      await refreshSummary();
    } catch (error) {
      setScanResult({ status: "ERROR", error: error instanceof Error ? error.message : "Scan failed." });
    } finally {
      setScanBusy(false);
    }
  }, [scanBusy, view, refreshSummary]);


  const confirmMeal = async () => {
    const token = scanResult?.attendee?.pass_token;
    const reservationToken = scanResult?.reservationToken;
    if (!token || !reservationToken || scanBusy) return;
    setScanBusy(true);
    try {
      const response = await fetch("/api/admin/scan", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "MEAL_CONFIRM", code: token, reservationToken }),
      });
      const data = await response.json() as ScanResponse;
      setScanResult(data);
      await refreshSummary();
    } catch (error) {
      flash(error instanceof Error ? `${error.message} Retry the confirmation.` : "Meal confirmation failed. Retry the confirmation.", true);
    } finally {
      setScanBusy(false);
    }
  };

  const cancelMeal = async () => {
    const token = scanResult?.attendee?.pass_token;
    const reservationToken = scanResult?.reservationToken;
    if (!token || !reservationToken || scanBusy) return;
    setScanBusy(true);
    try {
      const response = await fetch("/api/admin/scan", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "MEAL_CANCEL", code: token, reservationToken }),
      });
      const data = await response.json() as ScanResponse;
      setScanResult(data);
    } catch (error) {
      flash(error instanceof Error ? error.message : "Could not cancel meal reservation. Retry the cancellation.", true);
    } finally {
      setScanBusy(false);
    }
  };

  const addAttendee = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    try {
      const response = await fetch("/api/admin/attendees", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newAttendee),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not add attendee.");
      setNewAttendee({ name: "", roll_number: "", branch: "", email: "", preference: "VEG" });
      setShowAdd(false);
      await loadAttendees(search);
      await refreshSummary();
      const emailWarning = data.emailDeliveryError
        || (data.emailDelivery?.failed ? "Pass email failed; retry it from the email panel." : "");
      flash(emailWarning
        ? `Attendee added; QR pass is ready. ${emailWarning}`
        : "Attendee added. Their QR pass is ready in the attendee list.",
      Boolean(emailWarning));
    } catch (error) { flash(error instanceof Error ? error.message : "Could not add attendee.", true); }
    finally { setLoading(false); }
  };

  const saveSyncSettings = async (next: Pick<SyncSettings, "automatic_email_enabled" | "email_on_existing_change">) => {
    setSavingSyncSettings(true);
    try {
      const response = await fetch("/api/admin/sync-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save email settings.");
      setSyncSettings(data);
      flash("Email settings saved.");
    } catch (error) {
      flash(error instanceof Error ? error.message : "Could not save email settings.", true);
    } finally {
      setSavingSyncSettings(false);
    }
  };

  const retryFailedEmails = async () => {
    setRetryingEmails(true);
    try {
      const response = await fetch("/api/admin/emails/retry", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not retry failed emails.");
      await refreshSummary();
      flash(`Email retry finished: ${data.sent} sent, ${data.failed} failed.`, data.failed > 0);
    } catch (error) {
      flash(error instanceof Error ? error.message : "Could not retry failed emails.", true);
    } finally {
      setRetryingEmails(false);
    }
  };

  const sendPassEmails = async () => {
    if (!syncSettings?.emailConfigured) {
      flash("Configure a verified Resend sender and API key before sending QR passes.", true);
      return;
    }
    setSendingPasses(true);
    let sent = 0;
    let failed = 0;
    let remaining = 0;
    let recipientCount = 0;
    try {
      for (let batch = 0; batch < 20; batch++) {
        const response = await fetch("/api/admin/emails/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ retryFailed: batch === 0 }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not send QR passes.");
        sent += Number(data.sent || 0);
        failed += Number(data.failed || 0);
        recipientCount = Number(data.recipientCount || recipientCount);
        remaining = Number(data.remaining || 0);
        if (remaining === 0) break;
      }
      await Promise.all([refreshSummary(), loadAttendees(search)]);
      flash(`QR pass delivery: ${sent} sent, ${failed} failed. ${remaining ? `${remaining} still pending; click Send QR passes again to continue.` : `Recipients with email: ${recipientCount}.`}`, failed > 0 || remaining > 0);
    } catch (error) {
      flash(error instanceof Error ? error.message : "QR pass delivery failed.", true);
    } finally {
      setSendingPasses(false);
    }
  };

  const importCsv = async (file?: File) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      flash("CSV file is larger than 5 MB. Split the attendee list and import it in batches.", true);
      return;
    }
    setLoading(true);
    setImportIssues([]);
    try {
      const parsed = await new Promise<Papa.ParseResult<Record<string, string>>>((resolve, reject) => {
        Papa.parse<Record<string, string>>(file, {
          header: true,
          skipEmptyLines: true,
          transformHeader: normalizeAttendeeCsvHeader,
          complete: resolve,
          error: reject,
        });
      });
      if (parsed.errors.length) {
        const firstError = parsed.errors[0];
        throw new Error(`CSV parsing failed at row ${(firstError.row ?? 0) + 2}: ${firstError.message}`);
      }
      const rows = parsed.data;
      const response = await fetch("/api/admin/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows }) });
      const data = await response.json() as {
        totalRows?: number;
        imported?: number;
        inserted?: number;
        updated?: number;
        unchanged?: number;
        skipped?: number;
        invalid?: number;
        duplicates?: number;
        missingFields?: { row: number; fields: string[]; reason: string }[];
        invalidFoodPreferences?: { row: number; value: string; reason: string }[];
        notProcessed?: number;
        issues?: { row: number; reason: string }[];
        error?: string;
      };
      setImportIssues(data.issues ?? []);
      if (data.imported) {
        await loadAttendees(search);
        await refreshSummary();
      }
      if (!response.ok) {
        const progress = ` CSV rows: ${data.totalRows ?? rows.length}; imported: ${data.imported ?? 0}; duplicates: ${data.duplicates ?? 0}; invalid: ${data.invalid ?? 0}; not processed: ${data.notProcessed ?? 0}.`;
        throw new Error(`${data.error || "Import failed."}${progress}`);
      }
      flash(
        `CSV rows: ${data.totalRows ?? rows.length}. Added: ${data.inserted ?? data.imported ?? 0}; updated: ${data.updated ?? 0}; unchanged: ${data.unchanged ?? 0}; duplicates: ${data.duplicates ?? 0}; invalid rows: ${data.invalid ?? 0}; missing required fields: ${data.missingFields?.length ?? 0}; invalid food preferences: ${data.invalidFoodPreferences?.length ?? 0}; not processed: ${data.notProcessed ?? 0}.`,
        Boolean(data.invalid || data.duplicates || data.notProcessed),
      );
    } catch (error) { flash(error instanceof Error ? error.message : "CSV import failed.", true); }
    finally { setLoading(false); }
  };

  const downloadTemplate = () => {
    const csv = "name,roll_number,branch,preference\nAarav Kumar,23CS001,CSM,VEG\nDiya Reddy,23CS002,CSM,NON_VEG\n";
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "parallax-attendee-template.csv"; link.click(); URL.revokeObjectURL(url);
  };

  const exportReport = async () => {
    try {
      const response = await fetch("/api/admin/export", { cache: "no-store" });
      if (!response.ok) { const data = await response.json(); throw new Error(data.error || "Export failed."); }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a"); link.href = url; link.download = "parallax-food-pass-report.csv"; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      flash(error instanceof Error ? error.message : "Export failed.", true);
    }
  };

  const filteredAttendees = attendees;

  if (checkingSession) return <div className="loading-screen"><div className="brand-mark">P<span>.</span></div><div className="loading-pulse" />Checking staff access</div>;

  if (!authenticated) {
    return (
      <main className="login-shell">
        <div className="login-art"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="orbit orbit-three" /><div className="login-art-copy"><div className="eyebrow"><span className="eyebrow-line" /> STUDENT EXPERIENCE / 2026</div><h1>Not just<br /><em>a beginning.</em></h1><p>Every pass counts. Every plate accounted for.</p><div className="login-art-bottom"><span>PARALLAX</span><span>21 · 11 · 2026</span></div></div></div>
        <div className="login-panel"><div className="login-panel-inner"><div className="brand-lockup"><div className="brand-mark">P<span>.</span></div><div><strong>PARALLAX</strong><small>PASS / OPERATIONS</small></div></div><div className="login-heading"><div className="section-kicker">STAFF PORTAL</div><h2>Welcome back.</h2><p>Sign in to manage check-in and meal distribution.</p></div>
          <form onSubmit={signIn} className="login-form"><label htmlFor="pin">Staff access PIN</label><input id="pin" type="password" inputMode="numeric" autoComplete="current-password" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="Enter your staff PIN" required /><button className="button button-primary button-full" type="submit" disabled={loading || !pin}>{loading ? "Signing in…" : "Access dashboard"}<ArrowUpRight size={17} /></button></form>
          {loginError && <div className="error-inline"><CircleAlert size={16} />{loginError}</div>}
          <div className="login-foot"><ShieldCheck size={15} /> Authorized event staff only</div><a className="public-register-link" href="/register">Need to register? Open attendee registration <ArrowUpRight size={14} /></a>
        </div></div>
      </main>
    );
  }

  return (
    <div className="app-shell">
      {mobileMenuOpen && <button aria-label="Close menu" className="mobile-scrim" onClick={() => setMobileMenuOpen(false)} />}
      <aside className={`sidebar ${mobileMenuOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-brand"><div className="brand-mark">P<span>.</span></div><div><strong>PARALLAX</strong><small>ATTENDEE OPERATIONS</small></div><button className="mobile-close" onClick={() => setMobileMenuOpen(false)}><X size={18} /></button></div>
        <div className="sidebar-event"><div className="event-symbol"><Sparkles size={18} /></div><div><strong>Freshers 2026</strong><span>Saturday · 21 Nov</span></div><span className="event-live"><i /> LIVE</span></div>
        <div className="nav-label">OPERATIONS</div>
        <nav className="sidebar-nav">{navItems.map((item) => { const Icon = item.icon; return <button key={item.id} className={`nav-item ${view === item.id ? "nav-active" : ""}`} onClick={() => navigate(item.id)}><Icon size={18} /><span>{item.label}</span>{view === item.id && <ChevronRight size={16} className="nav-chevron" />}</button>; })}</nav>
        <div className="sidebar-bottom"><div className="sidebar-help"><div className="help-icon"><ShieldCheck size={17} /></div><div><strong>Staff operations</strong><span>Keep one scan per step.</span></div></div><button className="signout-button" onClick={signOut}><LogOut size={17} /> Sign out</button><div className="sidebar-version">PARALLAXPASS <span>v1.0</span></div></div>
      </aside>
      <main className="main-area">
        <header className="topbar"><div className="topbar-left"><button className="mobile-menu-button" onClick={() => setMobileMenuOpen(true)}><Menu size={20} /></button><div className="breadcrumb">PARALLAX <span>/</span> <strong>{navItems.find((n) => n.id === view)?.label.toUpperCase()}</strong></div></div><div className="topbar-right"><span className="topbar-date">SATURDAY, 21 NOV 2026</span><span className="staff-avatar">S</span><span className="staff-label">STAFF</span></div></header>
        <div className="content-area">
          {notice && <div className={`toast ${noticeIsError ? "toast-error" : ""}`} role={noticeIsError ? "alert" : "status"}>{noticeIsError ? <CircleAlert size={17} /> : <CheckCircle2 size={17} />}{notice}<button onClick={() => setNotice("")} aria-label="Dismiss notification"><X size={15} /></button></div>}
          {view === "overview" && <>
            <div className="page-heading"><div><div className="section-kicker">EVENT CONTROL / 01</div><h1>Good evening, <em>team.</em></h1><p>Here is the live picture of Parallax attendance and food operations.</p></div><button className="button button-secondary" onClick={() => refreshSummary().catch((e) => flash(e.message, true))}><RefreshCw size={16} /> Refresh data</button></div>
            <div className="stats-grid">
              <div className="stat-card stat-card-featured"><div className="stat-top"><span>REGISTERED ATTENDEES</span><Users size={17} /></div><div className="stat-value">{summary.total.toLocaleString("en-IN")}</div><div className="stat-foot"><span className="stat-accent-dot" />Target {summary.targetPopulation} · {summary.remainingRegistrations} remaining</div><div className="stat-watermark"><Users size={88} /></div></div>
              <div className="stat-card"><div className="stat-top"><span>CHECKED IN</span><BadgeCheck size={17} /></div><div className="stat-value">{summary.checkedIn.toLocaleString("en-IN")}</div><div className="stat-foot"><span className="stat-positive">{summary.checkInRate}%</span> of registrations</div><div className="mini-progress"><i style={{ width: `${summary.checkInRate}%` }} /></div></div>
              <div className="stat-card"><div className="stat-top"><span>MEALS COLLECTED</span><ChefHat size={17} /></div><div className="stat-value">{summary.mealsCollected.toLocaleString("en-IN")}</div><div className="stat-foot">{summary.pendingMeals.toLocaleString("en-IN")} checked-in guests pending</div><div className="mini-progress progress-purple"><i style={{ width: `${summary.checkedIn ? Math.round(summary.mealsCollected / summary.checkedIn * 100) : 0}%` }} /></div></div>
              <div className="stat-card"><div className="stat-top"><span>NOT YET ARRIVED</span><Activity size={17} /></div><div className="stat-value">{summary.notCheckedIn.toLocaleString("en-IN")}</div><div className="stat-foot">Awaiting entry scan</div><div className="stat-bottom-label">LIVE HEADCOUNT</div></div>
            </div>
            <div className="overview-grid">
              <section className="panel food-breakdown"><div className="panel-heading"><div><div className="section-kicker">KITCHEN PLANNING</div><h2>Food preference split</h2><p>Meal quantities based on all registrations.</p></div><span className="panel-icon"><Utensils size={18} /></span></div>
                <div className="food-counts"><div className="food-count veg-count"><div className="food-count-icon"><Vegan size={20} /></div><div><span>VEG MEALS</span><strong>{summary.expectedVeg}</strong></div><small>{summary.expectedVeg + summary.expectedNonVeg ? Math.round(summary.expectedVeg / (summary.expectedVeg + summary.expectedNonVeg) * 100) : 0}%</small></div><div className="food-count nonveg-count"><div className="food-count-icon"><ChefHat size={20} /></div><div><span>NON-VEG MEALS</span><strong>{summary.expectedNonVeg}</strong></div><small>{summary.expectedVeg + summary.expectedNonVeg ? Math.round(summary.expectedNonVeg / (summary.expectedVeg + summary.expectedNonVeg) * 100) : 0}%</small></div></div>
                <div className="split-bar"><i className="split-veg" style={{ width: `${summary.expectedVeg + summary.expectedNonVeg ? summary.expectedVeg / (summary.expectedVeg + summary.expectedNonVeg) * 100 : 0}%` }} /><i className="split-nonveg" /></div>
                <div className="meal-remaining"><div><span className="legend-dot veg-dot" />VEG collected <strong>{summary.mealsVeg}</strong> · remaining <strong>{summary.remainingVeg}</strong></div><div><span className="legend-dot nonveg-dot" />NON-VEG collected <strong>{summary.mealsNonVeg}</strong> · remaining <strong>{summary.remainingNonVeg}</strong></div></div>
              </section>
              <section className="panel quick-actions"><div className="panel-heading"><div><div className="section-kicker">QUICK ACCESS</div><h2>Move operations forward</h2><p>Choose the station you are managing.</p></div></div>
                <button className="action-row" onClick={() => navigate("entry")}><div className="action-icon action-entry"><QrCode size={19} /></div><div><strong>Entry check-in</strong><span>Scan passes at the entrance</span></div><ArrowUpRight size={18} /></button>
                <button className="action-row" onClick={() => navigate("food")}><div className="action-icon action-food"><Utensils size={19} /></div><div><strong>Food counter</strong><span>Verify preference and issue meal</span></div><ArrowUpRight size={18} /></button>
                <button className="action-row" onClick={() => navigate("attendees")}><div className="action-icon action-people"><ClipboardList size={19} /></div><div><strong>Manage attendees</strong><span>Import list or add a walk-in</span></div><ArrowUpRight size={18} /></button>
              </section>
            </div>
            <div className="bottom-grid"><section className="panel readiness-panel"><div className="panel-heading"><div><div className="section-kicker">SERVICE READINESS</div><h2>Meal desk progress</h2></div><span className="readiness-number">{summary.checkedIn ? Math.round(summary.mealsCollected / summary.checkedIn * 100) : 0}<small>%</small></span></div><div className="readiness-track"><i style={{ width: `${summary.checkedIn ? Math.round(summary.mealsCollected / summary.checkedIn * 100) : 0}%` }} /></div><div className="readiness-labels"><span>Meals issued</span><strong>{summary.mealsCollected} / {summary.checkedIn}</strong></div></section><section className="panel note-panel"><div className="note-symbol"><ShieldCheck size={19} /></div><div><strong>One person, one meal.</strong><p>The food desk only completes a meal issue after entry has been recorded. Duplicate scans are blocked automatically.</p></div></section></div>
            <section className="panel sync-status-panel"><div className="panel-heading"><div><div className="section-kicker">GOOGLE SHEETS</div><h2>Registration synchronization</h2><p>{summary.syncIntegrationAvailable ? `Last successful sync: ${formatSyncTime(summary.lastSuccessfulSyncAt)}` : summary.syncIntegrationError || "Sync database tables are not configured."}</p></div><RefreshCw size={18} /></div><div className="sync-status-counts"><div><span>NEW SINCE LAST SYNC</span><strong>{summary.syncIntegrationAvailable ? summary.newRegistrationsSinceLastSync : "—"}</strong></div><div><span>SYNC ERRORS</span><strong>{summary.syncIntegrationAvailable ? summary.synchronizationErrors : "—"}</strong></div><div><span>EMAIL SENT</span><strong>{summary.syncIntegrationAvailable ? summary.emailDelivery.sent : "—"}</strong></div><div><span>EMAIL PENDING / FAILED</span><strong>{summary.syncIntegrationAvailable ? `${summary.emailDelivery.pending} / ${summary.emailDelivery.failed}` : "—"}</strong></div></div></section>
          </>}

          {(view === "entry" || view === "food") && <>
            <div className="page-heading"><div><div className="section-kicker">SCAN STATION / {view === "entry" ? "02" : "03"}</div><h1>{view === "entry" ? "Entry check-in." : "Meal collection."}</h1><p>{view === "entry" ? "Confirm each attendee as they arrive at the venue." : "Read the attendee's food preference before handing over a meal."}</p></div><div className="station-chip"><span className="live-dot" /> STATION ACTIVE</div></div>
            <div className="scanner-layout"><section className="panel scanner-panel"><div className="scanner-panel-head"><div><div className="section-kicker">{view === "entry" ? "ENTRY GATE" : "FOOD DISTRIBUTION"}</div><h2>Scan attendee pass</h2><p>{view === "entry" ? "Scan the unique Parallax QR code to mark them present." : "Read the preference, reserve the meal, hand it over, then confirm within five minutes."}</p></div><div className={`station-icon ${view === "entry" ? "station-entry" : "station-meal"}`}>{view === "entry" ? <QrCode size={22} /> : <Utensils size={22} />}</div></div><QRScanner key={view} active={view === "entry" || view === "food"} onScan={processScan} />
                {scanBusy && <div className="scan-processing"><span className="loading-pulse" /> Checking pass and updating record…</div>}
                {scanResult && <ScanResult result={scanResult} mode={view} onConfirmMeal={confirmMeal} onCancelMeal={cancelMeal} confirming={scanBusy} />}
              </section><section className="station-side"><div className="panel station-totals"><div className="section-kicker">LIVE COUNTERS</div><h3>{view === "entry" ? "Gate status" : "Meal service"}</h3>{view === "entry" ? <><div className="station-big-number">{summary.checkedIn}<small> / {summary.total}</small></div><div className="station-progress"><i style={{ width: `${summary.checkInRate}%` }} /></div><div className="station-detail"><span>Attendance rate</span><strong>{summary.checkInRate}%</strong></div><div className="station-detail"><span>Still expected</span><strong>{Math.max(summary.total - summary.checkedIn, 0)}</strong></div></> : <><div className="station-big-number">{summary.mealsCollected}<small> / {summary.checkedIn}</small></div><div className="station-progress progress-purple"><i style={{ width: `${summary.checkedIn ? Math.round(summary.mealsCollected / summary.checkedIn * 100) : 0}%` }} /></div><div className="station-detail"><span>VEG remaining</span><strong>{summary.remainingVeg}</strong></div><div className="station-detail"><span>NON-VEG remaining</span><strong>{summary.remainingNonVeg}</strong></div><div className="station-detail"><span>Pending collection</span><strong>{summary.pendingMeals}</strong></div></>}</div><div className="panel station-rule"><div className="rule-icon"><ShieldCheck size={18} /></div><div><strong>{view === "entry" ? "Duplicate entry protection" : "Duplicate meal protection"}</strong><p>{view === "entry" ? "A second scan will show that the attendee is already checked in." : "A second meal scan is blocked. The attendee must also be checked in at the entrance."}</p></div></div><button className="button button-ghost button-full" onClick={() => refreshSummary().catch((e) => flash(e.message, true))}><RefreshCw size={16} /> Refresh live counters</button></section></div>
          </>}

          {view === "attendees" && <>
            <div className="page-heading"><div><div className="section-kicker">REGISTRATION MANAGEMENT / 04</div><h1>Attendee <em>registry.</em></h1><p>Import your student list, register walk-ins, and retrieve QR passes.</p></div><div className="heading-actions"><a className="button button-secondary" href="/register" target="_blank" rel="noreferrer"><ArrowUpRight size={16} /> Public registration</a><button className="button button-primary" onClick={() => setShowAdd((v) => !v)}><Plus size={17} /> Add attendee</button></div></div>
            <div className="registry-toolbar"><div className="registry-search"><Search size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or roll number" /><span>{filteredAttendees.length} shown</span></div><div className="registry-tools"><button className="button button-secondary button-small" onClick={downloadTemplate}><Download size={15} /> CSV template</button><label className={`button button-secondary button-small file-button ${loading ? "disabled" : ""}`}><Upload size={15} /> Import CSV<input type="file" accept=".csv,text/csv" disabled={loading} onChange={(e) => { void importCsv(e.target.files?.[0]); e.currentTarget.value = ""; }} /></label><button className="button button-secondary button-small" onClick={() => void sendPassEmails()} disabled={!syncSettings?.emailConfigured || sendingPasses || loading}><Mail size={15} />{sendingPasses ? "Sending passes…" : "Send QR passes"}</button><button className="button button-secondary button-small" onClick={() => exportReport()}><ArrowDownToLine size={15} /> Export report</button></div></div>
            {importIssues.length > 0 && <section className="import-report" role="status"><strong>{new Set(importIssues.map((issue) => issue.row)).size} CSV row{new Set(importIssues.map((issue) => issue.row)).size === 1 ? "" : "s"} need attention</strong><ul>{importIssues.map((issue, index) => <li key={`${issue.row}-${index}`}>Row {issue.row}: {issue.reason}</li>)}</ul></section>}
            <section className="panel sync-settings-panel"><div className="panel-heading"><div><div className="section-kicker">PASS EMAILS</div><h2>Automatic delivery</h2><p>Use Send QR passes to email a personal QR image and pass link to every attendee with an email address. Successful sends are not duplicated.</p></div></div>{syncSettings ? <><label className="sync-setting-option"><input type="checkbox" checked={syncSettings.automatic_email_enabled} disabled={savingSyncSettings || !syncSettings.emailConfigured || !syncSettings.syncSchemaAvailable} onChange={(event) => void saveSyncSettings({ ...syncSettings, automatic_email_enabled: event.target.checked })} /><span>Send a QR pass email for new registrations</span></label>{!syncSettings.syncSchemaAvailable ? <p className="sync-setting-note">{syncSettings.setupError}</p> : !syncSettings.emailConfigured && <p className="sync-setting-note">Add RESEND_API_KEY and RESEND_FROM_EMAIL for a verified sending domain before enabling delivery.</p>}<label className="sync-setting-option"><input type="checkbox" checked={syncSettings.email_on_existing_change} disabled={savingSyncSettings || !syncSettings.emailConfigured || !syncSettings.syncSchemaAvailable} onChange={(event) => void saveSyncSettings({ ...syncSettings, email_on_existing_change: event.target.checked })} /><span>Send a pass when an existing attendee's email changes</span></label></> : <p>Loading email settings…</p>}<div className="sync-settings-footer"><span>{summary.syncIntegrationAvailable ? `${summary.emailDelivery.sent} sent · ${summary.emailDelivery.pending} pending · ${summary.emailDelivery.failed} failed` : "Email metrics unavailable until the sync migration is applied."}</span><button className="button button-secondary button-small" disabled={!summary.syncIntegrationAvailable || retryingEmails || (summary.emailDelivery.failed === 0 && summary.emailDelivery.pending === 0)} onClick={() => void retryFailedEmails()}><RefreshCw size={15} />{retryingEmails ? "Retrying…" : "Retry pending / failed emails"}</button></div></section>
            {showAdd && <form className="panel add-attendee-form" onSubmit={addAttendee}><div className="form-title"><div><div className="section-kicker">MANUAL REGISTRATION</div><h3>Add an attendee</h3></div><button type="button" className="icon-button" onClick={() => setShowAdd(false)}><X size={17} /></button></div><div className="form-grid"><label>Full name<input value={newAttendee.name} onChange={(e) => setNewAttendee({ ...newAttendee, name: e.target.value })} placeholder="Attendee name" required /></label><label>Roll number<input value={newAttendee.roll_number} onChange={(e) => setNewAttendee({ ...newAttendee, roll_number: e.target.value })} placeholder="Optional" /></label><label>Email address<input type="email" value={newAttendee.email} onChange={(e) => setNewAttendee({ ...newAttendee, email: e.target.value })} placeholder="Optional" /></label><label>Branch<input value={newAttendee.branch} onChange={(e) => setNewAttendee({ ...newAttendee, branch: e.target.value })} placeholder="e.g. CSM" /></label><label>Food preference<select value={newAttendee.preference} onChange={(e) => setNewAttendee({ ...newAttendee, preference: e.target.value as "VEG" | "NON_VEG" })}><option value="VEG">VEG</option><option value="NON_VEG">NON-VEG</option></select></label></div><div className="form-submit-row"><span>QR pass is generated automatically after saving.</span><button className="button button-primary" type="submit" disabled={loading}><Check size={16} /> Save attendee</button></div></form>}
            <section className="panel registry-panel"><div className="registry-table-wrap"><table className="registry-table"><thead><tr><th>ATTENDEE</th><th>ROLL NUMBER</th><th>EMAIL</th><th>FOOD</th><th>ENTRY</th><th>MEAL</th><th>PASS</th></tr></thead><tbody>{filteredAttendees.map((person) => <tr key={person.id}><td><div className="person-cell"><span className="person-avatar">{person.name.slice(0, 1).toUpperCase()}</span><div><strong>{person.name}</strong><small>{person.branch || "Branch not set"}</small></div></div></td><td className="mono-cell">{person.roll_number || "—"}</td><td className="mono-cell">{person.email || "—"}</td><td><span className={`food-pill ${person.preference === "VEG" ? "pill-veg" : "pill-nonveg"}`}>{person.preference === "VEG" ? <Vegan size={13} /> : <ChefHat size={13} />}{person.preference}</span></td><td><span className={`status-text ${person.checked_in_at ? "status-done" : "status-wait"}`}><i />{person.checked_in_at ? formatTime(person.checked_in_at) : "Pending"}</span></td><td><span className={`status-text ${person.meal_collected_at ? "status-done" : "status-wait"}`}><i />{person.meal_collected_at ? "Collected" : "Pending"}</span></td><td><a className="pass-link" href={`/pass/${person.pass_token}`} target="_blank" rel="noreferrer"><QrCode size={15} /> View pass <ArrowUpRight size={13} /></a></td></tr>)}{!filteredAttendees.length && <tr><td colSpan={7}><div className="empty-state"><Users size={24} /><strong>No attendees found</strong><span>{search ? "Try another name or roll number." : "Import the existing list or add your first attendee."}</span></div></td></tr>}</tbody></table></div><div className="registry-foot"><span>Showing up to 1,000 matching attendees</span><button className="text-button" onClick={() => loadAttendees(search).catch((e) => flash(e.message, true))}><RefreshCw size={14} /> Reload list</button></div></section>
            <div className="registry-note"><FileSpreadsheet size={18} /><div><strong>CSV format</strong><span>Required columns: <code>name</code>, <code>roll_number</code>, and <code>preference</code>. Optional: <code>branch</code>. Google Forms headers such as <code>Hall ticket No:</code>, <code>Section</code>, and <code>Food Preference</code> are recognized. Email is optional; email addresses are imported and searchable. Preference values: VEG or NON_VEG.</span></div></div>
          </>}
        </div>
      </main>
    </div>
  );
}

function ScanResult({ result, mode, onConfirmMeal, onCancelMeal, confirming }: { result: ScanResponse; mode: View; onConfirmMeal: () => void; onCancelMeal: () => void; confirming: boolean }) {
  const attendee = result.attendee;
  const success = ["ENTRY_OK", "MEAL_OK", "MEAL_CANCELLED"].includes(result.status);
  const duplicate = ["DUPLICATE_ENTRY", "DUPLICATE_MEAL", "MEAL_RESERVED"].includes(result.status);
  const ready = result.status === "MEAL_READY";
  return <div className={`scan-result ${success ? "scan-success" : duplicate ? "scan-duplicate" : "scan-error"}`}>
    <div className="scan-result-symbol">{success ? <CheckCircle2 size={25} /> : duplicate ? <CircleAlert size={25} /> : <XCircle size={25} />}</div>
    <div className="scan-result-content"><strong>{result.message || result.error || (result.status === "NOT_CHECKED_IN" ? "Entry required" : "Scan could not be processed")}</strong>
      {attendee && <><div className="scan-person-name">{attendee.name}</div><div className="scan-person-meta">{attendee.roll_number || "No roll number"}{attendee.branch ? ` · ${attendee.branch}` : ""}</div><div className="scan-result-tags"><span className={`food-pill ${attendee.preference === "VEG" ? "pill-veg" : "pill-nonveg"}`}>{attendee.preference === "VEG" ? <Vegan size={13} /> : <ChefHat size={13} />}{attendee.preference}</span><span className="scan-status-tag">{attendee.checked_in_at ? "ENTRY VERIFIED" : "NOT CHECKED IN"}</span><span className="scan-status-tag">{attendee.meal_collected_at ? "MEAL COLLECTED" : "MEAL PENDING"}</span></div></>}
      {mode === "food" && ready && attendee && <div className="food-callout">Reserved meal to hand over: <b>{attendee.preference === "VEG" ? "VEG MEAL" : "NON-VEG MEAL"}</b></div>}
      {mode === "food" && ready && <div className="meal-confirm-actions"><button className="button button-primary confirm-meal-button" type="button" onClick={onConfirmMeal} disabled={confirming}><Check size={15} /> {confirming ? "Confirming…" : "Confirm meal handed over"}</button><button className="button button-secondary button-small" type="button" onClick={onCancelMeal} disabled={confirming}>Cancel reservation</button></div>}
    </div>
  </div>;
}
