"""ziLearn offline evaluation: structure extraction and brainmap building, scored without a model.

usage: python3 eval/score.py OUTDIR [--save results.json] [--compare base.json] [-v]

OUTDIR holds what tests/evalDump.test.ts writes (EVAL_OUT=OUTDIR): <doc>.txt (extracted text with
"--- Page N ---" markers) and <doc>.brainmap.json (the course brainmap built offline from that one item).

Extraction (per reference page in eval/ref, as in the earlier hand-judged suite): 60% prose (1 - WER on
words), 30% display equations, 10% headings found + no running headers left. Equations are scored
automatically: both the reference LaTeX and the extracted text are linearised (Unicode, no spaces, braces
dropped, fractions as a/b, ^ kept, subscripts flattened) and each reference equation gets the best fuzzy
match in its page; LaTeX and clean plain text score alike.

Brainmap (per document, against eval/gold/<doc>.json): groups are the parts of the document a student
should see as branches, concepts the key ideas under them ("*" = core, weight 2), "also" further terms
that are fine as nodes.
  recall   35  weighted share of gold concepts that are node titles
  groups   10  share of gold groups that are node titles
  cluster  15  concepts of one group share a top-level branch; concepts of different groups don't
  precision 15 share of node titles that are gold concepts, groups or "also" terms
  notes    15  node notes read as sentences about the node (length, ends a sentence, names the term, little symbol noise)
  form     10  4-10 top-level branches, some depth, no branch with more than 10 children, no duplicate titles
"""
import difflib, glob, json, os, re, sys, unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
DOCS = {"abs2024": "abs", "simo1990": "simo", "Thompson_nlcm": "thom", "bal": "bal", "csd_l7": "csd"}

# ---------------------------------------------------------------- extraction

def words(s):
    return re.findall(r"[a-z]{2,}", s.lower())

def wer(ref, hyp):
    sm = difflib.SequenceMatcher(None, ref, hyp, autojunk=False)
    m = sum(b.size for b in sm.get_matching_blocks())
    return max(0.0, 1 - ((len(ref) - m) + max(0, len(hyp) - m)) / max(1, len(ref)))

def pages(text):
    out = {}
    parts = re.split(r"^--- Page (\d+) ---\s*$", text, flags=re.M)
    for i in range(1, len(parts), 2):
        out[int(parts[i])] = parts[i + 1]
    return out

GREEK = {"alpha": "α", "beta": "β", "gamma": "γ", "delta": "δ", "epsilon": "ε", "varepsilon": "ε", "zeta": "ζ", "eta": "η", "theta": "θ", "vartheta": "θ", "iota": "ι", "kappa": "κ", "lambda": "λ", "mu": "μ", "nu": "ν", "xi": "ξ", "pi": "π", "rho": "ρ", "varrho": "ρ", "sigma": "σ", "tau": "τ", "upsilon": "υ", "phi": "φ", "varphi": "φ", "chi": "χ", "psi": "ψ", "omega": "ω", "Gamma": "Γ", "Delta": "Δ", "Theta": "Θ", "Lambda": "Λ", "Xi": "Ξ", "Pi": "Π", "Sigma": "Σ", "Phi": "Φ", "Psi": "Ψ", "Omega": "Ω"}
SYM = {"partial": "∂", "nabla": "∇", "cdot": "⋅", "times": "×", "sum": "∑", "int": "∫", "oint": "∮", "iint": "∬", "leq": "≤", "le": "≤", "geq": "≥", "ge": "≥", "neq": "≠", "ne": "≠", "to": "→", "rightarrow": "→", "mapsto": "↦", "infty": "∞", "in": "∈", "subset": "⊂", "subseteq": "⊆", "cup": "∪", "cap": "∩", "emptyset": "∅", "varnothing": "∅", "ll": "≪", "gg": "≫", "approx": "≈", "equiv": "≡", "Rightarrow": "⇒", "implies": "⟹", "Longrightarrow": "⟹", "iff": "⟺", "forall": "∀", "exists": "∃", "pm": "±", "mp": "∓", "otimes": "⊗", "oplus": "⊕", "circ": "∘", "ldots": "…", "cdots": "⋯", "dots": "…", "prime": "′", "langle": "⟨", "rangle": "⟩", "|": "‖", "Vert": "‖", "vert": "|", "lVert": "‖", "rVert": "‖", "sim": "∼", "propto": "∝", "star": "⋆", "ast": "∗", "bullet": "∙", "colon": ":", "ell": "ℓ", "hbar": "ℏ", "wedge": "∧", "vee": "∨", "setminus": "∖", "perp": "⊥", "parallel": "∥", "top": "T"}
ACC = {"bar": "̄", "overline": "̄", "hat": "̂", "widehat": "̂", "tilde": "̃", "widetilde": "̃", "dot": "̇", "ddot": "̈", "vec": "⃗", "check": "̌"}
DROP = {"left", "right", "big", "Big", "bigg", "Bigg", "bigl", "bigr", "Bigl", "Bigr", "quad", "qquad", "displaystyle", "textstyle", "nonumber", "notag", "limits", "nolimits", "!", ",", ";", ":", " ", "label", "biggl", "biggr"}
WRAP = {"mathbf", "boldsymbol", "bm", "mathrm", "mathit", "mathcal", "mathbb", "mathsf", "mathscr", "mathfrak", "operatorname", "text", "textrm", "textbf", "textit", "mbox", "mathtt", "rm", "bf", "it"}

