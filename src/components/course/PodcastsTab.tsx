"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { ScopePicker, type ScopeValue } from "./ScopePicker";
import type { Podcast } from "@/lib/types";
import type { CourseData } from "./CourseWorkspace";

export function PodcastsTab({ data }: { data: CourseData }) {
  const id = data.course.id;
  const [podcasts, setPodcasts] = useState<Podcast[] | null>(null);
  const [open, setOpen] = useState<Podcast | null>(null);
  const [scope, setScope] = useState<ScopeValue>({ kind: "course" });
  const [minutes, setMinutes] = useState(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api<Podcast[]>(`/api/courses/${id}/podcasts`)
      .then((p) => {
        setPodcasts(p);
        setOpen((o) => o ?? p[0] ?? null);
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const p = await api<Podcast>(`/api/courses/${id}/podcasts`, { method: "POST", json: { scope, minutes } });
      setOpen(p);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="card stack">
        <h2>Study podcasts</h2>
        <p className="small muted" style={{ margin: 0 }}>
          A two-host conversation about your material, read aloud by your device&apos;s voices. Good for commutes and walks.
        </p>
        <div className="row">
          <ScopePicker tree={data.tree} value={scope} onChange={setScope} />
          <label className="field">
            Length (minutes)
            <input type="number" min={3} max={40} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} style={{ width: 90 }} />
          </label>
          <button className="primary" style={{ alignSelf: "flex-end" }} onClick={create} disabled={busy || !data.tree.length}>
            {busy && <span className="spinner" />} {busy ? "Writing episode…" : "Create episode"}
          </button>
        </div>
        {!data.tree.length && <div className="alert">Build the brainmap first.</div>}
        {error && <div className="alert error">{error}</div>}
      </div>

      {podcasts && podcasts.length > 0 && (
        <div className="split" style={{ gridTemplateColumns: "260px minmax(0, 1fr)" }}>
          <div className="card list">
            {podcasts.map((p) => (
              <div key={p.id} className="list-item" style={{ cursor: "pointer", background: open?.id === p.id ? "var(--accent-soft)" : undefined, borderRadius: 8, padding: 8 }} onClick={() => setOpen(p)}>
                <div>
                  <strong className="small">{p.title}</strong>
                  <div className="small muted">
                    {p.scope} · ~{Math.round(p.segments.reduce((s, x) => s + x.text.split(/\s+/).length, 0) / 150)} min
                  </div>
                </div>
              </div>
            ))}
          </div>
          {open && <Player key={open.id} podcast={open} onDelete={async () => (await api(`/api/podcasts/${open.id}`, { method: "DELETE" }), setOpen(null), load())} />}
        </div>
      )}
    </div>
  );
}

function Player({ podcast, onDelete }: { podcast: Podcast; onDelete: () => void }) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceA, setVoiceA] = useState("");
  const [voiceB, setVoiceB] = useState("");
  const [rate, setRate] = useState(1.05);
  const [current, setCurrent] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  // Each playback run gets a generation number; callbacks from an older run are ignored.
  const genRef = useRef(0);
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;

  useEffect(() => {
    if (!supported) return;
    const pick = () => {
      const all = speechSynthesis.getVoices();
      const en = all.filter((v) => v.lang.startsWith("en"));
      const list = en.length ? en : all;
      setVoices(list);
      if (list.length) {
        setVoiceA((a) => a || list[0].name);
        setVoiceB((b) => b || (list.find((v, i) => i > 0 && v.name !== list[0].name) ?? list[0]).name);
      }
    };
    pick();
    speechSynthesis.addEventListener("voiceschanged", pick);
    return () => {
      speechSynthesis.removeEventListener("voiceschanged", pick);
      genRef.current++;
      speechSynthesis.cancel();
    };
  }, [supported]);

  function playFrom(i: number) {
    if (!supported) return;
    const gen = ++genRef.current;
    speechSynthesis.cancel();
    setPlaying(true);
    const speak = (k: number) => {
      if (gen !== genRef.current) return;
      if (k >= podcast.segments.length) {
        setPlaying(false);
        setCurrent(null);
        return;
      }
      const seg = podcast.segments[k];
      const u = new SpeechSynthesisUtterance(seg.text);
      const v = voices.find((x) => x.name === (seg.speaker === "A" ? voiceA : voiceB));
      if (v) u.voice = v;
      u.rate = rate;
      u.pitch = seg.speaker === "A" ? 1 : 1.1;
      u.onend = () => speak(k + 1);
      u.onerror = () => speak(k + 1);
      setCurrent(k);
      document.getElementById(`seg-${k}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      speechSynthesis.speak(u);
    };
    speak(i);
  }

  function pause() {
    if (speechSynthesis.paused) {
      speechSynthesis.resume();
      setPlaying(true);
    } else {
      speechSynthesis.pause();
      setPlaying(false);
    }
  }

  function stop() {
    genRef.current++;
    speechSynthesis.cancel();
    setPlaying(false);
    setCurrent(null);
  }

  function downloadScript() {
    const txt = `${podcast.title}\n\n` + podcast.segments.map((s) => `${podcast.hosts[s.speaker]}: ${s.text}`).join("\n\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([txt], { type: "text/plain" }));
    a.download = `${podcast.title}.txt`.replace(/[\\/:*?"<>|]+/g, "_");
    a.click();
  }

  return (
    <div className="card stack">
      <div className="spread">
        <h3 style={{ margin: 0 }}>{podcast.title}</h3>
        <div className="row">
          <button className="sm" onClick={downloadScript}>
            Script
          </button>
          <button className="sm danger" onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>
      {!supported ? (
        <div className="alert">This browser can&apos;t read text aloud. You can still read or download the script.</div>
      ) : (
        <div className="row">
          {!playing && current === null && (
            <button className="primary" onClick={() => playFrom(0)}>
              ▶ Play
            </button>
          )}
          {current !== null && <button onClick={pause}>{playing ? "❚❚ Pause" : "▶ Resume"}</button>}
          {current !== null && <button onClick={stop}>■ Stop</button>}
          <label className="field">
            {podcast.hosts.A}&apos;s voice
            <select value={voiceA} onChange={(e) => setVoiceA(e.target.value)}>
              {voices.map((v) => (
                <option key={v.name}>{v.name}</option>
              ))}
            </select>
          </label>
          <label className="field">
            {podcast.hosts.B}&apos;s voice
            <select value={voiceB} onChange={(e) => setVoiceB(e.target.value)}>
              {voices.map((v) => (
                <option key={v.name}>{v.name}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Speed {rate.toFixed(2)}x
            <input type="range" min={0.7} max={1.8} step={0.05} value={rate} onChange={(e) => setRate(Number(e.target.value))} />
          </label>
        </div>
      )}
      <div style={{ maxHeight: 520, overflow: "auto" }}>
        {podcast.segments.map((s, i) => (
          <div key={i} id={`seg-${i}`} className={`segment ${s.speaker}${current === i ? " playing" : ""}`} onClick={() => playFrom(i)} title="Play from here">
            <div className="small muted">{podcast.hosts[s.speaker]}</div>
            {s.text}
          </div>
        ))}
      </div>
    </div>
  );
}
