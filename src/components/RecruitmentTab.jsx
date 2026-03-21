import React, { useState, useRef, useEffect } from 'react';
import { Mic, MicOff, ChevronRight, ChevronLeft, CheckCircle2, User, GraduationCap, Calendar, MapPin, Send, AlertCircle } from 'lucide-react';

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

export default function RecruitmentTab({ onSubmit, assessmentType = 'recruitment' }) {
  const questions = assessmentType === 'sales_recruitment' ? SALES_QUESTIONS : FRESHER_QUESTIONS;

  const [step, setStep] = useState(0); // 0 = details, 1-N = questions
  const [details, setDetails] = useState({ name: '', qualification: '', dob: '', hometown: '' });
  const [answers, setAnswers] = useState(Array(questions.length).fill(''));
  const [interimTranscript, setInterimTranscript] = useState('');
  
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef(null);

  // Initialize Speech Recognition
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true; // Use real-time parsing to reduce lag
      recognition.lang = 'en-IN'; // Optimized for Indian English accents

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
    }
    
    // Cleanup when unmounting or changing step
    return () => {
        if (isListening && recognitionRef.current) {
            recognitionRef.current.stop();
            setIsListening(false);
        }
    }
  }, [step, questions.length]); // Added questions.length to dependencies

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
                <div className="mb-2 text-brand-400 font-semibold tracking-wider text-sm uppercase">
                    Question {step} of {questions.length}
                </div>
                <h2 className="text-xl md:text-2xl font-bold text-white mb-6 leading-relaxed">
                    {questions[step - 1]}
                </h2>

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
