import React, { useState } from 'react';
import { Volume2 } from 'lucide-react';
import LiveAvatarCanvas from './LiveAvatarCanvas';
import { withBase } from '../basePath';

const STATUS = {
  speaking: { label: 'Speaking', className: 'text-blue-300 bg-blue-500/10 border-blue-400/30' },
  listening: { label: 'Listening', className: 'text-emerald-300 bg-emerald-500/10 border-emerald-400/30' },
  idle: { label: 'Ready', className: 'text-slate-300 bg-slate-700/40 border-slate-600' },
  thinking: { label: 'Ready', className: 'text-slate-300 bg-slate-700/40 border-slate-600' },
};

/**
 * TARA as the interviewer: her moving face (the still photo until the live
 * one is drawn), name and what she is doing, and a "Hear again" button.
 */
export default function TaraPanel({ mode, energy, nodSignal, onHearAgain, canHearAgain }) {
  const [live, setLive] = useState(false);
  const status = STATUS[mode] || STATUS.idle;
  return (
    <div className="flex items-center gap-4 md:gap-6 mb-6">
      <div className="relative shrink-0 w-28 h-28 md:w-36 md:h-36 rounded-full overflow-hidden bg-gradient-to-b from-slate-100 to-white ring-2 ring-brand-500/40">
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
