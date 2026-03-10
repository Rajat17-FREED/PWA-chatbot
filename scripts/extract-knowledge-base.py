#!/usr/bin/env python3
"""Extract text from FREED Knowledge base PDF into a plain text file."""

import subprocess
import os

DATASET_DIR = os.path.join(os.path.dirname(__file__), '..', 'dataset')
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'server', 'src', 'data')

def main():
    pdf_path = os.path.join(DATASET_DIR, 'FREED Knowledge base.pdf')
    output_path = os.path.join(OUTPUT_DIR, 'knowledge-base.txt')

    if not os.path.exists(pdf_path):
        print(f"Error: PDF not found at {pdf_path}")
        return

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # Use pdftotext (from poppler) for clean extraction
    result = subprocess.run(
        ['pdftotext', '-layout', pdf_path, '-'],
        capture_output=True, text=True
    )

    if result.returncode != 0:
        print(f"Error running pdftotext: {result.stderr}")
        return

    text = result.stdout

    # Clean up: remove excessive blank lines, normalize whitespace
    lines = text.split('\n')
    cleaned_lines = []
    prev_blank = False
    for line in lines:
        stripped = line.strip()
        if not stripped:
            if not prev_blank:
                cleaned_lines.append('')
            prev_blank = True
        else:
            cleaned_lines.append(stripped)
            prev_blank = False

    cleaned_text = '\n'.join(cleaned_lines).strip()

    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(cleaned_text)

    print(f"Extracted {len(cleaned_text)} characters to {output_path}")
    print(f"Lines: {len(cleaned_lines)}")


if __name__ == '__main__':
    main()
