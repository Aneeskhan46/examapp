const fs = require('fs');
const file = 'c:/Users/anees/mydir/digival internship/copy of exam/exam_app/frontend/src/components/Ckeditor.jsx';
let content = fs.readFileSync(file, 'utf8');

if (!content.includes('hasSelection')) {
  const search1 = `const [activeGroup, setActiveGroup] = useState(0);`;
  const replace1 = `const [activeGroup, setActiveGroup] = useState(0);
  const [hasSelection, setHasSelection] = useState(false);`;
  content = content.replace(search1, replace1);

  const search2 = `const updateActiveStyles = useCallback(() => {
    const mf = popupMfRef.current;
    if (!mf || typeof mf.queryStyle !== 'function') return;`;
  const replace2 = `const updateActiveStyles = useCallback(() => {
    const mf = popupMfRef.current;
    if (mf) {
      let isSel = false;
      if (typeof mf.selectionIsCollapsed !== 'undefined') {
        isSel = !mf.selectionIsCollapsed;
      } else if (mf.selection && mf.selection.ranges && mf.selection.ranges.length > 0) {
        const r = mf.selection.ranges[0];
        isSel = r[0] !== r[1];
      }
      setHasSelection(isSel);
    }
    if (!mf || typeof mf.queryStyle !== 'function') return;`;
  content = content.replace(search2, replace2);
}

if (!content.includes('NUDGE_UP')) {
  const search3 = `      {type: 'sep', cols: 2, cls: 'cme-trig-subgroup'}`;
  const replace3 = `      {type: 'sep', cols: 2, cls: 'cme-trig-subgroup'},
      { label: '↑', title: 'Nudge Up', action: 'NUDGE_UP', requiresSelection: true, width: '40px' },
      { label: '↓', title: 'Nudge Down', action: 'NUDGE_DOWN', requiresSelection: true, width: '40px' },
      { label: '←', title: 'Nudge Left', action: 'NUDGE_LEFT', requiresSelection: true, width: '40px' },
      { label: '→', title: 'Nudge Right', action: 'NUDGE_RIGHT', requiresSelection: true, width: '40px' }`;
  content = content.replace(search3, replace3);

  const search4 = `} else if (item.action === 'REDO') {
                          popupMfRef.current?.executeCommand('redo');
                        } else {
                          insertAtCursor(item.insert);
                        }`;
  const replace4 = `} else if (item.action === 'REDO') {
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
  content = content.replace(search4, replace4);
}

if (!content.includes('requiresSelection && !hasSelection')) {
  const search5 = `{subgroup.items.map((item, i) => {`;
  const replace5 = `{subgroup.items.map((item, i) => {
                  if (item.requiresSelection && !hasSelection) return null;`;
  content = content.replace(search5, replace5);
}

fs.writeFileSync(file, content);
console.log('Modifications done.');
