import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Mic, MicOff, ChevronRight, ChevronLeft, CheckCircle2, User, GraduationCap, Calendar, MapPin, Send, AlertCircle, Languages } from 'lucide-react';
import { kaushalTechQuestions } from '../data/kaushalTechQuestions';
import { kaushalBatchingQuestions } from '../data/kaushalBatchingQuestions';

// All major Indian languages supported by the Web Speech API (BCP-47 tags)
const INDIAN_LANGUAGES = [
  { label: 'English (India)',    value: 'en-IN' },
  { label: 'Hindi',              value: 'hi-IN' },
  { label: 'Tamil',              value: 'ta-IN' },
  { label: 'Telugu',             value: 'te-IN' },
  { label: 'Kannada',            value: 'kn-IN' },
  { label: 'Malayalam',          value: 'ml-IN' },
  { label: 'Bengali',            value: 'bn-IN' },
  { label: 'Gujarati',           value: 'gu-IN' },
  { label: 'Marathi',            value: 'mr-IN' },
  { label: 'Punjabi',            value: 'pa-IN' },
  { label: 'Odia',               value: 'or-IN' },
  { label: 'Urdu',               value: 'ur-IN' },
  { label: 'Assamese',           value: 'as-IN' },
  { label: 'Kashmiri',           value: 'ks-IN' },
];

const FRESHER_QUESTIONS = [
  "What are your short term and long term goals?",
  "Ready mix concrete plants are located pan-India. Are you ready to relocate anywhere in India?",
  "Why do you need this job? What is your motivation?",
  "In this industry, 24-hour continuous pours happen. Are you willing to work a 24-hour shift if an emergency requires it?",
  "Tell me about your family background. What do your parents do, and what responsibilities do you have at home?",
  "If you are assigned a task at 6 PM and told it must be completed by 6 AM, how would you ensure it gets done?",
  "The RMC industry is physically demanding and peak hours can be 12 hours long. How comfortable are you with this?",
  "What have you been doing during the gap since your exams finished?",
  "Walk me through your typical daily schedule, from the time you wake up until you go to sleep. What do you do on weekends?"
];

const SALES_QUESTIONS = [
  "Tell me about a time when you had to convince a customer who was not interested in your product.",
  "Field sales involves a lot of rejection. Tell me about a time when you faced repeated rejection. What did you do?",
  "Tell me about a time when you had to manage multiple customers in one day. How did you prioritize?",
  "Describe a situation where a customer was unhappy with your service. How did you handle it?",
  "Tell me about a time when you had to work independently without close supervision.",
  "Give an example of a difficult negotiation you handled.",
  "Describe a time when you built a strong relationship with a customer.",
  "Tell me about a time when you identified a new opportunity that others had not noticed.",
  "Field sales can be physically demanding and involve long hours. What motivates you to continue performing?",
  "Tell me about a time when you had to learn something completely new for your job."
];

const KAUSHAL_ALL_QUESTIONS = [
  "You need to procure raw material urgently for plant operations. What process should you follow?",
  "Who is authorized to approve material procurement and under what conditions?",
  "What checks are required before onboarding a new vendor?",
  "Why is it important to understand vendor payment terms?",
  "Why must materials be correctly mapped in ERP?",
  "What is the importance of GRN?",
  "When can ITC be claimed?",
  "How will you ensure inventory control?",
  "Cement consumption increased by 2%. What will you do?",
  "ERP shows higher stock than physical. What will you do?",
  "Admixture barrels returned with less weight. Action?",
  "How is cement transfer handled?",
  "Excess aggregate stock. What will you do?",
  "Invoice higher than PO. What will you do?",
  "Weighbridge fluctuating. Action?",
  "Material issued without ERP entry. Risk?",
  "Material cost increased. What will you check?",
  "How will you prevent losses?",
  "Why is ERP discipline critical?",
  "Vendor not approved but urgent requirement. Action?"
];

// Helper: shuffle array and pick N items
const pickRandom = (arr, n) => [...arr].sort(() => 0.5 - Math.random()).slice(0, n);

