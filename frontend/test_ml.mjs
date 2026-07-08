import { convertLatexToMarkup } from 'mathlive';
try {
  console.log('--- array with cline ---');
  console.log(convertLatexToMarkup('\\begin{array}{r@{\\, ) \\!\\!}l} & x+1 \\\\ \\cline{2-2} x-1 & x^2-1 \\end{array}'));
} catch (e) {
  console.error(e);
}
try {
  console.log('--- array with hline ---');
  console.log(convertLatexToMarkup('\\begin{array}[b]{r} x+1 \\\\ \\hline x^2-1 \\end{array}'));
} catch (e) {
  console.error(e);
}
