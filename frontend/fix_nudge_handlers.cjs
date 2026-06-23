const fs = require('fs');
const file = 'c:/Users/anees/mydir/digival internship/copy of exam/exam_app/frontend/src/components/Ckeditor.jsx';
let content = fs.readFileSync(file, 'utf8');

const regex = /\} else if \(item\.action === 'REDO'\) \{\s*popupMfRef\.current\?\.executeCommand\('redo'\);\s*\} else \{\s*insertAtCursor\(item\.insert\);\s*\}/g;
const replacement = `} else if (item.action === 'REDO') {
                          popupMfRef.current?.executeCommand('redo');
                        } else if (item.action === 'NUDGE_UP') {
                          popupMfRef.current?.executeCommand(['insert', '\\\\raisebox{2px}{#0}']);
                        } else if (item.action === 'NUDGE_DOWN') {
                          popupMfRef.current?.executeCommand(['insert', '\\\\raisebox{-2px}{#0}']);
                        } else if (item.action === 'NUDGE_LEFT') {
                          popupMfRef.current?.executeCommand(['insert', '\\\\hspace{-2px}#0']);
                        } else if (item.action === 'NUDGE_RIGHT') {
                          popupMfRef.current?.executeCommand(['insert', '\\\\hspace{2px}#0']);
                        } else {
                          insertAtCursor(item.insert);
                        }`;

if (regex.test(content)) {
  content = content.replace(regex, replacement);
  fs.writeFileSync(file, content);
  console.log('Replaced successfully!');
} else {
  console.log('Regex did not match. Let me check the content directly around REDO.');
  const idx = content.indexOf(`item.action === 'REDO'`);
  if (idx !== -1) {
    console.log(content.substring(idx - 50, idx + 200));
  }
}
