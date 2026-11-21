"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { ArrowLeft, ArrowUpRight, CheckCircle2, CircleAlert, ShieldCheck } from "lucide-react";

export default function RegisterPage() {
  const [form, setForm] = useState({ name: "", roll_number: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/public/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "We could not verify this CSM registration.");
      window.location.href = `/pass/${data.token}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pass lookup failed.");
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
        <div className="section-kicker"><span className="eyebrow-line" /> CSM ATTENDEE ACCESS</div>
        <h1>Your pass<br />starts <em>here.</em></h1>
        <p>Enter the name and hall-ticket number you submitted. We verify both against the official CSM attendee list and retrieve your existing personal QR pass.</p>
        <div className="public-event-chip"><ShieldCheck size={16} /><span>CSM ROSTER VERIFIED</span><b>21 NOV 2026</b></div>
      </div>
      <form className="public-form" onSubmit={submit}>
        <div className="form-card-head"><div><div className="section-kicker">PASS VERIFICATION</div><h2>Find your pass.</h2></div><span className="form-step">CSM ONLY</span></div>
        <label>Full name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="As submitted in the registration form" autoComplete="name" required minLength={2} /></label>
        <label>Hall-ticket number<input value={form.roll_number} onChange={(e) => setForm({ ...form, roll_number: e.target.value.toUpperCase()})} placeholder="Your college hall-ticket number" autoCapitalize="characters" autoComplete="off" required /></label>
        {error && <div className="error-inline"><CircleAlert size={16} />{error}</div>}
        <button className="button button-primary button-full public-submit" type="submit" disabled={busy}>{busy ? "Verifying your details…" : "Get my QR pass"}<ArrowUpRight size={17} /></button>
        <div className="secure-note"><CheckCircle2 size={14} /> Only matching CSM roster records can retrieve a pass.</div>
        <p className="form-disclaimer">Your name and hall-ticket number must match the official list. If your details are missing or incorrect, contact the registration desk.</p>
      </form>
    </div>
    <footer className="public-footer"><span>PARALLAX / NOT JUST A BEGINNING</span><span>MADE FOR THE MOMENT.</span></footer>
  </main>;
}
