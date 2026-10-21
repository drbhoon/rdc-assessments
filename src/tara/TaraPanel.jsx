import React, { useLayoutEffect, useRef, useState } from 'react';
import { Volume2 } from 'lucide-react';
import LiveAvatarCanvas from './LiveAvatarCanvas';
import { withBase } from '../basePath';

const STATUS = {
  speaking: { label: 'Speaking', className: 'text-blue-300 bg-blue-500/10 border-blue-400/30' },
  listening: { label: 'Listening', className: 'text-emerald-300 bg-emerald-500/10 border-emerald-400/30' },
  idle: { label: 'Ready', className: 'text-slate-300 bg-slate-700/40 border-slate-600' },
  thinking: { label: 'Ready', className: 'text-slate-300 bg-slate-700/40 border-slate-600' },
};

const MOVE = '650ms cubic-bezier(0.22, 1, 0.36, 1)';

/**
 * TARA as the interviewer. While she speaks she fills the middle of the
 * screen, with what she is saying underneath; when she listens she goes back
 * to her corner beside her name (RDC, 2026-10-21: small, she was "almost
 * invisible"). One picture glides between the two places, so she never
 * flickers or reloads; her corner is an empty spot in the layout that the
 * picture follows, even as the page scrolls.
 */
export default function TaraPanel({ mode, energy, nodSignal, onHearAgain, canHearAgain, caption, onSkip }) {
  const [live, setLive] = useState(false);
  const spotRef = useRef(null);
  const [spot, setSpot] = useState(null);
  const [view, setView] = useState({ w: window.innerWidth, h: window.innerHeight });
  const onStage = mode === 'speaking';

  useLayoutEffect(() => {
    const measure = () => {
      const r = spotRef.current?.getBoundingClientRect();
      if (r) setSpot((old) => (old && old.top === r.top && old.left === r.left && old.size === r.width ? old : { top: r.top, left: r.left, size: r.width }));
      setView((old) => (old.w === window.innerWidth && old.h === window.innerHeight ? old : { w: window.innerWidth, h: window.innerHeight }));
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    const timer = window.setInterval(measure, 400); // the page settles after its own animations
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      window.clearInterval(timer);
    };
  }, []);

  // On stage she leaves room underneath for her words (the greeting is long).
  const longCaption = (caption || '').length > 160;
  const captionRoom = longCaption ? 250 : 170;
  const size = onStage ? Math.round(Math.max(140, Math.min(view.w * 0.82, view.h * 0.5, view.h - captionRoom - 32))) : spot?.size || 0;
  const top = onStage ? Math.round(Math.max(16, (view.h - size - captionRoom) / 2)) : spot?.top || 0;
  const left = onStage ? Math.round((view.w - size) / 2) : spot?.left || 0;
  const status = STATUS[mode] || STATUS.idle;

  return (
    <div className="flex items-center gap-4 md:gap-6 mb-6">
      {/* Her place in the corner: the picture below sits on it while she listens. */}
      <div ref={spotRef} className="shrink-0 w-28 h-28 md:w-36 md:h-36" />

      {/* While she speaks: the screen dims; a tap lets the candidate answer at once. */}
      <div
        onClick={onStage ? onSkip : undefined}
        className="fixed inset-0 z-40 bg-slate-950/90 backdrop-blur-sm"
        style={{ opacity: onStage ? 1 : 0, pointerEvents: onStage ? 'auto' : 'none', transition: `opacity ${MOVE}` }}
        aria-hidden={!onStage}
      >
        {onStage && caption && (
          <div className="absolute inset-x-0 px-6 text-center" style={{ top: top + size + 24 }}>
            <p className={`mx-auto max-w-2xl text-white font-semibold leading-relaxed ${longCaption ? 'text-base md:text-xl' : 'text-lg md:text-2xl'}`} aria-live="polite">{caption}</p>
            <p className="mt-4 text-slate-400 text-xs md:text-sm">Tap anywhere to start answering now</p>
          </div>
        )}
      </div>

      {/* TARA herself, gliding between the middle of the screen and her corner. */}
      <div
        className="fixed z-50 rounded-full overflow-hidden bg-gradient-to-b from-slate-100 to-white ring-2 ring-brand-500/40 shadow-2xl"
        style={{
          top, left, width: size, height: size,
          visibility: spot ? 'visible' : 'hidden',
          transition: `top ${MOVE}, left ${MOVE}, width ${MOVE}, height ${MOVE}`,
          pointerEvents: onStage ? 'auto' : 'none',
        }}
        onClick={onStage ? onSkip : undefined}
      >
        {!live && (
          <img src={withBase('/tara/tara-rest.webp')} alt="" className="absolute inset-0 w-full h-full object-contain object-bottom" />
        )}
        <LiveAvatarCanvas mode={mode} speechEnergy={energy} nodSignal={nodSignal} className="absolute inset-0 w-full h-full" onReady={setLive} />
      </div>

      <div className="min-w-0 text-left">
        <div className="text-white text-xl font-bold leading-tight">TARA</div>
        <div className="text-slate-400 text-xs mb-2">AI interviewer · RDC Concrete</div>
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-semibold ${status.className}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${mode === 'listening' ? 'bg-emerald-400 animate-pulse' : mode === 'speaking' ? 'bg-blue-400 animate-pulse' : 'bg-slate-400'}`} />
          {status.label}
        </span>
        {canHearAgain && (
          <button
            type="button"
            onClick={onHearAgain}
            className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-brand-300 hover:text-brand-200"
          >
            <Volume2 size={14} /> Hear the question again
          </button>
        )}
      </div>
    </div>
  );
}
