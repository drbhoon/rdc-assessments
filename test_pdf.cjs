const fs = require('fs');
const pdf = require('pdf-parse');
console.log(typeof pdf);
let dataBuffer = fs.readFileSync('D:\\RDC Drive\\HR\\Assessments\\SRTs\\Lokesh SRT Report.pdf');
pdf(dataBuffer).then(function(data) {
    console.log(data.text);
}).catch(console.error);
