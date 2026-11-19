"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { ArrowLeft, ArrowUpRight, CheckCircle2, CircleAlert, Sparkles, Vegan, ChefHat } from "lucide-react";

export default function RegisterPage() {
  const [form, setForm] = useState({ name: "", roll_number: "", branch: "", preference: "VEG" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/public/register", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Registration failed.");
      window.location.href = `/pass/${data.token}`;
    } catch (err) { setError(err instanceof Error ? err.message : "Registration failed."); }
    finally { setBusy(false); }
  };

  return <main className="public-shell"><div className="public-top"><a href="/" className="public-back"><ArrowLeft size={16} /> STAFF PORTAL</a><div className="public-wordmark"><span className="brand-mark">P<span>.</span></span><strong>PARALLAX</strong></div><span className="public-edition">FRESHERS / 2026</span></div><div className="public-register-wrap"><div className="public-intro"><div className="section-kicker"><span className="eyebrow-line" /> ATTENDEE REGISTRATION</div><h1>Your pass<br />starts <em>here.</em></h1><p>Register your details and choose your meal preference. Your unique QR pass will be generated immediately.</p><div className="public-event-chip"><Sparkles size={16} /><span>PARALLAX FRESHERS</span><b>21 NOV 2026</b></div></div><form className="public-form" onSubmit={submit}><div className="form-card-head"><div><div className="section-kicker">01 / YOUR DETAILS</div><h2>Let’s get you in.</h2></div><span className="form-step">01 — 02</span></div><label>Full name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="As shown on your college ID" autoComplete="name" required minLength={2} /></label><label>Roll number <span className="optional">OPTIONAL FOR GUESTS</span><input value={form.roll_number} onChange={(e) => setForm({ ...form, roll_number: e.target.value })} placeholder="Your roll / hall ticket number" /></label><label>Branch / department<input value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} placeholder="e.g. CSM" /></label><div className="form-separator" /><div className="section-kicker">02 / MEAL PREFERENCE</div><h3>What are you having?</h3><div className="preference-options"><button type="button" className={`preference-option ${form.preference === "VEG" ? "preference-selected" : ""}`} onClick={() => setForm({ ...form, preference: "VEG" })}><span className="preference-mark veg-mark"><Vegan size={19} /></span><span><strong>Vegetarian</strong><small>VEG MEAL</small></span><i /></button><button type="button" className={`preference-option ${form.preference === "NON_VEG" ? "preference-selected" : ""}`} onClick={() => setForm({ ...form, preference: "NON_VEG" })}><span className="preference-mark nonveg-mark"><ChefHat size={19} /></span><span><strong>Non-vegetarian</strong><small>NON-VEG MEAL</small></span><i /></button></div><p className="form-disclaimer">Your meal preference is used only for event food planning and distribution.</p>{error && <div className="error-inline"><CircleAlert size={16} />{error}</div>}<button className="button button-primary button-full public-submit" type="submit" disabled={busy}>{busy ? "Creating your pass…" : "Generate my QR pass"}<ArrowUpRight size={17} /></button><div className="secure-note"><CheckCircle2 size={14} /> Your pass is unique and can only be used once for meal collection.</div></form></div><footer className="public-footer"><span>PARALLAX / NOT JUST A BEGINNING</span><span>MADE FOR THE MOMENT.</span></footer></main>;
}
