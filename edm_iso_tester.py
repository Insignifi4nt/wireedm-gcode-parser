#!/usr/bin/env python3
from pathlib import Path
import argparse
import sys
import re
import json

def detect_eol_stats(data: bytes):
    crlf = data.count(b"\r\n")
    lf_total = data.count(b"\n")
    lf = lf_total - crlf
    cr = data.count(b"\r") - crlf
    return crlf, lf, cr

def detect_line_endings_label(data: bytes):
    crlf, lf, cr = detect_eol_stats(data)
    if crlf and not lf and not cr:
        return "CRLF"
    if lf and not crlf and not cr:
        return "LF"
    if cr and not crlf and not lf:
        return "CR"
    if crlf or lf or cr:
        return "MIXED"
    return "NONE"

def safe_decode(data: bytes):
    try:
        return data.decode("ascii")
    except UnicodeDecodeError:
        return data.decode("ascii", errors="replace")

def analyze_text_lines(lines):
    report = {
        "total_lines": len(lines),
        "starts_with_percent": lines[0].strip() == "%" if lines else False,
        "ends_with_M02": bool(lines and re.search(r'\bM0?2\b', lines[-1])),
        "has_block_numbers": any(re.match(r'\s*N\d+', ln) for ln in lines),
        "block_numbers_monotonic": True,
        "max_line_length": max((len(ln) for ln in lines), default=0),
        "has_semicolon_comments": any(';' in ln for ln in lines),
        "stray_percent_positions": [i+1 for i,ln in enumerate(lines[1:-1], start=2) if ln.strip()=='%'],
        "stop_codes": {},
        "precision_max_places": 0,
        "precision_over_4_count": 0,
        "suspect_lines": [],
    }

    # Stop-like codes
    for code in ["M0", "M00", "M1", "M01", "M2", "M02", "M30"]:
        pos = [i+1 for i,ln in enumerate(lines) if re.search(rf'\b{code}\b', ln)]
        if pos:
            report["stop_codes"][code] = pos

    # Decimal precision stats
    decs = re.findall(r'[XYZIJF][\-\+]?\d+\.(\d+)', "\n".join(lines))
    if decs:
        report["precision_max_places"] = max(len(d) for d in decs)
        report["precision_over_4_count"] = sum(1 for d in decs if len(d) > 4)

    # Block numbers monotonic check
    last_n = -1
    for i, ln in enumerate(lines, start=1):
        m = re.match(r'\s*N(\d+)', ln)
        if m:
            n = int(m.group(1))
            if n <= last_n:
                report["block_numbers_monotonic"] = False
                break
            last_n = n

    # Suspicious content per line
    for i, ln in enumerate(lines, start=1):
        if len(ln) > 120:
            report["suspect_lines"].append({"line": i, "reason": "line too long"})
        if '\t' in ln:
            report["suspect_lines"].append({"line": i, "reason": "tab character"})
        if re.search(r'%.*\S', ln) and ln.strip() != '%':
            report["suspect_lines"].append({"line": i, "reason": "content after %"})
        if re.search(r'\bM0?2\b', ln) and i != len(lines):
            report["suspect_lines"].append({"line": i, "reason": "M02 not at end"})

    return report

def analyze_file(path: Path):
    data = path.read_bytes()
    crlf, lf, cr = detect_eol_stats(data)
    eol_label = "MIXED"
    if crlf and not lf and not cr:
        eol_label = "CRLF"
    elif lf and not crlf and not cr:
        eol_label = "LF"
    elif cr and not crlf and not lf:
        eol_label = "CR"
    elif not (crlf or lf or cr):
        eol_label = "NONE"

    non_ascii_positions = [i for i,b in enumerate(data) if b > 127]
    text = safe_decode(data)
    lines = text.splitlines()

    text_report = analyze_text_lines(lines)

    return {
        "file": str(path.name),
        "bytes": len(data),
        "eol": {
            "label": eol_label,
            "crlf": crlf,
            "lf": lf,
            "cr": cr
        },
        "non_ascii_count": len(non_ascii_positions),
        "non_ascii_sample": non_ascii_positions[:10],
        "text_report": text_report
    }

