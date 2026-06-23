const fs = require('fs');
const file = 'c:/Users/anees/mydir/digival internship/copy of exam/exam_app/frontend/src/components/Ckeditor.jsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(/if \(mf\) mf\.executeCommand\('moveUp'\);/g, "if (mf) mf.executeCommand(['insert', '\\\\class{nudge-up}{#0}']);");
content = content.replace(/if \(mf\) mf\.executeCommand\('moveDown'\);/g, "if (mf) mf.executeCommand(['insert', '\\\\class{nudge-down}{#0}']);");
content = content.replace(/if \(mf\) mf\.executeCommand\('moveLeft'\);/g, "if (mf) mf.executeCommand(['insert', '\\\\class{nudge-left}{#0}']);");
content = content.replace(/if \(mf\) mf\.executeCommand\('moveRight'\);/g, "if (mf) mf.executeCommand(['insert', '\\\\class{nudge-right}{#0}']);");

fs.writeFileSync(file, content);
