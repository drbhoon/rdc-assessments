import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import RecruitmentTab from '../components/RecruitmentTab';
import { Loader2, AlertCircle, CheckCircle } from 'lucide-react';

export default function CandidateView() {
    const [searchParams] = useSearchParams();
    const urlCode = searchParams.get('code');

    const [codeInput, setCodeInput] = useState(urlCode || '');
    const [interviewData, setInterviewData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [submitted, setSubmitted] = useState(false);

    useEffect(() => {
        if (urlCode) {
            handleJoinCode(urlCode);
        }
    }, [urlCode]);

    const handleJoinCode = async (codeToUse) => {
        const code = (codeToUse || codeInput).trim().toUpperCase();
        if (!code) return;

        setLoading(true);
        setError(null);

        try {
            const res = await fetch(`/api/interviews/${code}`);
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to fetch interview');
            }
            const data = await res.json();
            
            if (data.status === 'completed') {
                setSubmitted(true);
            }
            setInterviewData(data);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const submitInterview = async (formattedTranscriptString, type) => {
        // Because the current UI just emits a formatted transcript string, we use it directly.
        setLoading(true);
        try {
            const res = await fetch(`/api/interviews/${interviewData.join_code}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    candidate_details: { type },
                    transcript_answers: { raw: formattedTranscriptString }
                })
            });

            if (!res.ok) throw new Error("Failed to submit interview");
            
            // Re-fetch to show completed state
            const finalData = await res.json();
            setInterviewData(finalData);
            setSubmitted(true);
            
        } catch (err) {
            alert(err.message);
        } finally {
            setLoading(false);
        }
    };

    if (loading && !interviewData) {
        return (
            <div className="min-h-screen bg-slate-900 flex items-center justify-center">
                <Loader2 className="animate-spin text-brand-500" size={48} />
            </div>
        );
    }

    if (!interviewData && !loading) {
        return (
            <div className="min-h-screen bg-slate-900 text-slate-100 font-sans flex items-center justify-center p-6">
                <div className="bg-slate-800/80 p-8 rounded-2xl border border-slate-700/50 shadow-2xl max-w-md w-full text-center">
                    <img src="/rdc_logo.png" alt="RDC Logo" className="h-16 object-contain mx-auto drop-shadow-md mb-6" />
                    <h1 className="text-2xl font-bold text-white mb-2">Remote Interview Portal</h1>
                    <p className="text-slate-400 mb-8">Please enter your 6-character Join Code provided by HR to begin.</p>
                    
                    <input 
                        type="text" 
                        placeholder="e.g. A8X2L9"
                        value={codeInput}
                        onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg py-4 px-4 text-center text-xl tracking-[0.2em] uppercase text-white placeholder:text-slate-600 focus:outline-none focus:border-brand-500 mb-4"
                        maxLength={6}
                    />
                    
                    {error && (
                        <div className="mb-4 flex items-center justify-center gap-2 text-red-400 text-sm bg-red-400/10 py-2 rounded-lg">
                            <AlertCircle size={16} /> {error}
                        </div>
                    )}

                    <button 
                        onClick={() => handleJoinCode(codeInput)}
                        disabled={codeInput.length < 5}
                        className="w-full bg-brand-600 hover:bg-brand-500 text-white font-semibold py-3 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Join Interview
                    </button>
                    <p className="mt-8 text-xs text-slate-500">Are you an administrator? <a href="/admin" className="underline hover:text-slate-400">Log in here</a>.</p>
                </div>
            </div>
        );
    }

    if (submitted) {
        return (
            <div className="min-h-screen bg-slate-900 text-slate-100 font-sans flex items-center justify-center p-6">
                 <div className="max-w-lg w-full bg-slate-800/80 p-10 rounded-2xl border border-slate-700/50 shadow-2xl text-center">
                    <CheckCircle className="text-brand-500 mx-auto mb-6" size={64} />
                    <h1 className="text-3xl font-bold text-white mb-4">Assessment Submitted!</h1>
                    <p className="text-slate-400 text-lg leading-relaxed">Thank you for completing the RDC Assessment. Your responses have been securely recorded.</p>
                    <p className="mt-4 text-slate-500 text-sm">You may now close this window.</p>
                </div>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-slate-900 text-slate-100 font-sans selection:bg-brand-500/30">
            <header className="border-b border-slate-800 bg-slate-950/50 backdrop-blur-md sticky top-0 z-10 px-6 py-4 flex items-center justify-between">
                <img src="/rdc_logo.png" alt="RDC Logo" className="h-10 object-contain" />
                <div className="text-right">
                    <span className="text-sm font-semibold text-brand-400 bg-brand-500/10 px-3 py-1 rounded-full border border-brand-500/20">
                        {interviewData.assessment_type === 'sales_recruitment' ? 'Sales Recruitment' 
                         : interviewData.assessment_type === 'kaushal_mm' ? 'Kaushal – Material Management' 
                         : interviewData.assessment_type === 'kaushal_tech' ? 'Kaushal Technical – Concrete'
                         : interviewData.assessment_type === 'kaushal_batching' ? 'Kaushal Batching'
                         : 'Fresher Candidate'} 
                        &nbsp;•&nbsp; {interviewData.join_code}
                    </span>
                 </div>
            </header>

            <main className="max-w-4xl mx-auto p-4 md:p-8 w-full">
                 <RecruitmentTab 
                    assessmentType={interviewData.assessment_type}
                    onSubmit={submitInterview} 
                 />
            </main>
        </div>
    );
}