def normalize_to_iso(input_path: Path, output_path: Path, start_n=10, step=10,
                     add_percent=True, ensure_M02=True, crlf=True, strip_semicolon=True):
    raw = input_path.read_text(encoding="latin-1", errors="ignore")
    src_lines = raw.splitlines()
    out_lines = []

    if add_percent:
        if not src_lines or src_lines[0].strip() != "%":
            out_lines.append("%")
        else:
            out_lines.append("%")
            src_lines = src_lines[1:]

    n = start_n
    for ln in src_lines:
        s = ln.strip()
        if not s:
            continue
        # Strip semicolon comments
        if strip_semicolon and ';' in s:
            s = s.split(';', 1)[0].rstrip()
            if not s:
                continue
        # If line already has N-number, keep it, else add
        if re.match(r'\s*N\d+', s):
            out_lines.append(s)
        else:
            s = re.sub(r'\s+', ' ', s)
            out_lines.append(f"N{n} {s}")
            n += step

    if ensure_M02:
        cleaned = []
        # drop all prior M02/M2 and add a clean one at end
        for l in out_lines:
            if re.search(r'\bM0?2\b', l):
                continue
            cleaned.append(l)
        out_lines = cleaned
        out_lines.append(f"N{n} M02")

    content = ("\r\n".join(out_lines) + "\r\n") if crlf else ("\n".join(out_lines) + "\n")
    output_path.write_bytes(content.encode("latin-1", errors="ignore"))
    return output_path

def compare_files(a: Path, b: Path, skip_header_percent=True, skip_trailing_m02=True):
    la = a.read_text(encoding="latin-1", errors="ignore").splitlines()
    lb = b.read_text(encoding="latin-1", errors="ignore").splitlines()

    def trim(lines):
        if skip_header_percent and lines and lines[0].strip() == "%":
            lines = lines[1:]
        if skip_trailing_m02 and lines and re.search(r'\bM0?2\b', lines[-1]):
            lines = lines[:-1]
        return lines

    la, lb = trim(la), trim(lb)

    max_len = max(len(la), len(lb))
    for i in range(max_len):
        a_ln = la[i].strip() if i < len(la) else "<EOF>"
        b_ln = lb[i].strip() if i < len(lb) else "<EOF>"
        if re.sub(r'\s+', ' ', a_ln) != re.sub(r'\s+', ' ', b_ln):
            return {
                "first_diff_line": i+1,
                "a_line": a_ln,
                "b_line": b_ln
            }
    return {"first_diff_line": None}

def main():
    p = argparse.ArgumentParser(prog="edm_iso_tester", description="Analyze and normalize ISO/G-code/TXT for wire EDM controllers")
    sub = p.add_subparsers(dest="cmd", required=True)

    pa = sub.add_parser("analyze", help="Analyze a file and print a JSON report")
    pa.add_argument("file", type=Path)

    pn = sub.add_parser("normalize", help="Normalize to ISO-style (CRLF, N-numbers, clean M02)")
    pn.add_argument("input", type=Path)
    pn.add_argument("output", type=Path)
    pn.add_argument("--start-n", type=int, default=10)
    pn.add_argument("--step", type=int, default=10)
    pn.add_argument("--no-percent", action="store_true")
    pn.add_argument("--no-m02", action="store_true")
    pn.add_argument("--lf", action="store_true")
    pn.add_argument("--keep-semicolons", action="store_true")

    pc = sub.add_parser("compare", help="Compare two files and show first differing line (ignoring header/footer)")
    pc.add_argument("file_a", type=Path)
    pc.add_argument("file_b", type=Path)
    pc.add_argument("--keep-header", action="store_true")
    pc.add_argument("--keep-footer", action="store_true")

    args = p.parse_args()

    if args.cmd == "analyze":
        rep = analyze_file(args.file)
        print(json.dumps(rep, indent=2))
    elif args.cmd == "normalize":
        out = normalize_to_iso(
            args.input, args.output,
            start_n=args.start_n, step=args.step,
            add_percent=not args.no_percent,
            ensure_M02=not args.no_m02,
            crlf=not args.lf,
            strip_semicolon=not args.keep_semicolons
        )
        print(f"Wrote {out}")
    elif args.cmd == "compare":
        diff = compare_files(
            args.file_a, args.file_b,
            skip_header_percent=not args.keep_header,
            skip_trailing_m02=not args.keep_footer
        )
        print(json.dumps(diff, indent=2))

if __name__ == "__main__":
    if len(sys.argv) == 1:
        print("This is a library and CLI. Examples:")
        print("  python edm_iso_tester.py analyze file.iso")
        print("  python edm_iso_tester.py normalize in.txt out.iso")
        print("  python edm_iso_tester.py compare a.iso b.iso")
    else:
        main()
