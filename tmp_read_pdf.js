import fs from 'fs';
import * as pdfjsLib from 'pdfjs-dist';

const readPDF = async () => {
    try {
        const data = new Uint8Array(fs.readFileSync('D:\\RDC Drive\\HR\\Assessments\\SRTs\\Lokesh SRT Report.pdf'));
        const docInfo = await pdfjsLib.getDocument({ data }).promise;
        let text = '';
        for (let i = 1; i <= docInfo.numPages; i++) {
            const page = await docInfo.getPage(i);
            const content = await page.getTextContent();
            const strings = content.items.map(item => item.str);
            text += `\n--- PAGE ${i} ---\n`;
            text += strings.join('\n') + '\n';
        }
        console.log(text);
    } catch (e) {
        console.error(e);
    }
}
readPDF();
