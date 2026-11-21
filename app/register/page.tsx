"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { ArrowLeft, ArrowUpRight, CheckCircle2, CircleAlert, ShieldCheck } from "lucide-react";

type RegistrationForm = {
  name: string;
  roll_number: string;
  branch: string;
  section: string;
  preference: "VEG" | "NON_VEG";
};

const emptyForm: RegistrationForm = {
  name: "",
  roll_number: "",
  branch: "",
  section: "",
  preference: "VEG",
};

export default function RegisterPage() {
  const [form, setForm] = useState<RegistrationForm>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const update = <K extends keyof RegistrationForm,>(key: K, value: RegistrationForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/public/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Registration could not be completed.");
      window.location.href = `/pass/${data.token}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return <main className="public-shell">
    <div className="public-top">
      <a href="/" className="public-back"><ArrowLeft size={16} /> STAFF PORTAL</a>
      <div className="public-wordmark"><span className="brand-mark">P<span>.</span></span><strong>PARALLAXPASS</strong></div>
      <span className="public-edition">CSM / 2026</span>
    </div>
    <div className="public-register-wrap">
      <div className="public-intro">
        <div className="section-kicker"><span className="eyebrow-line" /> PARALLAX MEMBER REGISTRATION</div>
        <h1>Get your<br /><em>pass.</em></h1>
        <p>Missed the Google Form? Register here with your college details and create your personal QR pass instantly. Already registered? Enter the same name and roll number to retrieve your existing pass.</p>
        <div className="public-event-chip"><ShieldCheck size={16} /><span>ONE MEMBER · ONE PASS</span><b>21 NOV 2026</b></div>
      </div>
      <form className="public-form" onSubmit={submit}>
        <div className="form-card-head"><div><div className="section-kicker">NEW MEMBER REGISTRATION</div><h2>Your details.</h2></div><span className="form-step">2026</span></div>
        <label>Full name<input value={form.name} onChange={(e) => update("name", e.target.value)} placeholder="Enter your full name" autoComplete="name" required minLength={2} maxLength={100} /></label>
        <label>College roll number<input value={form.roll_number} onChange={(e) => update("roll_number", e.target.value.toUpperCase())} placeholder="Enter your hall-ticket / roll number" autoCapitalize="characters" autoComplete="off" required maxLength={60} /></label>
        <div className="form-grid">
          <label>Branch<input value={form.branch} onChange={(e) => update("branch", e.target.value)} placeholder="e.g. CSM" required maxLength={50} /></label>
          <label>Section<input value={form.section} onChange={(e) => update("section", e.target.value.toUpperCase())} placeholder="e.g. A" required maxLength={40} /></label>
        </div>
        <label>Food preference<select value={form.preference} onChange={(e) => update("preference", e.target.value as RegistrationForm["preference"])}><option value="VEG">VEG</option><option value="NON_VEG">NON-VEG</option></select></label>
        {error && <div className="error-inline"><CircleAlert size={16} />{error}</div>}
        <button className="button button-primary button-full public-submit" type="submit" disabled={busy}>{busy ? "Creating your pass…" : "Create / retrieve my QR pass"}<ArrowUpRight size={17} /></button>
        <div className="secure-note"><CheckCircle2 size={14} /> Your roll number can be registered only once.</div>
        <p className="form-disclaimer">Your QR pass is generated as soon as registration succeeds. Keep it private and show it at the event entry and food counter. College identity may be checked at the entrance.</p>
      </form>
    </div>
    <footer className="public-footer"><span>PARALLAX / NOT JUST A BEGINNING</span><span>MADE FOR THE MOMENT.</span></footer>
  </main>;
}
