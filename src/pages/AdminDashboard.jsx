import { useState, useCallback, useEffect } from 'react'
import { useDropzone } from 'react-dropzone'
import { FileUp, Loader2, FileText, FileCheck2, AlertCircle, RefreshCw, Download, CheckCircle2, ChevronRight, Check, User, Trash2, Upload } from 'lucide-react'
import { extractTextFromFile } from '../utils/fileParser'
import { evaluateReport } from '../utils/aiService'
import { toJpeg } from 'html-to-image'
import { jsPDF } from 'jspdf'
import { BASE, withBase } from '../basePath'

function AdminDashboard() {
  const [appState, setAppState] = useState('upload') // upload, parsing, ready_for_api, api, results
  const [file, setFile] = useState(null)
  const [reportText, setReportText] = useState('')
  const [evaluationResult, setEvaluationResult] = useState(null)
  const [error, setError] = useState(null)
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false)
  const [assessmentType, setAssessmentType] = useState(null) // null, ops, sales, recruitment, sales_recruitment
  const [selectedJoinCode, setSelectedJoinCode] = useState(null)
  const [fileBase64, setFileBase64] = useState(null)
  const [fileMimeType, setFileMimeType] = useState(null)
  
  // Authentication State
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [loginError, setLoginError] = useState(false);
  // Set when the HR platform has already identified the caller; null elsewhere.
  const [hrEmail, setHrEmail] = useState(null);

  // On the HR platform nginx has already verified the caller against the HR
  // allowlist and forwards their identity, so asking for a password again is
  // pointless friction. /api/admin/me reports that identity; when it comes back
  // we sign the user straight in. Elsewhere it returns null and the password
  // screen behaves exactly as before.
  const [ssoChecked, setSsoChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(withBase('/api/admin/me'));
        if (res.ok) {
          const { email } = await res.json();
          if (email && !cancelled) {
            setHrEmail(email);
            setIsAuthenticated(true);
            setSsoChecked(true);
            return;
          }
        }
      } catch { /* fall through to the password screen */ }
      if (cancelled) return;
      if (localStorage.getItem('adminAuth') === 'true') setIsAuthenticated(true);
      setSsoChecked(true);
    })();
    return () => { cancelled = true; };
  }, []);

  const handleLogout = () => {
    // Signed in through the HR portal: clearing local state would achieve
    // nothing, since the next page load would be recognised again. End the
    // shared session at the portal instead.
    if (hrEmail) {
      window.location.href = '/api/auth/logout';
      return;
    }
    setIsAuthenticated(false);
    localStorage.removeItem('adminAuth');
    setPasswordInput('');
  };
  
  // V5 Remote Recruitment States
  const [interviews, setInterviews] = useState([]);
  const [fetchingRemote, setFetchingRemote] = useState(false);


  useEffect(() => {
     if (assessmentType === 'recruitment' || assessmentType === 'sales_recruitment' || assessmentType === 'kaushal_mm' || assessmentType === 'kaushal_tech' || assessmentType === 'kaushal_batching') {
         fetchInterviews();
     }
  }, [assessmentType])

  const fetchInterviews = async () => {
      setFetchingRemote(true);
      try {
          const res = await fetch(withBase('/api/admin/interviews'));
          if (res.ok) {
              const data = await res.json();
              setInterviews(data);
          }
      } catch(e) { console.error("Could not fetch remote interviews", e); }
      setFetchingRemote(false);
  }

  const generateLink = async (type) => {
      try {
          const res = await fetch(withBase('/api/admin/interviews'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ assessment_type: type })
          });
          if (res.ok) {
              fetchInterviews();
          }
      } catch (err) { console.error(err); alert("Failed to generate link"); }
  }

  const extractName = (text) => {
      if (!text) return '';
      const match = text.match(/Name:\s*(.+)/i);
      return match && match[1] !== 'N/A' ? match[1].trim() : '';
  };

  const deleteInterview = async (code) => {
      if (!window.confirm("Are you sure you want to delete this interview record? This action cannot be undone.")) return;
      try {
          const res = await fetch(withBase(`/api/admin/interviews/${code}`), {
              method: 'DELETE'
          });
          if (res.ok) {
              fetchInterviews();
          } else {
              alert("Failed to delete interview");
          }
      } catch (err) { console.error(err); alert("Failed to delete interview"); }
  }

  const getCorrectHeading = (type) => {
    switch(type) {
      case 'ops': return 'Trainee Report Assessment - Operations';
      case 'sales': return 'Trainee Report Assessment - Sales';
      case 'recruitment': return 'Candidate Recruitment Assessment - Fresher';
      case 'sales_recruitment': return 'Candidate Recruitment Assessment - Sales';
      case 'kaushal_mm': return 'Kaushal - MM Assessment';
      case 'kaushal_tech': return 'Kaushal Technical Assessment - Concrete Technology';
      case 'kaushal_batching': return 'Kaushal Assessment - Batching Operations';
      default: return 'Assessment Report';
    }
  }

  const generatePartAHtml = (partA) => {
      if (!partA || !partA.questions || partA.questions.length === 0) return '';

      const accuracy = Math.round((partA.score / partA.total) * 100);
      const scoreColor = accuracy > 80 ? '#2E7D32' : accuracy >= 65 ? '#E65100' : '#C62828';
      const scoreBg = accuracy > 80 ? '#E8F5E9' : accuracy >= 65 ? '#FFF3E0' : '#FFEBEE';

      let tableRows = '';
      partA.questions.forEach((q, idx) => {
          const isCorrect = q.is_correct;
          const statusIcon = isCorrect 
              ? `<span style="color: #2E7D32; font-weight: bold; font-size: 18px;">✓</span>`
              : `<span style="color: #C62828; font-weight: bold; font-size: 18px;">✗</span>`;
          const rowBg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
          
          const selectedText = q.selected_option === 'No Answer' ? 'No Answer' : `Option ${q.selected_option}`;
          const correctText = `Option ${q.correct_option}`;
          
          tableRows += `
              <tr style="background-color: ${rowBg}; border-bottom: 1px solid #e2e8f0;">
                  <td style="padding: 12px; font-weight: 500; color: #475569; text-align: center;">${idx + 1}</td>
                  <td style="padding: 12px; color: #1e293b;">${q.question}</td>
                  <td style="padding: 12px; color: ${isCorrect ? '#2E7D32' : '#C62828'}; font-weight: 600; text-align: center;">${selectedText}</td>
                  <td style="padding: 12px; color: #475569; font-weight: 500; text-align: center;">${correctText}</td>
                  <td style="padding: 12px; text-align: center;">${statusIcon}</td>
              </tr>
          `;
      });

      return `
          <div style="font-family: system-ui, -apple-system, sans-serif; margin-bottom: 40px; padding: 24px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); text-align: left;">
              <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #f1f5f9; padding-bottom: 16px; margin-bottom: 20px;">
                  <h2 style="margin: 0; font-size: 20px; font-weight: 800; color: #0f172a; text-transform: uppercase; letter-spacing: 0.05em;">Part A: Objective MCQ Evaluation</h2>
                  <div style="background-color: ${scoreBg}; color: ${scoreColor}; padding: 8px 16px; border-radius: 9999px; font-size: 16px; font-weight: 800; border: 1px solid ${scoreColor}40;">
                      ${accuracy}%
                  </div>
              </div>
              
              <div style="display: flex; gap: 24px; margin-bottom: 24px; flex-wrap: wrap;">
                  <div style="flex: 1; min-width: 140px; background-color: #f8fafc; border: 1px solid #f1f5f9; border-radius: 12px; padding: 16px; text-align: center;">
                      <div style="font-size: 32px; font-weight: 800; color: #2563eb; line-height: 1;">${partA.score}</div>
                      <div style="font-size: 12px; font-weight: 600; color: #64748b; margin-top: 8px; text-transform: uppercase;">Correct Answers</div>
                  </div>
                  <div style="flex: 1; min-width: 140px; background-color: #f8fafc; border: 1px solid #f1f5f9; border-radius: 12px; padding: 16px; text-align: center;">
                      <div style="font-size: 32px; font-weight: 800; color: #ef4444; line-height: 1;">${partA.total - partA.score}</div>
                      <div style="font-size: 12px; font-weight: 600; color: #64748b; margin-top: 8px; text-transform: uppercase;">Incorrect / Unanswered</div>
                  </div>
                  <div style="flex: 1; min-width: 140px; background-color: #f8fafc; border: 1px solid #f1f5f9; border-radius: 12px; padding: 16px; text-align: center;">
                      <div style="font-size: 32px; font-weight: 800; color: #0f172a; line-height: 1;">${partA.total}</div>
                      <div style="font-size: 12px; font-weight: 600; color: #64748b; margin-top: 8px; text-transform: uppercase;">Total Questions</div>
                  </div>
              </div>

              <div style="overflow-x: auto;">
                  <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 13px;">
                      <thead>
                          <tr style="background-color: #f1f5f9; border-bottom: 2px solid #e2e8f0;">
                              <th style="padding: 12px; font-weight: 700; color: #334155; width: 60px; text-align: center;">Q.No.</th>
                              <th style="padding: 12px; font-weight: 700; color: #334155;">Question Scenario</th>
                              <th style="padding: 12px; font-weight: 700; color: #334155; width: 140px; text-align: center;">Selected Answer</th>
                              <th style="padding: 12px; font-weight: 700; color: #334155; width: 140px; text-align: center;">Correct Answer</th>
                              <th style="padding: 12px; font-weight: 700; color: #334155; width: 80px; text-align: center;">Status</th>
                          </tr>
                      </thead>
                      <tbody>
                          ${tableRows}
                      </tbody>
                  </table>
              </div>
          </div>
      `;
  };

  const handleMcqUpload = async (e, type) => {
      const uFile = e.target.files[0];
      if (!uFile) return;

      const reader = new FileReader();
      reader.onload = async (evt) => {
          try {
              const base64Data = evt.target.result;
              const response = await fetch(withBase('/api/admin/interviews/mcq-upload'), {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ fileData: base64Data, assessmentType: type })
              });
              
              if (!response.ok) {
                  const errData = await response.json().catch(() => ({}));
                  throw new Error(errData.error || "Failed to upload MCQ questions.");
              }

              const data = await response.json();
              alert(`Successfully uploaded MCQ Question Bank! Imported ${data.count} questions.`);
          } catch (err) {
              console.error("MCQ upload failed:", err);
              alert("Error: " + err.message);
          }
      };
      reader.readAsDataURL(uFile);
  };

  const loadSubmission = (interview) => {
      if (interview.status !== 'completed') return alert("Candidate hasn't finished yet!");
      const rawText = interview.transcript_answers?.part_b?.raw || interview.transcript_answers?.raw || "";
      setReportText(rawText);
      setAssessmentType(interview.assessment_type);
      setFile({ name: `Interview_ID_${interview.join_code}` });
      setSelectedJoinCode(interview.join_code);
      
      if (interview.ai_report) {
          const cleanReport = interview.ai_report.replace(/<h1[^>]*>.*?<\/h1>/i, `<h1 style="margin: 0; color: #2E7D32;">${getCorrectHeading(interview.assessment_type)}</h1>`);
          let finalReportHtml = cleanReport;
          if (interview.transcript_answers?.part_a) {
              const partAHtml = generatePartAHtml(interview.transcript_answers.part_a);
              finalReportHtml = partAHtml + cleanReport;
          }
          setEvaluationResult(finalReportHtml);
          setAppState('results');
      } else {
          setAppState('ready_for_api');
      }
  }

  const generatePDF = async () => {
    setIsGeneratingPdf(true);
    
    try {
      let cleanFilename = "Candidate";
      if (file?.name) {
          cleanFilename = file.name.replace(/\.[^/.]+$/, "");
      } else if (assessmentType === 'recruitment' || assessmentType === 'sales_recruitment' || assessmentType === 'kaushal_mm' || assessmentType === 'kaushal_tech' || assessmentType === 'kaushal_batching') {
          cleanFilename = "Interview_Transcript";
      }

      const safeFilename = cleanFilename.replace(/[^a-zA-Z0-9_\- ]/g, "_");
      const fileName = `RDC_Assessment_${safeFilename}.pdf`;
      
      const element = document.getElementById('report-container-pdf');
      
      // Use modern SVG-based DOM snapshotting that completely bypasses JS-based CSS parsers like html2canvas.
      // This makes it completely immune to Tailwind CSS's oklch variable parsing crash.
      const imgData = await toJpeg(element, { quality: 0.98, backgroundColor: '#ffffff', pixelRatio: 2 });
      
      // Calculate real image aspect ratio and height mapped to A4 width
      const dummyPdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
      const pdfProps = dummyPdf.getImageProperties(imgData);
      const pdfWidth = dummyPdf.internal.pageSize.getWidth();
      const pdfHeight = (pdfProps.height * pdfWidth) / pdfProps.width;

      // Use a custom format array to ensure the PDF is ONE single continuous vertical scrolling page.
      // This completely eliminates clipping lines, seams, or page break rendering glitches.
      const pdf = new jsPDF({ 
          unit: 'mm', 
          format: [pdfWidth, pdfHeight], 
          orientation: 'portrait' 
      });
      
      pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(fileName);
      setIsGeneratingPdf(false);
      
    } catch (err) {
      console.error("PDF generation failed:", err)
      alert("Failed to generate PDF. Error: " + (err.message || err.toString()))
      setIsGeneratingPdf(false)
    }
  }

  const onDrop = useCallback(async (acceptedFiles) => {
    setError(null)
    const selectedFile = acceptedFiles[0]
    if (!selectedFile) return

    setFile(selectedFile)
    setAppState('parsing')

    try {
      let text = ""
      let base64Data = null
      const mimeType = selectedFile.type

      if (selectedFile.type === 'application/pdf' || selectedFile.type.startsWith('image/')) {
        // Read file as base64 Data URL
        base64Data = await new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.readAsDataURL(selectedFile)
          reader.onload = () => resolve(reader.result)
          reader.onerror = (error) => reject(error)
        })

        // For PDFs, still try to extract text for client-side preview
        if (selectedFile.type === 'application/pdf') {
          try {
            text = await extractTextFromFile(selectedFile)
          } catch (e) {
            console.log("Digital text extraction failed, falling back to base64 OCR:", e)
          }
        }

        if (!text || text.trim().length === 0) {
          text = `[Scanned Document / Image: Visual mode active. Gemini will parse and evaluate the document pages directly.]`
        }
      } else {
        // For DOCX or TXT files
        text = await extractTextFromFile(selectedFile)
        if (!text || text.trim().length === 0) {
          throw new Error("No readable text found in the document.")
        }
      }

      setReportText(text)
      setFileBase64(base64Data)
      setFileMimeType(mimeType)
      setAppState('ready_for_api')
    } catch (err) {
      setError(err.message)
      setAppState('upload')
    }
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'text/plain': ['.txt'],
      'image/png': ['.png'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/webp': ['.webp']
    },
    maxFiles: 1
  })

  const handleEvaluate = async (passedText, passedType) => {
    const textToEvaluate = passedText || reportText;
    const typeToEvaluate = passedType || assessmentType;
    
    setAppState('api')
    setError(null)
    try {
      let cachedResult = null;
      if (selectedJoinCode) {
        const cachedInterview = interviews.find(i => i.join_code === selectedJoinCode);
        if (cachedInterview && cachedInterview.ai_report) {
            cachedResult = cachedInterview.ai_report;
        }
      }

      let result = cachedResult;
      if (!result) {
        result = await evaluateReport(textToEvaluate, typeToEvaluate, fileBase64, fileMimeType);
        
        // Save to DB so it doesn't regenerate
        if (selectedJoinCode) {
           await fetch(withBase(`/api/admin/interviews/${selectedJoinCode}/report`), {
               method: 'POST',
               headers: { 'Content-Type': 'application/json' },
               body: JSON.stringify({ ai_report: result })
           }).catch(err => console.error("Could not cache to DB", err));
           
           // Update local state to immediately mark this interview as evaluated
           setInterviews(prev => prev.map(inv => 
               inv.join_code === selectedJoinCode ? { ...inv, ai_report: result } : inv
           ));
        }
      }

      // Enforce the correct contextual heading dynamically using a regex replace.
      let finalReportHtml = result;
      const currentInterview = interviews.find(i => i.join_code === selectedJoinCode);
      if (currentInterview && currentInterview.transcript_answers?.part_a) {
          const partAHtml = generatePartAHtml(currentInterview.transcript_answers.part_a);
          finalReportHtml = partAHtml + result;
      }

      const cleanedResult = finalReportHtml.replace(/<h1[^>]*>.*?<\/h1>/i, `<h1 style="margin: 0; color: #2E7D32;">${getCorrectHeading(typeToEvaluate)}</h1>`);

      setEvaluationResult(cleanedResult);
      setAppState('results');
    } catch (err) {
      setError(err.message)
      // Only go back to ready_for_api if we have a file, otherwise back to upload
      setAppState(file ? 'ready_for_api' : 'upload')
    }
  }

  const handleReset = () => {
    setFile(null)
    setReportText('')
    setFileBase64(null)
    setFileMimeType(null)
    setEvaluationResult(null)
    setSelectedJoinCode(null)
    setError(null)
    setAppState('upload')
  }

  const handleLogin = (e) => {
    e.preventDefault();
    const expectedPassword = import.meta.env.VITE_ADMIN_PASSWORD || 'admin@rdc2026';
    if (passwordInput === expectedPassword) {
        setIsAuthenticated(true);
        setLoginError(false);
        localStorage.setItem('adminAuth', 'true');
    } else {
        setLoginError('Invalid password. Please try again.');
    }
  };

  // Don't flash the password screen while the SSO check is still in flight —
  // on the HR platform it resolves to "already signed in".
  if (!ssoChecked) {
      return (
          <div className="min-h-screen bg-slate-900 text-slate-100 font-sans flex items-center justify-center">
              <Loader2 className="animate-spin text-slate-500" size={28} />
          </div>
      );
  }

  if (!isAuthenticated) {
      return (
          <div className="min-h-screen bg-slate-900 text-slate-100 font-sans flex items-center justify-center p-6">
              <div className="bg-slate-800/80 p-8 rounded-2xl border border-slate-700/50 shadow-2xl max-w-sm w-full text-center">
                  <div className="w-16 h-16 bg-brand-500/10 rounded-full flex items-center justify-center mx-auto mb-4 border border-brand-500/20">
                      <User className="text-brand-400" size={32} />
                  </div>
                  <h2 className="text-2xl font-bold text-white mb-2">Admin Portal</h2>
                  <p className="text-slate-400 mb-8 text-sm">Please log in to manage candidates and access AI evaluation reports.</p>
                  
                  <form onSubmit={handleLogin} className="space-y-4">
                      <input 
                          type="password" 
                          placeholder="Admin Password"
                          value={passwordInput}
                          onChange={(e) => setPasswordInput(e.target.value)}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg py-3 px-4 text-white placeholder:text-slate-600 focus:outline-none focus:border-brand-500"
                      />
                      {loginError && <p className="text-red-400 text-sm text-center">{loginError}</p>}
                      <button 
                          type="submit"
                          className="w-full bg-brand-600 hover:bg-brand-500 text-white font-semibold py-3 rounded-lg transition-colors"
                      >
                          Secure Login
                      </button>
                  </form>
              </div>
          </div>
      );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans selection:bg-brand-500/30">
      <header className="relative border-b border-slate-800 bg-slate-950/50 backdrop-blur-md sticky top-0 z-10 px-6 py-6 flex flex-col items-center justify-center text-center">
        <div className="absolute top-6 right-6 flex items-center gap-3">
            {hrEmail && <span className="text-sm text-slate-400 hidden sm:inline">{hrEmail}</span>}
            <button
                onClick={handleLogout}
                className="text-sm text-slate-400 hover:text-white bg-slate-800/50 px-3 py-1.5 rounded border border-slate-700 transition"
            >
                {hrEmail ? 'Sign out' : 'Logout'}
            </button>
        </div>
        <div className="flex flex-col items-center gap-4 mb-4">
          <img src={withBase("/rdc_logo.png")} alt="RDC Logo" className="h-20 object-contain drop-shadow-md" />
          <h1 className="font-extrabold text-2xl md:text-4xl tracking-tight text-white uppercase mt-2">RDC ASSESSMENTS & RECRUITMENTS</h1>
        </div>
        <div className="max-w-2xl text-center">
          <p className="text-sm md:text-base text-slate-400 font-medium leading-relaxed">
            AI-Powered Recruitment and Assessment System
          </p>
        </div>

        {/* Scalable Assessment Type Navigation */}
        {appState !== 'results' && (
          <div className="flex justify-center mt-6 w-full max-w-sm mx-auto">
            <select
                value={assessmentType || ''}
                onChange={(e) => {
                    const val = e.target.value;
                    if (val) {
                        setAssessmentType(val);
                        handleReset();
                    } else {
                        setAssessmentType(null);
                    }
                }}
                className="w-full bg-slate-900 border-2 border-slate-700 text-white rounded-xl px-4 py-3 text-sm font-semibold focus:outline-none focus:border-brand-500 shadow-xl cursor-pointer"
            >
                <option value="" disabled>-- Select Assessment Dashboard --</option>
                <optgroup label="Offline PDF Evaluators">
                    <option value="ops">Operations Trainee Eval</option>
                    <option value="sales">Sales Trainee Eval</option>
                </optgroup>
                <optgroup label="Remote Assessment Links">
                    <option value="recruitment">Fresher Recruitment</option>
                    <option value="sales_recruitment">Sales Recruitment</option>
                    <option value="kaushal_mm">Kaushal MM Validation</option>
                    <option value="kaushal_tech">Kaushal Technical (Concrete)</option>
                    <option value="kaushal_batching">Kaushal Batching</option>
                </optgroup>
            </select>
          </div>
        )}

      </header>

      <main className="max-w-4xl mx-auto p-6 md:p-8 w-full mt-4">
        {appState === 'upload' && !assessmentType && (
          <div className="text-center p-12 text-slate-400 border border-slate-700 rounded-2xl bg-slate-800/20 max-w-3xl mx-auto shadow-inner">
            <User size={48} className="mx-auto mb-4 text-slate-500 opacity-50" />
            <h2 className="text-2xl font-semibold text-white mb-2">Welcome to RDC Admin Panel</h2>
            <p>Select a trainee tab to evaluate reports, or generate remote recruitment links.</p>
          </div>
        )}

        {appState === 'upload' && (assessmentType === 'ops' || assessmentType === 'sales') && (
          <div
            {...getRootProps()}
            className={`cursor-pointer text-center p-12 rounded-2xl border-2 border-dashed transition-all w-full max-w-3xl mx-auto
              ${isDragActive
                ? 'border-brand-500 bg-brand-500/10 scale-[1.02]'
                : 'border-slate-700 hover:border-slate-500 bg-slate-800/30 hover:bg-slate-800/80'}`}
          >
            <input {...getInputProps()} />
            <div className="w-16 h-16 rounded-full bg-slate-700/50 flex items-center justify-center mx-auto mb-4 text-brand-400">
              <FileUp size={32} />
            </div>
            <h2 className="text-2xl font-semibold mb-2 text-white">Upload Monthly Report</h2>
            <p className="text-slate-400 mb-6 max-w-sm mx-auto">Drag & drop a PDF, DOCX, TXT, or Image file here, or click to browse.</p>
            <button className="bg-brand-600 hover:bg-brand-500 text-white px-6 py-3 rounded-xl font-medium transition-all shadow-lg shadow-brand-500/20 pointer-events-none">
              Select File
            </button>
            {error && (
              <div className="mt-6 flex justify-center items-center gap-2 text-red-400 bg-red-400/10 py-2 px-4 rounded-lg">
                <AlertCircle size={18} />
                <span className="text-sm">{error}</span>
              </div>
            )}
          </div>
        )}

        {appState === 'upload' && (assessmentType === 'recruitment' || assessmentType === 'sales_recruitment' || assessmentType === 'kaushal_mm' || assessmentType === 'kaushal_tech' || assessmentType === 'kaushal_batching') && (
          <div className="bg-slate-800/80 p-8 rounded-2xl border border-slate-700/50 shadow-2xl max-w-4xl mx-auto text-left">
              
              {/* Part A MCQ Upload block for Kaushal Assessments */}
              {(assessmentType === 'kaushal_mm' || assessmentType === 'kaushal_tech' || assessmentType === 'kaushal_batching') && (
                  <div className="mb-8 p-6 bg-slate-900/50 rounded-xl border border-slate-700/50 flex flex-col md:flex-row items-center justify-between gap-4 animate-in fade-in duration-300">
                      <div>
                          <h3 className="text-lg font-bold text-white mb-1">Part A (MCQ) Question Bank</h3>
                          <p className="text-xs text-slate-400 max-w-xl">Upload a spreadsheet (.xlsx/.xls/.csv) to configure MCQ questions for this assessment. A maximum of 25 random questions will be asked.</p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                          <label className="cursor-pointer bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors border border-slate-700 shadow-md flex items-center gap-2">
                              <Upload size={16} className="text-brand-400" />
                              <span>Upload MCQ Template</span>
                              <input
                                  type="file"
                                  accept=".xlsx,.xls,.csv"
                                  className="hidden"
                                  onChange={(e) => handleMcqUpload(e, assessmentType)}
                              />
                          </label>
                      </div>
                  </div>
              )}

              <div className="flex justify-between items-center mb-6 pb-4 border-b border-slate-700">
                  <h2 className="text-2xl font-bold text-white">Remote Interview Management</h2>
                  <button onClick={() => generateLink(assessmentType)} className="px-5 py-2 bg-brand-600 hover:bg-brand-500 rounded-lg text-sm font-semibold transition-colors whitespace-nowrap shadow-lg">
                      + Generate Link
                  </button>
              </div>

              {(() => {
                  const filteredInterviews = interviews.filter(inv => inv.assessment_type === assessmentType);
                  return fetchingRemote ? (
                      <div className="flex justify-center p-8"><Loader2 className="animate-spin text-brand-500" size={32}/></div>
                  ) : filteredInterviews.length === 0 ? (
                      <div className="text-center p-8 text-slate-500">No candidates found for this assessment type yet. Generate a link above to get started.</div>
                  ) : (
                      <div className="overflow-x-auto rounded-xl border border-slate-700/50">
                          <table className="w-full text-left bg-slate-900 border-collapse">
                              <thead>
                                  <tr className="bg-slate-950/50 text-slate-400 text-sm border-b border-slate-700/50">
                                      <th className="p-4 font-semibold">Join Code</th>
                                      <th className="p-4 font-semibold">Created</th>
                                      <th className="p-4 font-semibold">Status</th>
                                      <th className="p-4 font-semibold">Name</th>
                                      <th className="p-4 font-semibold text-right">Action</th>
                                  </tr>
                              </thead>
                              <tbody>
                                  {filteredInterviews.map(inv => (
                                      <tr key={inv.id} className="border-b border-slate-800 hover:bg-slate-800/50 transition-colors group">
                                          <td className="p-4 font-mono font-bold text-brand-400">{inv.join_code}</td>
                                          <td className="p-4 text-slate-400 text-sm">{new Date(inv.created_at).toLocaleDateString()}</td>
                                          <td className="p-4">
                                              {inv.status === 'completed' 
                                                  ? <span className="px-2.5 py-1 bg-emerald-500/10 text-emerald-400 rounded-full text-xs font-bold border border-emerald-500/20">COMPLETED</span>
                                                  : <span className="px-2.5 py-1 bg-amber-500/10 text-amber-400 rounded-full text-xs font-bold border border-amber-500/20">PENDING</span>
                                              }
                                          </td>
                                          <td className="p-4 font-medium text-slate-300">
                                              {inv.status === 'completed' && inv.transcript_answers?.raw 
                                                  ? extractName(inv.transcript_answers.raw) || "Candidate"
                                                  : "-"
                                              }
                                          </td>
                                          <td className="p-4 text-right flex items-center justify-end gap-2 h-full">
                                              {inv.status === 'pending' ? (
                                                  <button onClick={() => {
                                                      navigator.clipboard.writeText(`${window.location.origin}${BASE}/?code=${inv.join_code}`);
                                                      alert("Candidate Link copied to clipboard!");
                                                  }} className="text-slate-400 hover:text-white text-sm bg-slate-800 px-3 py-1.5 rounded border border-slate-700 h-8">Copy Link</button>
                                              ) : inv.ai_report ? (
                                                  <button onClick={() => loadSubmission(inv)} className="text-white text-sm bg-blue-600 hover:bg-blue-500 px-4 py-1.5 rounded font-semibold shadow-lg h-8 border border-blue-500/50">View Cached Report →</button>
                                              ) : (
                                                  <button onClick={() => loadSubmission(inv)} className="text-white text-sm bg-brand-600 hover:bg-brand-500 px-4 py-1.5 rounded font-semibold shadow-lg h-8">Evaluate AI ✨</button>
                                              )}
                                              <button 
                                                  onClick={() => deleteInterview(inv.join_code)}
                                                  className="text-red-400 hover:text-red-300 hover:bg-red-500/20 p-1.5 rounded transition-colors h-8 flex items-center justify-center cursor-pointer ml-2"
                                                  title="Delete record"
                                              >
                                                  <Trash2 size={16} />
                                              </button>
                                          </td>
                                      </tr>
                                  ))}
                              </tbody>
                          </table>
                      </div>
                  );
              })()}
          </div>
        )}

        {appState === 'parsing' && (
          <div className="text-center bg-slate-800/50 p-16 rounded-2xl border border-slate-700/50 flex flex-col items-center justify-center min-h-[400px] max-w-3xl mx-auto">
            <Loader2 className="animate-spin text-brand-500 mb-6" size={48} />
            <h2 className="text-xl font-semibold mb-2 text-white">Extracting text...</h2>
            <p className="text-slate-400">Reading contents of {file?.name}</p>
          </div>
        )}

        {appState === 'ready_for_api' && (
          <div className="bg-slate-800/80 p-8 rounded-2xl border border-slate-700/50 max-w-3xl mx-auto">
            <div className="flex items-center gap-4 mb-6 pb-6 border-b border-slate-700">
              <div className="w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                <FileCheck2 size={24} />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-xl font-semibold text-white truncate">{file?.name}</h2>
                <p className="text-slate-400 text-sm">Successfully extracted {reportText.length.toLocaleString()} characters</p>
              </div>
              <button
                onClick={handleReset}
                className="text-slate-400 hover:text-white px-3 py-2 text-sm transition-colors"
              >
                Change File
              </button>
            </div>

            <div className="bg-slate-900 rounded-xl p-4 mb-8 h-48 overflow-y-auto border border-slate-700/50 font-mono text-sm text-slate-300 whitespace-pre-wrap">
              {reportText}
            </div>

            {error && (
              <div className="mb-6 flex justify-center items-center gap-2 text-red-400 bg-red-400/10 py-3 px-4 rounded-lg">
                <AlertCircle size={20} />
                <span className="text-sm font-medium">{error}</span>
              </div>
            )}

            <div className="flex justify-end relative">
              <div className="absolute inset-0 bg-brand-500/20 blur-2xl rounded-full"></div>
              <button
                onClick={() => handleEvaluate(reportText, assessmentType)}
                className="relative bg-brand-600 hover:bg-brand-500 text-white px-8 py-4 rounded-xl font-semibold text-lg transition-all shadow-lg shadow-brand-500/20 active:scale-95 flex items-center gap-3 w-full sm:w-auto justify-center"
              >
                <span>Evaluate {
                    assessmentType === 'ops' ? 'Operations Report' : 
                    assessmentType === 'sales' ? 'Sales Report' : 
                    assessmentType === 'recruitment' ? 'Fresher' :
                    assessmentType === 'sales_recruitment' ? 'Sales Recruitment' : 
                    assessmentType === 'kaushal_mm' ? 'Kaushal MM' : 
                    assessmentType === 'kaushal_batching' ? 'Kaushal Batching' : 'Report'
                }</span>
                <span className="text-2xl leading-none">✨</span>
              </button>
            </div>
          </div>
        )}

        {appState === 'api' && (
          <div className="text-center bg-slate-800/50 p-16 rounded-2xl border border-slate-700/50 flex flex-col items-center justify-center min-h-[400px] max-w-3xl mx-auto">
            <Loader2 className="animate-spin text-brand-500 mb-6" size={48} />
            <h2 className="text-xl font-semibold mb-2 text-white">Evaluating with Gemini AI...</h2>
              <p className="text-slate-400 max-w-sm mx-auto">Analyzing the report against the RDC skill parameters. This usually takes 5-15 seconds.</p>
          </div>
        )}

        {appState === 'results' && (
          <div className="bg-slate-800/80 p-6 md:p-8 rounded-2xl border border-slate-700/50 shadow-2xl">
            <div className="flex items-center justify-between mb-8 pb-6 border-b border-slate-700/50">
              <div>
                <h2 className="text-2xl font-bold text-white mb-1">Assessment Complete</h2>
                <p className="text-slate-400">Evaluated document: <span className="text-slate-300 font-medium">{file?.name}</span></p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={generatePDF}
                  disabled={isGeneratingPdf}
                  className="flex items-center gap-2 bg-brand-600 hover:bg-brand-500 text-white px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isGeneratingPdf ? <Loader2 className="animate-spin" size={18} /> : <Download size={18} />}
                  <span>{isGeneratingPdf ? 'Generating...' : 'Download PDF'}</span>
                </button>
                <button
                  onClick={handleReset}
                  className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                >
                  <RefreshCw size={18} />
                  <span>Start Over</span>
                </button>
              </div>
            </div>

            <div 
              id="report-container-pdf"
              className="bg-white p-8 rounded-xl border border-slate-200 shadow-sm text-slate-800"
            >
              <div dangerouslySetInnerHTML={{ __html: evaluationResult }} />
              
              {reportText && (
                <div className="mt-12 pt-8 border-t border-slate-200">
                    <h3 className="text-2xl font-bold text-slate-800 mb-6 pb-2 border-b-2 border-brand-500 inline-block">Appendix: Original Interview Transcript</h3>
                    <div className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-slate-700 bg-slate-50 p-6 rounded-lg border border-slate-200">
                        {reportText}
                    </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

export default AdminDashboard
