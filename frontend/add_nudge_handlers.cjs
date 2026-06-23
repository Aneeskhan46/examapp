const fs = require('fs');
const file = 'c:/Users/anees/mydir/digival internship/copy of exam/exam_app/frontend/src/components/Ckeditor.jsx';
let content = fs.readFileSync(file, 'utf8');

const targetStr = `} else if (item.action === 'REDO') {
                          popupMfRef.current?.executeCommand('redo');
                        } else {`;
const replacementStr = `} else if (item.action === 'REDO') {
                          popupMfRef.current?.executeCommand('redo');
                        } else if (item.action === 'NUDGE_UP') {
                          popupMfRef.current?.executeCommand(['insert', '\\\\raisebox{2px}{#0}']);
                        } else if (item.action === 'NUDGE_DOWN') {
                          popupMfRef.current?.executeCommand(['insert', '\\\\raisebox{-2px}{#0}']);
                        } else if (item.action === 'NUDGE_LEFT') {
                          popupMfRef.current?.executeCommand(['insert', '\\\\hspace{-2px}#0']);
                        } else if (item.action === 'NUDGE_RIGHT') {
                          popupMfRef.current?.executeCommand(['insert', '\\\\hspace{2px}#0']);
                        } else {`;

if (content.includes(targetStr)) {
  content = content.replace(targetStr, replacementStr);
  fs.writeFileSync(file, content);
  console.log('Fixed handlers!');
} else {
  console.log('Target string not found');
}
