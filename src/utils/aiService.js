import { GoogleGenAI } from '@google/genai';

const HTML_OUTPUT_INSTRUCTIONS = `
## OUTPUT FORMAT - CRITICAL INSTRUCTION
You MUST output your ENTIRE final report exactly as raw HTML using the precise structure below.
DO NOT wrap the output in markdown code blocks (\`\`\`html). Just output the raw HTML string.
Calculate the percentage dynamically based on the max possible score for this assessment (e.g., if total score is X out of Max, Percentage = (X/Max)*100).

<div style="font-family: sans-serif; border: 1px solid #e0e0e0; padding: 25px; border-radius: 8px; background: #fff;">

<div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #2E7D32; padding-bottom: 15px;">
    <div>
        <h1 style="margin: 0; color: #2E7D32;">[ASSESSMENT TITLE]</h1>
        <p style="margin: 5px 0; color: #666;">Candidate: <strong>[CANDIDATE OR TRAINEE NAME]</strong></p>
    </div>
    <div style="text-align: right;">
        <div style="font-size: 24px; font-weight: bold; color: #F57C00;">[PERCENTAGE]%</div>
        <div style="font-size: 12px; text-transform: uppercase; color: #F57C00;">[TOTAL SCORE IN PTS] | [OVERALL RATING/VERDICT]</div>
    </div>
</div>

<br>

<h3 style="color: #2E7D32;">Executive Summary</h3>
<p style="line-height: 1.6;">[2-3 Sentences detailing the candidate's core competencies and primary readiness level]</p>

<div style="display: flex; gap: 20px; margin: 20px 0;">
    <div style="flex: 1; background: #E8F5E9; padding: 15px; border-radius: 5px;">
        <strong style="color: #2E7D32;">✓ Core Strengths</strong>
        <ul style="padding-left: 20px; font-size: 14px; margin-bottom: 0;">
            <li>[Strength 1]</li>
            <li>[Strength 2]</li>
            <li>[Strength 3]</li>
        </ul>
    </div>
    <div style="flex: 1; background: #FFF3E0; padding: 15px; border-radius: 5px;">
        <strong style="color: #E65100;">⚠ Priority Gaps</strong>
        <ul style="padding-left: 20px; font-size: 14px; margin-bottom: 0;">
            <li>[Gap/Flag 1]</li>
            <li>[Gap/Flag 2]</li>
            <li>[Gap/Flag 3]</li>
        </ul>
    </div>
</div>

<br>

<h3 style="color: #2E7D32;">Performance Breakdown</h3>

<table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
    <thead>
        <tr style="background-color: #f5f5f5;">
            <th style="padding: 10px; border: 1px solid #ddd; text-align: left;">Area / Question</th>
            <th style="padding: 10px; border: 1px solid #ddd; text-align: center;">Rating (1-5)</th>
            <th style="padding: 10px; border: 1px solid #ddd; text-align: left;">Evaluator Insight</th>
        </tr>
    </thead>
    <tbody>
        <!-- REPEAT THIS TR FOR EVERY SINGLE SECTION/QUESTION SCORED -->
        <tr>
            <td style="padding: 10px; border: 1px solid #ddd;">[Question or Section Name]</td>
            <td style="padding: 10px; border: 1px solid #ddd; text-align: center; font-weight: bold;">[X]/5</td>
            <td style="padding: 10px; border: 1px solid #ddd;">[Detailed observation on this specific area]</td>
        </tr>
    </tbody>
</table>

<br>

<div style="border: 2px dashed #2E7D32; padding: 15px; border-radius: 8px;">
    <h3 style="margin-top: 0; color: #2E7D32;">Post-Assessment Roadmap / Suggestions</h3>
    <ol style="line-height: 1.8; margin-bottom: 0;">
        <li>[Actionable Step 1]</li>
        <li>[Actionable Step 2]</li>
        <li>[Actionable Step 3]</li>
    </ol>
</div>

</div>
`;

const SYSTEM_PROMPT_OPS = `You are a ready mix concrete (RMC) industry expert with deep knowledge across all RMC plant functions:
Operations, QC, Sales, Accounts, Logistics, Maintenance, and HSE.
You are evaluating monthly progress reports from Graduate/Diploma Engineer Trainees.

## Assessment Criteria (Score 1 to 5)
1. Contributions to SARTAJ Improvement
2. Engagement and Knowledge Sharing
3. Curiosity and Observations
4. Practical Work and Skill Development
5. Challenges Faced and Resolutions
6. Plan for Next Month

Max Points: 30.
${HTML_OUTPUT_INSTRUCTIONS}`;


const SYSTEM_PROMPT_SALES = `You are an RMC industry sales expert evaluating Monthly Progress Reports submitted by Sales Trainees.
Be rigorous and honest.

## Assessment Criteria (Score 1 to 5)
1. Contribution to Sales Improvement (0 points if zero actual concrete volume generated)
2. Engagement and Knowledge Sharing
3. Curiosity and Observations
4. Practical Work and Skill Development
5. Challenges Faced and Resolutions
6. Plan for Next Month

Max Points: 30.
${HTML_OUTPUT_INSTRUCTIONS}`;

const SYSTEM_PROMPT_RECRUITMENT = `You are the RMC Operational Auditor evaluating Fresher candidates.
Hunt for Operational Grit. 

Evaluate **9 questions only** on a scale of **1-5**: 
Max Points: 45.

Verdict threshold for HTML output:
>= 75% = HIRE
65% - 74% = BORDERLINE
< 65% = REJECT

${HTML_OUTPUT_INSTRUCTIONS}`;

const SYSTEM_PROMPT_SALES_RECRUITMENT = `You are the RDC Sales Auditor evaluating field sales candidates.
Score every question on a **1-5** scale using Behavioral STAR indicators (Situation, Task, Action, Result).
There are 10 questions. Max Points: 50.

Verdict threshold for HTML output:
>= 70% = HIRE
55% - 69% = BORDERLINE
< 55% = REJECT

${HTML_OUTPUT_INSTRUCTIONS}`;

const SYSTEM_PROMPT_KAUSHAL_MM = `You are an expert evaluator for Ready Mix Concrete plant operations.
Assessing candidate for "Kaushal – Material Management".

Instructions:
Evaluate 10 questions provided in the transcript on a scale of **1-5**.
Focus heavily on ERP discipline, physical verification, escalation vs root cause, and practical plant challenges.
Max points: 50.

${HTML_OUTPUT_INSTRUCTIONS}`;

export const evaluateReport = async (reportText, type = 'ops') => {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error('Gemini API Key is not set in environment variables.');
    }

    const ai = new GoogleGenAI({ apiKey });
    
    let promptToUse;
    switch (type) {
        case 'sales': promptToUse = SYSTEM_PROMPT_SALES; break;
        case 'recruitment': promptToUse = SYSTEM_PROMPT_RECRUITMENT; break;
        case 'sales_recruitment': promptToUse = SYSTEM_PROMPT_SALES_RECRUITMENT; break;
        case 'kaushal_mm': promptToUse = SYSTEM_PROMPT_KAUSHAL_MM; break;
        case 'ops':
        default: promptToUse = SYSTEM_PROMPT_OPS; break;
    }

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: reportText,
            config: {
                systemInstruction: promptToUse,
                temperature: 0.1, 
            }
        });

        // Strip any markdown code block wrappers if Gemini accidentally includes them
        return response.text.replace(/^\s*```html/i, '').replace(/\s*```\s*$/, '');
    } catch (error) {
        console.error('Error calling Gemini API:', error);
        throw new Error('Failed to evaluate report. Ensure API key is valid.');
    }
};