def _group(s, i):
    """The {...} group or single token starting at s[i]: (content, next index)."""
    while i < len(s) and s[i] == " ":
        i += 1
    if i >= len(s):
        return "", i
    if s[i] == "{":
        d, j = 0, i
        while j < len(s):
            if s[j] == "{":
                d += 1
            elif s[j] == "}":
                d -= 1
                if d == 0:
                    return s[i + 1 : j], j + 1
            j += 1
        return s[i + 1 :], len(s)
    if s[i] == "\\":
        m = re.match(r"\\([A-Za-z]+|.)", s[i:])
        return m.group(0), i + len(m.group(0))
    return s[i], i + 1

def lin(tex):
    """LaTeX (or text with inline LaTeX) as a linear Unicode string."""
    out, i, s = [], 0, tex
    while i < len(s):
        c = s[i]
        if c == "\\":
            m = re.match(r"\\([A-Za-z]+|.)", s[i:])
            name = m.group(1)
            i += len(m.group(0))
            if name in ("frac", "dfrac", "tfrac"):
                a, i = _group(s, i)
                b, i = _group(s, i)
                out.append(lin(a) + "/" + lin(b))
            elif name == "sqrt":
                if i < len(s) and s[i] == "[":
                    j = s.index("]", i)
                    i = j + 1
                a, i = _group(s, i)
                out.append("√" + lin(a))
            elif name in ACC:
                a, i = _group(s, i)
                la = lin(a)
                out.append(la + ACC[name] if len(la) == 1 else la)
            elif name in WRAP:
                a, i = _group(s, i)
                out.append(lin(a))
            elif name == "tag":
                a, i = _group(s, i)
                out.append("(" + lin(a) + ")")
            elif name in ("begin", "end"):
                _, i = _group(s, i)
            elif name in GREEK:
                out.append(GREEK[name])
            elif name in SYM:
                out.append(SYM[name])
            elif name in DROP:
                pass
            elif name == "\\":
                pass
            else:
                out.append(name)  # \det, \sin, \tr, \Div ...
        elif c == "_":
            a, i = _group(s, i + 1)
            out.append(lin(a))
        elif c == "^":
            a, i = _group(s, i + 1)
            out.append("^" + lin(a))
        elif c in "{}&$":
            i += 1
        else:
            out.append(c)
            i += 1
    return "".join(out)

def canon(s):
    s = unicodedata.normalize("NFKC", s)
    s = s.replace("·", "⋅").replace("−", "-").replace("–", "-").replace("∶", ":").replace("ℬ", "B")
    s = re.sub(r"\[(matrix|diagram|figure)[^\]]*\]", "", s, flags=re.I)
    return re.sub(r"\s+", "", s)