export default function RecruitmentTab({ onSubmit, assessmentType = 'recruitment' }) {
  const questions = useMemo(() => {
    if (assessmentType === 'sales_recruitment') return SALES_QUESTIONS;
    if (assessmentType === 'kaushal_mm') {
      return pickRandom(KAUSHAL_ALL_QUESTIONS, 10);
    }
    if (assessmentType === 'kaushal_tech') {
      // Pick 10 random questions from the flat array
      const selected = pickRandom(kaushalTechQuestions, 10);
      return selected.map(q => q.question);
    }
    if (assessmentType === 'kaushal_batching') {
      const selected = pickRandom(kaushalBatchingQuestions, 10);
      return selected.map(q => q.Question);
    }
    return FRESHER_QUESTIONS;
  }, [assessmentType]);

  const [step, setStep] = useState(0); // 0 = details, 1-N = questions
  const [details, setDetails] = useState({ name: '', qualification: '', dob: '', hometown: '' });
  const [selectedLang, setSelectedLang] = useState('en-IN'); // BCP-47 tag for speech recognition
  const [answers, setAnswers] = useState(Array(questions.length).fill(''));
  const [interimTranscript, setInterimTranscript] = useState('');
  
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef(null);

  const [timeLeft, setTimeLeft] = useState(1200); // 20 minutes

  // Timer Effect
  useEffect(() => {
    if (step > 0 && step <= questions.length && timeLeft > 0) {
      const timerId = setInterval(() => {
        setTimeLeft(prev => prev - 1);
      }, 1000);
      return () => clearInterval(timerId);
    } else if (timeLeft === 0 && step <= questions.length) {
      // Auto-submit when timer hits 0
      if (isListening) toggleListen();
      compileAndSubmit();
      setStep(questions.length + 1); // move past questions
    }
  }, [step, timeLeft, questions.length]);

  // Initialize Speech Recognition
  useEffect(() => {
    let recognitionInstance = null;
    try {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true; // Use real-time parsing to reduce lag
        recognition.lang = selectedLang; // Set by candidate's language selection

        recognition.onresult = (event) => {
          let finalText = '';
          let interimText = '';
          
          for (let i = event.resultIndex; i < event.results.length; i++) {
            if (event.results[i].isFinal) {
               finalText += event.results[i][0].transcript + ' ';
            } else {
               interimText += event.results[i][0].transcript;
            }
          }
          
          setInterimTranscript(interimText);

          if (finalText) {
            setAnswers(prev => {
              const newAnswers = [...prev];
              const qIndex = step - 1;
              if (qIndex >= 0 && qIndex < questions.length) {
                  newAnswers[qIndex] = (newAnswers[qIndex] + ' ' + finalText).trim();
              }
              return newAnswers;
            });
          }
        };

        recognition.onerror = (event) => {
          console.error("Speech error", event.error);
          setIsListening(false);
        };

        recognition.onend = () => {
          setIsListening(false);
          setInterimTranscript('');
        };

        recognitionRef.current = recognition;
        recognitionInstance = recognition;
      }
    } catch (err) {
      console.warn("Speech Recognition initialization failed (likely unsupported by this mobile browser variant):", err);
    }
    
    // Cleanup when unmounting or changing step
    return () => {
        if (isListening && recognitionInstance) {
            try { recognitionInstance.stop(); } catch(e){}
            setIsListening(false);
        }
    }
  }, [step, questions.length, selectedLang]); // Re-init when language or step changes

  const toggleListen = () => {
    if (!recognitionRef.current) {
        alert("Speech Recognition is not supported in this browser. Please use Chrome.");
        return;
    }

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
      setInterimTranscript('');
    } else {
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch (e) {
        console.error(e);
      }
    }
  };

  const handleDetailsChange = (e) => {
    const { name, value } = e.target;
    setDetails(prev => ({ ...prev, [name]: value }));
  };

  const updateAnswer = (questionIndex, value) => {
    setAnswers(prev => {
        const newAnswers = [...prev];
        newAnswers[questionIndex - 1] = value; // Adjust for 0-indexed array
        return newAnswers;
    });
  };

  const preventPaste = (e) => {
      e.preventDefault();
      alert("Pasting is not allowed. Please type or speak your answer.");
  };

  const handleNext = () => {
      if (isListening) toggleListen(); // stop listening before moving
      setInterimTranscript('');
      const newStep = step + 1;
      setStep(newStep);
      // Final Submission
      if (newStep > questions.length) {
          compileAndSubmit();
      }
  };
  
  const handleBack = () => {
      if (isListening) toggleListen();
      setInterimTranscript('');
      setStep(prev => prev - 1);
  };

  const compileAndSubmit = () => {
      // Create a readable transcript string for the AI prompt
      let reportString = `CANDIDATE DETAILS:\n`;
      reportString += `Name: ${details.name || 'N/A'}\n`;
      reportString += `Qualification: ${details.qualification || 'N/A'}\n`;
      reportString += `DOB: ${details.dob || 'N/A'}\n`;
      reportString += `Hometown: ${details.hometown || 'N/A'}\n\n`;
      reportString += `INTERVIEW TRANSCRIPT:\n`;

      questions.forEach((q, idx) => {
          reportString += `\n--- Q${idx + 1}: ${q} ---\n`;
          reportString += `Candidate Answer: ${answers[idx] || "No answer provided."}\n`;
      });

      onSubmit(reportString, assessmentType);
  };

  // UI rendering
  const progressPercentage = (step / (questions.length + 1)) * 100; // +1 for details step

  return (
    <div className="bg-slate-800/80 p-6 md:p-8 rounded-2xl border border-slate-700/50 max-w-3xl mx-auto w-full shadow-xl">
        
        {/* Progress Bar */}
        <div className="w-full bg-slate-700 rounded-full h-2 mb-8 overflow-hidden">
            <div 
                className="bg-brand-500 h-2 rounded-full transition-all duration-300" 
                style={{ width: `${progressPercentage}%` }}>
            </div>
        </div>

        {/* STEP 0: DETAILS */}
        {step === 0 && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="mb-6">
                    <h2 className="text-2xl font-bold text-white mb-2">Candidate Details</h2>
                    <p className="text-slate-400">Fill out the basic information before starting the interview.</p>
                </div>
                
                <div className="space-y-4">
                    <div className="relative">
                        <User className="absolute left-3 top-3 text-slate-500" size={20} />
                        <input type="text" name="name" value={details.name} onChange={handleDetailsChange} placeholder="Candidate Name" className="w-full bg-slate-900 border border-slate-700 rounded-lg py-3 pl-10 pr-4 text-white focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500" />
                    </div>
                    
                    <div className="relative">
                        <GraduationCap className="absolute left-3 top-3 text-slate-500" size={20} />
                        <select name="qualification" value={details.qualification} onChange={handleDetailsChange} className="w-full bg-slate-900 border border-slate-700 rounded-lg py-3 pl-10 pr-4 text-slate-300 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 cursor-pointer appearance-none">
                            <option value="" disabled>Select Qualification</option>
                            <option value="Diploma">Diploma</option>
                            <option value="B.Tech">B.Tech</option>
                            <option value="MBA">MBA</option>
                            <option value="Other">Other</option>
                        </select>
                    </div>

                    <div className="relative">
                        <Calendar className="absolute left-3 top-3 text-slate-500" size={20} />
                        <input type="date" name="dob" value={details.dob} onChange={handleDetailsChange} className="w-full bg-slate-900 border border-slate-700 rounded-lg py-3 pl-10 pr-4 text-slate-300 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 [color-scheme:dark]" />
                    </div>

                    <div className="relative">
                        <MapPin className="absolute left-3 top-3 text-slate-500" size={20} />
                        <input type="text" name="hometown" value={details.hometown} onChange={handleDetailsChange} placeholder="Hometown" className="w-full bg-slate-900 border border-slate-700 rounded-lg py-3 pl-10 pr-4 text-white focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500" />
                    </div>

                    {/* Language Selector */}
                    <div className="relative">
                        <Languages className="absolute left-3 top-3 text-slate-500" size={20} />
                        <select
                            value={selectedLang}
                            onChange={(e) => setSelectedLang(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg py-3 pl-10 pr-4 text-slate-300 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 cursor-pointer appearance-none"
                        >
                            {INDIAN_LANGUAGES.map(lang => (
                                <option key={lang.value} value={lang.value}>{lang.label}</option>
                            ))}
                        </select>
                        <p className="text-xs text-slate-500 mt-1 pl-1">
                            Select your preferred language for voice input during the interview.
                        </p>
                    </div>
                </div>

                <div className="mt-8 flex justify-end">
                    <button onClick={handleNext} disabled={!details.name || !details.qualification} className="bg-brand-600 hover:bg-brand-500 text-white px-6 py-3 rounded-lg font-medium transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
                        Start Interview <ChevronRight size={20} />
                    </button>
                </div>
            </div>
        )}

        {/* STEP 1-N: QUESTIONS */}
        {step > 0 && step <= questions.length && (
            <div className="animate-in fade-in slide-in-from-right-4 duration-300 flex flex-col h-full">
                <div className="flex justify-between items-start gap-4 mb-6">
                    <div>
                        <div className="mb-2 text-brand-400 font-semibold tracking-wider text-sm uppercase">
                            Question {step} of {questions.length}
                        </div>
                        <h2 className="text-xl md:text-2xl font-bold text-white leading-relaxed">
                            {questions[step - 1]}
                        </h2>
                    </div>
                    <div className="flex flex-col items-center shrink-0">
                        <div className="relative w-14 h-14 flex items-center justify-center">
                           <svg className="w-full h-full transform -rotate-90">
                              <circle cx="28" cy="28" r="24" className="stroke-slate-700" strokeWidth="4" fill="none" />
                              <circle cx="28" cy="28" r="24" className={timeLeft < 120 ? "stroke-red-500" : "stroke-brand-500"} strokeWidth="4" fill="none" strokeDasharray="150.8" strokeDashoffset={150.8 * (1 - timeLeft / 1200)} style={{ transition: 'stroke-dashoffset 1s linear' }} />
                           </svg>
                           <span className={`absolute text-sm font-bold tracking-tighter ${timeLeft < 120 ? "text-red-400" : "text-white"}`}>{Math.floor(timeLeft/60)}:{(timeLeft%60).toString().padStart(2, '0')}</span>
                        </div>
                        <span className="text-[10px] text-slate-400 font-medium uppercase tracking-wider mt-1">Time Left</span>
                    </div>
                </div>

                <div className="relative flex-1 min-h-[250px] mb-6">
                    <textarea 
                        className="w-full h-full min-h-[250px] bg-slate-900/50 border border-slate-700/50 rounded-xl p-4 md:p-6 pb-16 text-white text-lg leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-brand-500/50 transition-all font-sans placeholder-slate-600"
                        placeholder={isListening ? "Listening..." : "Type your answer here, or click Record Audio to speak..."}
                        value={answers[step - 1] || ''}
                        onChange={(e) => updateAnswer(step, e.target.value)}
                        onPaste={preventPaste}
                    />

                    {interimTranscript && (
                        <div className="absolute inset-x-4 bottom-20 p-3 bg-brand-500/10 border border-brand-500/30 rounded-lg backdrop-blur-sm pointer-events-none">
                            <p className="text-brand-300 italic text-sm animate-pulse">{interimTranscript}...</p>
                        </div>
                    )}
                    
                    <button 
                        onClick={toggleListen}
                        className={`absolute bottom-4 right-4 flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all shadow-lg
                                   ${isListening ? 'bg-red-500/20 text-red-400 border border-red-500/50 hover:bg-red-500/30' : 'bg-slate-800 text-slate-300 border border-slate-600 hover:bg-slate-700'}`}
                    >
                        {isListening ? (
                            <><MicOff size={18} className="animate-pulse" /> Stop Recording</>
                        ) : (
                            <><Mic size={18} /> Record Audio</>
                        )}
                    </button>
                </div>

                <div className="mt-8 flex justify-between items-center">
                    <button 
                        onClick={handleBack}
                        className="flex items-center gap-2 px-4 py-2 text-slate-400 hover:text-white transition-colors font-medium"
                    >
                        <ChevronLeft size={20}/>
                        Back
                    </button>
                    <button 
                        onClick={handleNext}
                        className="flex items-center gap-2 bg-brand-600 hover:bg-brand-500 text-white px-6 py-3 rounded-xl font-bold transition-all shadow-lg shadow-brand-500/20 active:scale-95"
                    >
                        {step === questions.length ? (
                            <>Submit Interview <Send size={20}/></>
                        ) : (
                            <>Next Question <ChevronRight size={20}/></>
                        )}
                    </button>
                </div>
            </div>
        )}
    </div>
  );
}
