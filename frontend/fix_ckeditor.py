import json
import re

# Read transcript.jsonl
log_path = r"C:\Users\anees\.gemini\antigravity-ide\brain\ab581bd2-368b-4e6c-a903-f1ba142a7f28\.system_generated\logs\transcript.jsonl"
ckeditor_content = {}

with open(log_path, 'r', encoding='utf-8') as f:
    for line in f:
        data = json.loads(line)
        if data.get("type") == "TOOL_RESPONSE" and data.get("status") == "DONE":
            content = data.get("content", "")
            if "File Path: `file:///c:/Users/anees/mydir/digival%20internship/copy%20of%20exam/exam_app/frontend/src/components/Ckeditor.jsx`" in content:
                if "Showing lines 1 to 800" in content:
                    ckeditor_content[1] = content
                elif "Showing lines 801 to 1425" in content:
                    ckeditor_content[2] = content

if 1 in ckeditor_content and 2 in ckeditor_content:
    full_text = ""
    for idx in [1, 2]:
        text = ckeditor_content[idx]
        lines_part = text.split("The following code has been modified to include a line number before every line, in the format: <line_number>: <original_line>. Please note that any changes targeting the original code should remove the line number, colon, and leading space.")[1]
        if "The above content does NOT show the entire file contents." in lines_part:
            lines_part = lines_part.split("The above content does NOT show the entire file contents.")[0]
        else:
            lines_part = lines_part.split("The above content shows the entire, complete file contents of the requested file.")[0]
        
        cleaned_lines = []
        for line in lines_part.strip().split('\n'):
            match = re.match(r'^\d+:\s?(.*)$', line)
            if match:
                cleaned_lines.append(match.group(1))
            else:
                cleaned_lines.append(line)
        full_text += '\n'.join(cleaned_lines) + '\n'

    with open(r"c:\Users\anees\mydir\digival internship\copy of exam\exam_app\frontend\src\components\Ckeditor.jsx", 'w', encoding='utf-8') as f:
        f.write(full_text)
    print("RESTORED SUCCESSFULLY")
else:
    print("COULD NOT FIND BACKUP IN LOGS")
