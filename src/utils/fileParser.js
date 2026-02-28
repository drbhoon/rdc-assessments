import * as pdfjsLib from 'pdfjs-dist';
import mammoth from 'mammoth';
import pdfWorkerURL from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Set worker source for PDF.js to the local bundled worker
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerURL;

export const extractTextFromFile = async (file) => {
    try {
        if (file.type === 'application/pdf') {
            return await extractTextFromPDF(file);
        } else if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || file.name.endsWith('.docx')) {
            return await extractTextFromDocx(file);
        } else if (file.type === 'text/plain') {
            return await file.text();
        } else {
            throw new Error('Unsupported file format. Please upload a PDF, DOCX, or TXT file.');
        }
    } catch (error) {
        console.error('Error extracting text:', error);
        throw new Error(`Failed to read file: ${error.message}`);
    }
};

const extractTextFromPDF = async (file) => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const strings = content.items.map(item => item.str);
        text += strings.join(' ') + '\n';
    }
    return text;
};

const extractTextFromDocx = async (file) => {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value;
};
