"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { ArrowLeft, CheckCircle2, Download, QrCode, Sparkles, Vegan, ChefHat, Printer } from "lucide-react";

type PassData = { name: string; roll_number: string | null; branch: string | null; preference: "VEG" | "NON_VEG" };

export default function PassPage({ params }: { params: Promise<{ token: string }> }) {
  const [token, setToken] = useState("");
  const [attendee, setAttendee] = useState<PassData | null>(null);
  const [qr, setQr] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    params.then(async ({ token: passToken }) => {
      if (!active) return;
      setToken(passToken);
      try {
        const response = await fetch(`/api/public/pass/${passToken}`, { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Pass not found.");
        if (!active) return;
        setAttendee(data.attendee);
        const url = `${window.location.origin}/pass/${passToken}`;
        setQr(await QRCode.toDataURL(url, { width: 420, margin: 2, errorCorrectionLevel: "H", color: { dark: "#171321", light: "#ffffff" } }));
      } catch (err) { if (active) setError(err instanceof Error ? err.message : "Could not load pass."); }
      finally { if (active) setLoading(false); }
    });
    return () => { active = false; };
  }, [params]);

  const downloadQr = () => {
    if (!qr) return;
    const anchor = document.createElement("a"); anchor.href = qr; anchor.download = `parallax-pass-${attendee?.roll_number || token.slice(0, 8)}.png`; anchor.click();
  };

  if (loading) return <main className="pass-shell"><div className="pass-loading"><div className="brand-mark">P<span>.</span></div><span>Preparing your pass…</span></div></main>;
  if (error || !attendee) return <main className="pass-shell"><div className="pass-error"><QrCode size={34} /><h1>Pass unavailable</h1><p>{error || "We couldn't find this attendee."}</p><a className="button button-secondary" href="/register">Back to registration</a></div></main>;

  return <main className="pass-shell"><div className="pass-top"><a href="/register"><ArrowLeft size={16} /> REGISTRATION</a><div className="public-wordmark"><span className="brand-mark">P<span>.</span></span><strong>PARALLAX</strong></div><span className="pass-top-tag">OFFICIAL PASS</span></div><div className="pass-card"><div className="pass-card-banner"><div className="pass-banner-orbit" /><div className="section-kicker">FRESHERS / 2026</div><div className="pass-logo-line"><span>PARALLAX</span><Sparkles size={17} /></div><h1>YOU’RE<br /><em>ON THE LIST.</em></h1><span className="pass-date">SATURDAY · 21 NOVEMBER 2026</span></div><div className="pass-ticket-body"><div className="pass-attendee-info"><span className="section-kicker">ATTENDEE PASS</span><h2>{attendee.name}</h2><p>{attendee.roll_number || "GUEST PASS"}{attendee.branch ? ` · ${attendee.branch}` : ""}</p><div className="pass-food-line"><span>MEAL PREFERENCE</span><strong className={attendee.preference === "VEG" ? "pass-veg" : "pass-nonveg"}>{attendee.preference === "VEG" ? <Vegan size={16} /> : <ChefHat size={16} />}{attendee.preference}</strong></div></div><div className="pass-qr"><div className="qr-image-wrap">{qr && <img src={qr} alt="Unique Parallax QR pass" />}</div><span>SCAN AT ENTRY & FOOD COUNTER</span><small>UNIQUE PASS · DO NOT SHARE</small></div><div className="pass-perforation"><i /><i /></div><div className="pass-bottom-line"><span>PF / 2026</span><span>ONE PERSON · ONE PASS · ONE MEAL</span><span>21.11.26</span></div></div></div><div className="pass-actions"><button className="button button-primary" onClick={downloadQr}><Download size={16} /> Download QR</button><button className="button button-secondary" onClick={() => window.print()}><Printer size={16} /> Print pass</button></div><div className="pass-instructions"><CheckCircle2 size={18} /><p>Keep this QR code ready on your phone. It will be scanned once at the entrance and again at the food counter. Your meal preference is shown to event staff when scanned.</p></div><footer className="public-footer"><span>PARALLAX / NOT JUST A BEGINNING</span><span>SEE YOU THERE.</span></footer></main>;
}
