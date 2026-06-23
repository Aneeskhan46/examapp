const fs = require('fs');
const file = 'c:/Users/anees/mydir/digival internship/copy of exam/exam_app/frontend/src/components/Ckeditor.jsx';
let content = fs.readFileSync(file, 'utf8');

const search1 = `const [activeGroup, setActiveGroup] = useState(0);`;
const replace1 = `const [activeGroup, setActiveGroup] = useState(0);
  const [hasSelection, setHasSelection] = useState(false);`;
content = content.replace(search1, replace1);

const search2 = `const updateActiveStyles = useCallback(() => {`;
const replace2 = `const updateActiveStyles = useCallback(() => {
    const mf = popupMfRef.current;
    if (mf && typeof mf.selectionIsCollapsed !== 'undefined') {
      setHasSelection(!mf.selectionIsCollapsed);
    }`;
content = content.replace(search2, replace2);

const search3 = `      {type: 'sep', cols: 2, cls: 'cme-trig-subgroup'}`;
const replace3 = `      {type: 'sep', cols: 2, cls: 'cme-trig-subgroup'},
      { label: '↑', title: 'Nudge Up', action: 'NUDGE_UP', requiresSelection: true },
      { label: '↓', title: 'Nudge Down', action: 'NUDGE_DOWN', requiresSelection: true },
      { label: '←', title: 'Nudge Left', action: 'NUDGE_LEFT', requiresSelection: true },
      { label: '→', title: 'Nudge Right', action: 'NUDGE_RIGHT', requiresSelection: true }`;
content = content.replace(search3, replace3);

const search4 = `} else if (item.action === 'REDO') {
                          popupMfRef.current?.executeCommand('redo');
                        } else {
                          insertAtCursor(item.insert);
                        }`;
const replace4 = `} else if (item.action === 'REDO') {
                          popupMfRef.current?.executeCommand('redo');
                        } else if (item.action === 'NUDGE_UP') {
                          if (mf) mf.executeCommand('moveUp');
                        } else if (item.action === 'NUDGE_DOWN') {
                          if (mf) mf.executeCommand('moveDown');
                        } else if (item.action === 'NUDGE_LEFT') {
                          if (mf) mf.executeCommand('moveLeft');
                        } else if (item.action === 'NUDGE_RIGHT') {
                          if (mf) mf.executeCommand('moveRight');
                        } else {
                          insertAtCursor(item.insert);
                        }`;
content = content.replace(search4, replace4);

// Add the conditional rendering
const search5 = `sub.items.map((item, i) => {`;
const replace5 = `sub.items.map((item, i) => {
                          if (item.requiresSelection && !hasSelection) return null;`;
content = content.replace(search5, replace5);

fs.writeFileSync(file, content);
console.log('Modifications done.');