def eq_match(eq, page):
    """Best share of the equation's characters found in order in one window of the page."""
    e = canon(lin(eq))
    if not e:
        return 1.0
    p = canon(lin(page)) if "\\" in page or "$" in page else canon(page)
    if not p:
        return 0.0
    w = max(8, int(len(e) * 1.4))
    best = 0.0
    step = max(1, len(e) // 5)
    for st in range(0, max(1, len(p) - len(e) // 2), step):
        win = p[st : st + w]
        sm = difflib.SequenceMatcher(None, e, win, autojunk=False)
        m = sum(b.size for b in sm.get_matching_blocks())
        best = max(best, m / len(e))
        if best >= 0.999:
            break
    return best

def eq_score(r):
    # Calibrated against the earlier hand judge: exact equations match >= 0.97, flattened scripts and
    # split fractions ~0.85-0.92 (judged 0.5-0.7), garbled OCR <= 0.75 (judged 0).
    return max(0.0, min(1.0, (r - 0.75) / 0.22))

def score_extraction(ext_text, prefix):
    P = pages(ext_text)
    rows = []
    for f in sorted(glob.glob(f"{HERE}/ref/{prefix}-*.md")):
        n = int(re.search(r"-(\d+)\.md$", f).group(1))
        ref = open(f).read()
        hf = re.findall(r"<!-- header/footer:(.*?)-->", ref, re.S)
        body = re.sub(r"<!--.*?-->", "", ref, flags=re.S)
        eqs = re.findall(r"\$\$(.+?)\$\$", body, re.S)
        prose = re.sub(r"\$\$.+?\$\$", " ", body, flags=re.S)
        prose = re.sub(r"\$[^$]+\$", " ", prose)
        prose = re.sub(r"<sup>.*?</sup>|\[Figure image\]", " ", prose)
        heads = [re.sub(r"\$[^$]+\$", " ", h).strip() for h in re.findall(r"^#+\s+(.+)$", body, re.M)]
        hyp = P.get(n, "")
        hclean = re.sub(r"\$\$.+?\$\$", " ", hyp, flags=re.S)
        hclean = re.sub(r"\$[^$\n]+\$", " ", hclean)
        hclean = re.sub(r"^\s*\[.*\]\s*$", " ", hclean, flags=re.M)
        p = wer(words(prose), words(hclean))
        hyp_h = re.sub(r"\$[^$\n]+\$", " ", hyp)
        norm = lambda t: re.sub(r"\W+", " ", t).strip().lower()
        lines = {norm(l) for l in hyp_h.splitlines()}
        flat = norm(hyp_h)
        hfound = sum(1 for h in heads if norm(h) in lines or norm(h) in flat)
        hnorm = {norm(re.sub(r"^\d+(\.\d+)*\s+", "", h)) for h in heads} | {norm(h) for h in heads}
        noise = [w for h in hf for w in re.split(r";|\|", h) if norm(w) and norm(w) != "none" and norm(w) in lines and norm(w) not in hnorm and norm(re.sub(r"^\d+(\.\d+)*\s+", "", w)) not in hnorm]
        eqm = [eq_match(e, hyp) for e in eqs]
        eqs_s = sum(eq_score(x) for x in eqm) / len(eqm) if eqm else None
        parts, w = [(p, 0.6)], 0.6
        if eqs:
            parts.append((eqs_s, 0.3)); w += 0.3
        hs = (hfound / len(heads) if heads else 1) * 0.5 + (0 if noise else 0.5)
        parts.append((hs, 0.1)); w += 0.1
        rows.append(dict(page=n, prose=round(p, 3), eq=None if eqs_s is None else round(eqs_s, 3), heads=f"{hfound}/{len(heads)}", noise=bool(noise), score=round(sum(a * b for a, b in parts) / w, 4)))
    tot = sum(r["score"] for r in rows) / max(1, len(rows))
    return tot, rows

# ---------------------------------------------------------------- brainmap

STOP = set("a an the of and or for in on to with by from as at its their this that these those is are be via using vs versus into under over between within about through".split())

def stems(t):
    t = unicodedata.normalize("NFKC", t).lower()
    t = re.sub(r"\([^)]*\)", " ", t)  # "(RVE)"
    t = t.replace("fibre", "fiber").replace("behaviour", "behavior").replace("modelling", "modeling").replace("isation", "ization").replace("ise ", "ize ")
    t = re.sub(r"[‐‑–—-]", " ", t)
    out = []
    for w in re.findall(r"[a-z0-9α-ωΑ-Ω]+", t):
        if w in STOP:
            continue
        if len(w) > 4 and w.endswith("ies"):
            w = w[:-3] + "y"
        elif len(w) > 4 and w.endswith(("sses", "xes", "ches", "shes")):
            w = w[:-2]
        elif len(w) > 3 and w.endswith("s") and not w.endswith(("ss", "us", "is")):
            w = w[:-1]
        for suf in ("ation", "ing", "ed"):
            if len(w) > len(suf) + 3 and w.endswith(suf):
                w = w[: -len(suf)]
                break
        out.append(w)
    return out

def matches(alias, title):
    a, t = set(stems(alias)), set(stems(title))
    if not a or not t:
        return False
    if a <= t and len(t - a) <= 3:
        return True
    return t <= a and len(t) >= max(2, 0.6 * len(a)) if len(a) > 1 else False

def tree_of(nodes):
    """Each node with its top-level ancestor index and its children count."""
    top, stack = [], []
    for i, n in enumerate(nodes):
        d = n["depth"]
        stack = stack[:d]
        stack.append(i)
        top.append(stack[0])
    kids = [0] * len(nodes)
    stack = []
    for i, n in enumerate(nodes):
        stack = stack[: n["depth"]]
        if stack:
            kids[stack[-1]] += 1
        stack.append(i)
    return top, kids

NOISE = re.compile(r"[∑∫∂∇=≤≥±×⋅⟹→←↦∈⊂∪∩∅∞√^_{}\\|<>]")

def note_ok(title, note):
    n = re.sub(r"\s*\(see “[^”]*”\)\s*$", "", note or "").strip()
    if not (40 <= len(n) <= 360):
        return 0.0
    s = 1.0
    if not re.match(r"^[\"“(]?[A-Z0-9α-ωΑ-Ω𝐀-𝟿]", n):
        s -= 0.25
    if not re.search(r"[.!?][\"”)]?$", n):
        s -= 0.25
    tw = set(stems(title))
    nw = set(stems(n))
    if tw and not (tw & nw):
        s -= 0.25
    sym = len(NOISE.findall(n)) + len(re.findall(r"[\U0001D400-\U0001D7FF]", n))
    if sym / max(1, len(n)) > 0.03:
        s -= 0.25
    if re.match(r"^([A-Z]\.\d|\d+(\.\d+)*\s+[A-Z])", n):  # starts with a section label "B.6 Finite ..." / "2.1 The ..."
        s -= 0.25
    return max(0.0, s)

def score_brainmap(bm, gold):
    nodes = bm["nodes"]
    titles = [n["title"] for n in nodes]
    top, kids = tree_of(nodes)
    concepts = []  # (group index, aliases, weight)
    for gi, g in enumerate(gold["groups"]):
        for c in g["concepts"]:
            core = c[0].startswith("*")
            concepts.append((gi, [c[0].lstrip("*")] + c[1:], 2 if core else 1))
    def find(aliases):
        for i, t in enumerate(titles):
            if any(matches(a, t) for a in aliases):
                return i
        return None
    hit = [(gi, find(al), w) for gi, al, w in concepts]
    rec = sum(w for _, i, w in hit if i is not None) / sum(w for *_, w in hit)
    gfound = [find([g["name"]] + g.get("aliases", [])) for g in gold["groups"]]
    grp = sum(1 for x in gfound if x is not None) / len(gold["groups"])
    # cluster: pairs of found concepts
    found = [(gi, i) for gi, i, _ in hit if i is not None]
    same, diff = [], []
    for a in range(len(found)):
        for b in range(a + 1, len(found)):
            (ga, ia), (gb, ib) = found[a], found[b]
            if ia == ib:
                continue
            together = top[ia] == top[ib]
            (same if ga == gb else diff).append(1.0 if together else 0.0)
    coh = sum(same) / len(same) if same else 0.0
    sep = sum(diff) / len(diff) if diff else 1.0
    clu = (coh + (1 - sep)) / 2 if (same or diff) else 0.0
    allal = [al for _, al, _ in concepts] + [[g["name"]] + g.get("aliases", []) for g in gold["groups"]] + gold.get("also", [])
    good = [any(matches(a, t) for al in allal for a in al) for t in titles]
    prec = sum(good) / max(1, len(titles))
    notes = sum(note_ok(n["title"], n.get("summary", "")) for n in nodes) / max(1, len(nodes))
    ntop = sum(1 for n in nodes if n["depth"] == 0)
    f = 0.0
    f += 0.3 if 4 <= ntop <= 10 else 0.3 * max(0, 1 - min(abs(ntop - 4), abs(ntop - 10)) / 8)
    f += 0.3 if any(n["depth"] >= 1 for n in nodes) else 0
    f += 0.2 if max(kids + [0]) <= 10 else 0.0
    low = [t.lower() for t in titles]
    f += 0.2 * (len(set(low)) / max(1, len(low)))
    total = 35 * rec + 10 * grp + 15 * clu + 15 * prec + 15 * notes + 10 * f
    miss = [al[0] for (gi, al, w), (_, i, _) in zip(concepts, hit) if i is None]
    junk = [t for t, g in zip(titles, good) if not g]
    return total, dict(recall=round(rec, 3), groups=round(grp, 3), cluster=round(clu, 3), precision=round(prec, 3), notes=round(notes, 3), form=round(f, 3), nodes=len(nodes), top=ntop, missing=miss, junk=junk)

# ---------------------------------------------------------------- main

def main():
    args = sys.argv[1:]
    out = args[0]
    save = args[args.index("--save") + 1] if "--save" in args else None
    comp = args[args.index("--compare") + 1] if "--compare" in args else None
    verbose = "-v" in args
    res = {}
    for doc, prefix in DOCS.items():
        r = {}
        tp = f"{out}/{doc}.txt"
        if os.path.exists(tp):
            e, rows = score_extraction(open(tp).read(), prefix)
            r["extraction"] = round(100 * e, 2)
            r["pages"] = rows
        bp, gp = f"{out}/{doc}.brainmap.json", f"{HERE}/gold/{doc}.json"
        if os.path.exists(bp) and os.path.exists(gp):
            b, det = score_brainmap(json.load(open(bp)), json.load(open(gp)))
            r["brainmap"] = round(b, 2)
            r["bm"] = det
        res[doc] = r
    ex = [r["extraction"] for r in res.values() if "extraction" in r]
    bm = [r["brainmap"] for r in res.values() if "brainmap" in r]
    res["_mean"] = {"extraction": round(sum(ex) / max(1, len(ex)), 2), "brainmap": round(sum(bm) / max(1, len(bm)), 2)}
    base = json.load(open(comp)) if comp and os.path.exists(comp) else None
    for doc in list(DOCS) + ["_mean"]:
        r = res[doc]
        line = f"{doc:15s} extraction {r.get('extraction', 0):6.2f}  brainmap {r.get('brainmap', 0):6.2f}"
        if base and doc in base:
            line += f"   (Δ {r.get('extraction', 0) - base[doc].get('extraction', 0):+.2f} / {r.get('brainmap', 0) - base[doc].get('brainmap', 0):+.2f})"
        if doc != "_mean" and "bm" in r:
            d = r["bm"]
            line += f"  [rec {d['recall']} grp {d['groups']} clu {d['cluster']} prec {d['precision']} notes {d['notes']} form {d['form']} n={d['nodes']} top={d['top']}]"
        print(line)
        if verbose and doc != "_mean":
            for p in r.get("pages", []):
                print("    ", p)
            if "bm" in r:
                print("     missing:", r["bm"]["missing"])
                print("     junk:", r["bm"]["junk"])
    # The offline deck (one card per answer): how many cards, and how many ask to complete a formula.
    cards = [c for doc in DOCS if os.path.exists(f"{out}/{doc}.cards.json") for c in json.load(open(f"{out}/{doc}.cards.json"))]
    if cards:
        res["_cards"] = {"cards": len(cards), "formula": sum("= \\;?" in c["front"] for c in cards)}
        print(f"_cards          {res['_cards']['cards']} offline flashcards, {res['_cards']['formula']} complete-the-formula")
    if save:
        json.dump(res, open(save, "w"), indent=1)

if __name__ == "__main__":
    main()
