import { useState, useCallback, useEffect } from 'react'
import { useDropzone } from 'react-dropzone'
import { FileUp, Loader2, FileText, FileCheck2, AlertCircle, RefreshCw, Download, CheckCircle2, ChevronRight, Check, User } from 'lucide-react'
import { extractTextFromFile } from '../utils/fileParser'
import { evaluateReport } from '../utils/aiService'
import jsPDF from 'jspdf'

function AdminDashboard() {
  const [appState, setAppState] = useState('upload') // upload, parsing, ready_for_api, api, results
  const [file, setFile] = useState(null)
  const [reportText, setReportText] = useState('')
  const [evaluationResult, setEvaluationResult] = useState(null)
  const [error, setError] = useState(null)
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false)
  const [assessmentType, setAssessmentType] = useState(null) // null, ops, sales, recruitment, sales_recruitment
  
  // Authentication State
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [loginError, setLoginError] = useState(false);
  
  // V5 Remote Recruitment States
  const [interviews, setInterviews] = useState([]);
  const [fetchingRemote, setFetchingRemote] = useState(false);

  useEffect(() => {
     if (assessmentType === 'recruitment' || assessmentType === 'sales_recruitment') {
         fetchInterviews();
     }
  }, [assessmentType])

  const fetchInterviews = async () => {
      setFetchingRemote(true);
      try {
          const res = await fetch('/api/interviews');
          if (res.ok) {
              const data = await res.json();
              setInterviews(data);
          }
      } catch(e) { console.error("Could not fetch remote interviews", e); }
      setFetchingRemote(false);
  }

  const generateLink = async (type) => {
      try {
          const res = await fetch('/api/interviews', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ assessment_type: type })
          });
          if (res.ok) {
              fetchInterviews();
          }
      } catch (e) { alert("Failed to generate link"); }
  }

  const loadSubmission = (interview) => {
      if (interview.status !== 'completed') return alert("Candidate hasn't finished yet!");
      setReportText(interview.transcript_answers?.raw || "");
      setAssessmentType(interview.assessment_type);
      setFile({ name: `Interview_ID_${interview.join_code}` });
      setAppState('ready_for_api');
  }

  const generatePDF = async () => {
    setIsGeneratingPdf(true)
    try {
      const doc = new jsPDF()
      const pageWidth = doc.internal.pageSize.getWidth()
      const margin = 20
      const imgHeight = 0 // Removed to fix CORS / Async filename bug

      let reportTitle = 'AI-Powered Evaluation System';
      if (assessmentType === 'sales_recruitment') reportTitle = 'Sales Recruitment Report';
      else if (assessmentType === 'recruitment') reportTitle = 'Fresher Recruitment Report';
      else if (assessmentType === 'sales') reportTitle = 'Sales Trainee Report';
      else if (assessmentType === 'ops') reportTitle = 'Operations Trainee Report';

      // Add Title
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(18)
      doc.text(reportTitle, pageWidth / 2, 25, { align: 'center' })

      // Add Date
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      doc.text(`Generated: ${new Date().toLocaleDateString()}`, pageWidth / 2, 32, { align: 'center' })

      // Add dividing line
      doc.setLineWidth(0.5)
      doc.line(margin, 40, pageWidth - margin, 40)

      // Add Report Content
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)

      // Split text to fit within page width, stripping emojis that crash standard jsPDF helvetica
      let safeText = evaluationResult ? evaluationResult.replace(/[^\x00-\x7F]/g, "") : "";
      
      if (reportText && (assessmentType === 'recruitment' || assessmentType === 'sales_recruitment')) {
          const safeTranscript = reportText.replace(/[^\x00-\x7F]/g, "");
          safeText += "\n\n=== ORIGINAL INTERVIEW TRANSCRIPT ===\n\n" + safeTranscript;
      }

      const splitText = doc.splitTextToSize(safeText, pageWidth - (margin * 2))

      // Determine how many lines fit on a page
      const linesPerPage = 45
      let cursorY = 50

      for (let i = 0; i < splitText.length; i++) {
        if (i > 0 && i % linesPerPage === 0) {
          doc.addPage()
          cursorY = margin // Reset Y for new page
        }
        doc.text(splitText[i], margin, cursorY)
        cursorY += 6 // Line height
      }

      // Save the PDF
      let cleanFilename = "Candidate";
      if (file?.name) {
          cleanFilename = file.name.replace(/\.[^/.]+$/, "");
      } else if (assessmentType === 'recruitment' || assessmentType === 'sales_recruitment') {
          cleanFilename = "Interview_Transcript";
      }
      
      const fileName = `RDC_Assessment_${cleanFilename}.pdf`;
      doc.save(fileName);

    } catch (err) {
      console.error("PDF generation failed:", err)
      alert("Failed to generate PDF. Please try again.")
    } finally {
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
      const text = await extractTextFromFile(selectedFile)
      if (!text || text.trim().length === 0) {
        throw new Error("No readable text found in the document.")
      }
      setReportText(text)
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
      'text/plain': ['.txt']
    },
    maxFiles: 1
  })

  const handleEvaluate = async (passedText, passedType) => {
    const textToEvaluate = passedText || reportText;
    const typeToEvaluate = passedType || assessmentType;
    
    setAppState('api')
    setError(null)
    try {
      const result = await evaluateReport(textToEvaluate, typeToEvaluate)
      setEvaluationResult(result)
      setAppState('results')
    } catch (err) {
      setError(err.message)
      // Only go back to ready_for_api if we have a file, otherwise back to upload
      setAppState(file ? 'ready_for_api' : 'upload')
    }
  }

  const handleReset = () => {
    setFile(null)
    setReportText('')
    setEvaluationResult(null)
    setError(null)
    setAppState('upload')
  }

  const handleLogin = (e) => {
    e.preventDefault();
    const expectedPassword = import.meta.env.VITE_ADMIN_PASSWORD || 'admin@rdc2026';
    if (passwordInput === expectedPassword) {
        setIsAuthenticated(true);
        setLoginError(false);
    } else {
        setLoginError('Invalid password. Please try again.');
    }
  };

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
      <header className="border-b border-slate-800 bg-slate-950/50 backdrop-blur-md sticky top-0 z-10 px-6 py-6 flex flex-col items-center justify-center text-center">
        <div className="flex flex-col items-center gap-4 mb-4">
          <img src="/rdc_logo.png" alt="RDC Logo" className="h-20 object-contain drop-shadow-md" />
          <h1 className="font-extrabold text-2xl md:text-4xl tracking-tight text-white uppercase mt-2">RDC ASSESSMENTS & RECRUITMENTS</h1>
        </div>
        <div className="max-w-2xl text-center">
          <p className="text-sm md:text-base text-slate-400 font-medium leading-relaxed">
            AI-Powered Recruitment and Assessment System
          </p>
        </div>

        {/* Assessment Type Tabs */}
        {appState !== 'results' && (
          <div className="flex items-center mt-6 w-full gap-2 p-1.5 bg-slate-900 rounded-xl max-w-4xl mx-auto border border-slate-800 overflow-x-auto hide-scrollbar">
            <button
              onClick={() => { setAssessmentType('ops'); handleReset(); }}
              className={`flex-1 min-w-[150px] py-3 px-4 rounded-lg font-medium text-sm transition-all duration-200 whitespace-nowrap ${assessmentType === 'ops' ? 'bg-brand-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'}`}
            >
              Operations Trainee
            </button>
            <button
              onClick={() => { setAssessmentType('sales'); handleReset(); }}
              className={`flex-1 min-w-[150px] py-3 px-4 rounded-lg font-medium text-sm transition-all duration-200 whitespace-nowrap ${assessmentType === 'sales' ? 'bg-brand-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'}`}
            >
              Sales Trainee
            </button>
            <button
              onClick={() => { setAssessmentType('recruitment'); handleReset(); }}
              className={`flex-1 min-w-[150px] py-3 px-4 rounded-lg font-medium text-sm transition-all duration-200 whitespace-nowrap ${assessmentType === 'recruitment' ? 'bg-brand-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'}`}
            >
              Fresher Recruitment Link
            </button>
            <button
              onClick={() => { setAssessmentType('sales_recruitment'); handleReset(); }}
              className={`flex-1 min-w-[150px] py-3 px-4 rounded-lg font-medium text-sm transition-all duration-200 whitespace-nowrap ${assessmentType === 'sales_recruitment' ? 'bg-brand-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'}`}
            >
              Sales Recruitment Link
            </button>
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
            <p className="text-slate-400 mb-6 max-w-sm mx-auto">Drag & drop a PDF, DOCX, or TXT file here, or click to browse.</p>
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

        {appState === 'upload' && (assessmentType === 'recruitment' || assessmentType === 'sales_recruitment') && (
          <div className="bg-slate-800/80 p-8 rounded-2xl border border-slate-700/50 shadow-2xl max-w-4xl mx-auto text-left">
              <div className="flex justify-between items-center mb-6 pb-4 border-b border-slate-700">
                  <h2 className="text-2xl font-bold text-white">Remote Interview Management</h2>
                  <div className="flex gap-3">
                      <button onClick={() => generateLink('recruitment')} className="px-4 py-2 bg-brand-600 hover:bg-brand-500 rounded-lg text-sm font-semibold transition-colors">
                          + New Fresher Link
                      </button>
                      <button onClick={() => generateLink('sales_recruitment')} className="px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded-lg text-sm font-semibold transition-colors">
                          + New Sales Link
                      </button>
                  </div>
              </div>

              {fetchingRemote ? (
                  <div className="flex justify-center p-8"><Loader2 className="animate-spin text-brand-500" size={32}/></div>
              ) : interviews.length === 0 ? (
                  <div className="text-center p-8 text-slate-500">No remote candidates generated yet.</div>
              ) : (
                  <div className="overflow-x-auto rounded-xl border border-slate-700/50">
                      <table className="w-full text-left bg-slate-900 border-collapse">
                          <thead>
                              <tr className="bg-slate-950/50 text-slate-400 text-sm border-b border-slate-700/50">
                                  <th className="p-4 font-semibold">Join Code</th>
                                  <th className="p-4 font-semibold">Role</th>
                                  <th className="p-4 font-semibold">Created</th>
                                  <th className="p-4 font-semibold">Status</th>
                                  <th className="p-4 font-semibold text-right">Action</th>
                              </tr>
                          </thead>
                          <tbody>
                              {interviews.map(inv => (
                                  <tr key={inv.id} className="border-b border-slate-800 hover:bg-slate-800/50 transition-colors group">
                                      <td className="p-4 font-mono font-bold text-brand-400">{inv.join_code}</td>
                                      <td className="p-4 text-slate-300">{inv.assessment_type === 'sales_recruitment' ? 'Sales' : 'Fresher'}</td>
                                      <td className="p-4 text-slate-400 text-sm">{new Date(inv.created_at).toLocaleDateString()}</td>
                                      <td className="p-4">
                                          {inv.status === 'completed' 
                                              ? <span className="px-2.5 py-1 bg-emerald-500/10 text-emerald-400 rounded-full text-xs font-bold border border-emerald-500/20">COMPLETED</span>
                                              : <span className="px-2.5 py-1 bg-amber-500/10 text-amber-400 rounded-full text-xs font-bold border border-amber-500/20">PENDING</span>
                                          }
                                      </td>
                                      <td className="p-4 text-right">
                                          {inv.status === 'pending' ? (
                                              <button onClick={() => {
                                                  navigator.clipboard.writeText(`${window.location.origin}/?code=${inv.join_code}`);
                                                  alert("Candidate Link copied to clipboard!");
                                              }} className="text-slate-400 hover:text-white text-sm bg-slate-800 px-3 py-1.5 rounded border border-slate-700">Copy Link</button>
                                          ) : (
                                              <button onClick={() => loadSubmission(inv)} className="text-white text-sm bg-brand-600 hover:bg-brand-500 px-4 py-1.5 rounded font-semibold shadow-lg">Evaluate AI →</button>
                                          )}
                                      </td>
                                  </tr>
                              ))}
                          </tbody>
                      </table>
                  </div>
              )}
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
                <span>Evaluate {assessmentType === 'ops' ? 'Operations' : 'Sales'} Report</span>
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

            <div className="bg-slate-900/50 p-6 rounded-xl border border-slate-700/50 whitespace-pre-wrap font-mono text-sm leading-relaxed text-slate-300 overflow-x-auto">
              {evaluationResult}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

export default AdminDashboard
