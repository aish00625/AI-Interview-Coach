"""
Answer-quality validation: the first stage of evaluation, run BEFORE any score is calculated.

Why it exists: the original evaluator scored the *shape* of the text (sentence length, word count) and never asked whether the
text was language at all. A single unpunctuated token such as "dshdgubc" counted as one short "fragment" and earned a clarity score
of 55/100 just for being text. Scores that measure shape are meaningless unless the content is first known to be meaningful.

What it does (all deterministic, no model, no network, no randomness; the same input always gives the same result):

  inspect(answer, question)  ->  gate: "ok" | "empty" | "no_words" | "unsupported_language" | "repeated" | "gibberish"
                                 plus the measurements behind that decision (word count, share of word-like tokens, ...)

  A gate other than "ok" means the answer is NOT EVALUABLE: the evaluator returns zero scores with a plain explanation instead of
  precise-looking numbers. Everything that passes the gate is scored normally and may still be labelled "too short", "doesn't
  address the question", "insufficient", "partial", "good" or "strong" (see classify()).

How "word-like" is decided (token_is_wordlike): known words (the question, the rubric vocabulary, common English function words,
common technical acronyms) always pass. Anything else must not contain a run of 3+ identical letters, a keyboard-row run
("qwer", "asdf"), a repeating block ("hjkhjkhjk"), a vowel-free stretch of 5+ letters or no vowel at all, or an extremely low
vowel share. These rules catch typical keyboard mashing and repeated characters. They do NOT catch pronounceable nonsense
("bakelumop"), and they cannot tell a true statement from a false one; those cases are handled, as far as keyword methods can,
by the relevance checks in evaluator.py.

An answer is "gibberish" only when fewer than half of its tokens are word-like, so a real answer containing a few unusual
identifiers or acronyms is never rejected.
"""
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence

from app.utils.text_processing import STOPWORDS, tokenize

# ----------------------------------------------------------------------------------------------------------------------
# Statuses (the single vocabulary shared by the AI service, backend and dashboard)
# ----------------------------------------------------------------------------------------------------------------------
STATUS_LABELS = {
    "not_evaluable": "Not evaluable",
    "too_short": "Too short to evaluate reliably",
    "off_topic": "Doesn't address the question",
    "insufficient": "Meaningful but insufficient",
    "partial": "Partially complete",
    "good": "Good answer",
    "strong": "Strong answer",
}
STATUSES = tuple(STATUS_LABELS)

GATE_REASONS = {
    "empty": "No answer was submitted, so there was nothing to evaluate.",
    "no_words": "The answer contains no words (only numbers or symbols), so it could not be evaluated.",
    "unsupported_language": "The answer is not written in English, which is the only language this evaluator can read, so it could not be evaluated.",
    "repeated": "The answer repeats the same word or phrase instead of giving information, so it could not be evaluated.",
    "gibberish": "Most of the text does not look like real words (for example random or repeated characters), so it did not contain enough understandable content to evaluate.",
    "unrecognised": "The answer is a run of words with no sentence structure, and almost none of them relate to the question or to any known subject vocabulary, so it did not contain enough understandable content to evaluate.",
}

# A list of keywords is not a sentence. These reasons/notes are shown when the structure check fires on an otherwise evaluable answer.
UNSTRUCTURED_REASON = ("The answer reads as a list of keywords rather than sentences (almost no connecting words such as 'is', 'the', 'because', 'so'). "
                       "Keywords alone show vocabulary, not understanding, so credit is reduced and the result is marked low-confidence.")

# ----------------------------------------------------------------------------------------------------------------------
# Thresholds (documented here so they are easy to review and test)
# ----------------------------------------------------------------------------------------------------------------------
MIN_WORDLIKE_RATIO = 0.5          # below this share of word-like tokens the answer is gibberish
REPEAT_MAX_UNIQUE_RATIO = 0.34    # unique/total tokens at or below this (with >= 3 tokens) = repeated words
REPEAT_MAX_TOP_SHARE = 0.6        # one token making up this much of an answer of >= 4 tokens = repeated words
MIN_CONSONANT_RUN_BAD = 5         # this many consonants in a row is not an English word (unless it is a known word)
MIN_VOWEL_SHARE = 0.12            # for tokens of >= 5 letters ("scripts", "scroll", "prompt" pass; "sdkjfhgl" does not)
MAX_SINGLE_LETTER_SHARE = 0.75    # "a s d f g h": single letters are fine as variables ("x", "n") but not as most of an answer

# Sentence-structure check (explainable heuristic, not a grammar parser). Ordinary English prose is 25-50% function words
# ("is", "the", "because", "so", "it"). A run of 8+ words with under 10% of them is a keyword list, not an explanation.
STRUCTURE_MIN_WORDS = 8
MIN_FUNCTION_WORD_SHARE = 0.10
# Pronounceable nonsense cannot be recognised by spelling alone. When an answer ALSO has no sentence structure and fewer than
# this share of its content words appear in the question or the project's subject vocabulary, it is not evaluable.
MIN_RECOGNISED_SHARE = 0.30
UNRECOGNISED_MIN_WORDS = 10

_VOWELS = set("aeiouy")
_KEYBOARD_ROWS = ("qwertyuiop", "asdfghjkl", "zxcvbnm")
_KEYBOARD_RUN = 4

# Two-letter tokens that are real words or ubiquitous abbreviations. Any other two-letter token is not word-like on its own.
_SHORT_WORDS = {
    "am", "an", "as", "at", "be", "by", "do", "go", "he", "hi", "if", "in", "is", "it", "me", "my", "no", "of", "oh", "ok", "on", "or",
    "so", "to", "up", "us", "we", "ai", "ml", "db", "os", "ip", "js", "vm", "pc", "qa", "ci", "cd", "ui", "ux", "id", "io", "ii", "ex",
    "eg", "ie", "vs", "tv", "uk", "us", "hr", "pr", "pm", "ok", "ah", "um", "uh", "er", "yo", "ha", "re",
}
# Real words / acronyms that break the structural rules above (no vowels, or long consonant runs).
_STRUCTURAL_EXCEPTIONS = {
    "jsx", "tsx", "pgsql", "hmm", "shh", "psst", "brr", "tsk", "nth", "css", "html", "sql", "tcp", "cpu", "gpu", "http", "https", "ssh", "dns", "xml", "rdbms", "ddl", "dml",
    "dbms", "sdk", "cdn", "vpn", "orm", "jwt", "tls", "ssl", "ftp", "smtp", "rpc", "grpc", "mvc", "mvp", "crud", "cli", "ssr", "csr", "dsa",
    "bfs", "dfs", "lru", "lifo", "nlp", "rnn", "cnn", "gcp", "aws", "ssd", "hdd", "ram", "rom", "npm", "pip", "yml", "nlp", "sdlc", "tdd", "bdd",
    "strengths", "lengths", "property", "properties", "angstrom", "twelfths", "rhythm", "rhythms", "sixths", "nexts", "gzip", "pdf", "svg", "php", "jpg", "png", "gif",
    "rdd", "dto", "dao", "pwd", "src", "lib", "bin", "tmp", "cmd", "cls", "ctrl", "alt", "fn", "str", "ptr", "std", "fmt", "xhr", "cors", "csrf",
    "xss", "dom", "sdn", "nfs", "smb", "scp", "sftp", "tcp", "udp", "icmp", "arp", "dhcp", "nat", "lan", "wan", "vlan", "mtu", "tdl", "ssg",
}

# Consonant pairs that occur inside English words (including compounds such as "keyboard", "network", "subject"). A word with a
# consonant pair outside this set ("wk", "dk", "kj", "vx") is not word-like unless it is a known word or acronym.
_VALID_CONSONANT_PAIRS = frozenset(
    "bb bd bj bl bm br bs bt cc ch ck cl cm cn cq cr cs ct dd dg dh dl dm dn dr ds dv dw ff fl fr fs ft gd gg gh gl gm gn gr gs gt "
    "hm hn hr hs ht hw kb kd kl kn kr ks kt kw lb lc ld lf lg lk ll lm ln lp ls lt lv lw mb mc md mf ml mm mn mp ms mt mw "
    "nb nc nd nf ng nh nj nk nl nm nn np nr ns nt nv nw pb pc ph pl pn pp pr ps pt pw rb rc rd rf rg rh rj rk rl rm rn rp rr rs rt rv rw "
    "ql dj bv dt nx vl wk km kp cz wf sb sc sd sf sg sh sk sl sm sn sp sq ss st sv sw tb tc td tf tg th tl tm tn tp tr ts tt tv tw tz wb wd wh wl wn wr ws xc xp xt zz".split()
)

_BANK_PATH = Path(__file__).resolve().parent.parent / "data" / "reference_bank.json"
_known_cache: Optional[frozenset] = None


def _bank_vocabulary() -> frozenset:
    """Every word in the project's own question/rubric bank: these always count as real words."""
    global _known_cache
    if _known_cache is None:
        words = set()
        try:
            with open(_BANK_PATH, "r", encoding="utf-8") as f:
                text = f.read().lower()
            words = set(re.findall(r"[a-z]+", text))
        except (OSError, ValueError):
            words = set()
        _known_cache = frozenset(words | STOPWORDS | _STRUCTURAL_EXCEPTIONS | _SHORT_WORDS)
    return _known_cache


# ----------------------------------------------------------------------------------------------------------------------
# Token level
# ----------------------------------------------------------------------------------------------------------------------
def _letters(token: str) -> str:
    return re.sub(r"[^a-z]", "", token.lower())


def _longest_consonant_run(s: str) -> int:
    best = cur = 0
    for ch in s:
        if ch in _VOWELS:
            cur = 0
        else:
            cur += 1
            best = max(best, cur)
    return best


def _has_identical_run(s: str, n: int = 3) -> bool:
    return re.search(r"(.)\1{%d,}" % (n - 1), s) is not None


def _has_keyboard_run(s: str) -> bool:
    for row in _KEYBOARD_ROWS:
        for i in range(len(row) - _KEYBOARD_RUN + 1):
            chunk = row[i:i + _KEYBOARD_RUN]
            if chunk in s or chunk[::-1] in s:
                return True
    return False


def _has_invalid_consonant_pair(s: str) -> bool:
    for a, b in zip(s, s[1:]):
        if a not in _VOWELS and b not in _VOWELS and (a + b) not in _VALID_CONSONANT_PAIRS and a != b:
            return True
    return False


def _is_periodic(s: str) -> bool:
    """True when the token begins with a short block repeated at least 3 times ("hjkhjkhjk", "abcabcabc")."""
    for p in range(2, len(s) // 3 + 1):
        if s.startswith(s[:p] * 3):
            return True
    return False


def token_is_wordlike(token: str, known: Iterable[str] = ()) -> bool:
    s = _letters(token)
    if not s:
        return False
    if len(s) == 1:
        return True  # a variable name or the word "a"/"I"; inspect() rejects answers that are mostly single letters
    if s in known or s in _bank_vocabulary():
        return True
    if len(s) == 2:
        return s in _SHORT_WORDS
    if _has_identical_run(s) or _has_keyboard_run(s) or _is_periodic(s):
        return False
    if not any(ch in _VOWELS for ch in s):
        return False
    if _longest_consonant_run(s) >= MIN_CONSONANT_RUN_BAD:
        return False
    if len(s) >= 4 and _has_invalid_consonant_pair(s):
        return False
    if len(s) >= 5 and sum(ch in _VOWELS for ch in s) / len(s) < MIN_VOWEL_SHARE:
        return False
    return True


# ----------------------------------------------------------------------------------------------------------------------
# Answer level
# ----------------------------------------------------------------------------------------------------------------------
def inspect(answer: str, question: str = "") -> Dict[str, Any]:
    """
    Decides whether the answer contains enough understandable content to be evaluated at all.
    Returns {"gate", "reason", "wordCount", "meaningfulWordCount", "wordLikeRatio", "uniqueWordRatio", "tokens"}.
    `tokens` are the lower-case word tokens (used by the evaluator so the text is only tokenised once).
    """
    text = (answer or "").strip()
    known = {_letters(t) for t in tokenize(question)}
    tokens = tokenize(text)
    wc = len(tokens)
    out: Dict[str, Any] = {"gate": "ok", "reason": None, "wordCount": wc, "meaningfulWordCount": 0, "wordLikeRatio": None, "uniqueWordRatio": None, "tokens": tokens,
                           "functionWordShare": None, "recognisedShare": None, "unstructured": False}

    def stop(gate: str) -> Dict[str, Any]:
        out["gate"], out["reason"] = gate, GATE_REASONS[gate]
        return out

    if not text:
        return stop("empty")
    if wc == 0:
        non_latin_letters = sum(1 for ch in text if ch.isalpha() and ord(ch) > 127)
        return stop("unsupported_language" if non_latin_letters >= 3 else "no_words")
    non_latin_letters = sum(1 for ch in text if ch.isalpha() and ord(ch) > 127)
    if non_latin_letters >= 8 and non_latin_letters > 2 * sum(len(_letters(t)) for t in tokens):
        return stop("unsupported_language")

    wordlike = [token_is_wordlike(t, known) for t in tokens]
    singles = [len(_letters(t)) == 1 for t in tokens]
    if wc >= 4 and sum(singles) / wc >= MAX_SINGLE_LETTER_SHARE:
        wordlike = [w and not one for w, one in zip(wordlike, singles)]
    ratio = sum(wordlike) / wc
    counts = Counter(tokens)
    unique_ratio = len(counts) / wc
    out["wordLikeRatio"] = round(ratio, 3)
    out["uniqueWordRatio"] = round(unique_ratio, 3)
    out["meaningfulWordCount"] = sum(1 for t, w in zip(tokens, wordlike) if w and t not in STOPWORDS and len(_letters(t)) >= 2)

    if wc >= 3 and unique_ratio <= REPEAT_MAX_UNIQUE_RATIO and ratio >= MIN_WORDLIKE_RATIO:
        return stop("repeated")
    if wc >= 4 and counts.most_common(1)[0][1] / wc >= REPEAT_MAX_TOP_SHARE and ratio >= MIN_WORDLIKE_RATIO:
        return stop("repeated")
    if ratio < MIN_WORDLIKE_RATIO:
        return stop("gibberish")

    # Sentence structure: share of function words, and (for keyword runs) how much of the vocabulary is recognised at all.
    function_share = sum(1 for t in tokens if t in STOPWORDS) / wc
    content = [t for t in tokens if t not in STOPWORDS and len(_letters(t)) >= 2]
    vocab = _bank_vocabulary() - STOPWORDS - _STRUCTURAL_EXCEPTIONS - _SHORT_WORDS
    recognised = (sum(1 for t in content if _letters(t) in vocab or _letters(t) in known) / len(content)) if content else 0.0
    out["functionWordShare"] = round(function_share, 3)
    out["recognisedShare"] = round(recognised, 3)
    out["unstructured"] = wc >= STRUCTURE_MIN_WORDS and function_share < MIN_FUNCTION_WORD_SHARE
    if out["unstructured"] and wc >= UNRECOGNISED_MIN_WORDS and recognised < MIN_RECOGNISED_SHARE:
        return stop("unrecognised")
    return out


def classify(*, average: float, coverage: Optional[float], short: bool, off_topic: bool, has_rubric: bool, low_confidence: bool,
             unstructured: bool = False) -> str:
    """
    Maps an evaluable answer to its status. `average` is the plain average of the four displayed scores (the same figure the
    dashboard shows as the answer score), `coverage` the share of expected points found (None when no rubric matched).
    Without a rubric the evaluator cannot honestly claim more than "partial".
    """
    if off_topic:
        return "off_topic"
    if short:
        return "too_short"
    if unstructured:
        return "insufficient"  # keywords without sentences never rate higher than "meaningful but insufficient"
    cov = coverage if coverage is not None else 0.0
    if average < 35 or (has_rubric and cov < 0.25):
        return "insufficient"
    if not has_rubric:
        return "partial"
    if average < 70 or cov < 0.6:
        return "partial"
    if average >= 85 and cov >= 0.8 and not low_confidence:
        return "strong"
    return "good"


def build_summary(status: str, reasons: Sequence[str], inspection: Dict[str, Any], score_basis: str) -> Dict[str, Any]:
    """The `answerQuality` object returned to the backend. Numbers only describe the text; they are not scores."""
    return {
        "status": status,
        "label": STATUS_LABELS[status],
        "evaluable": status != "not_evaluable",
        "reasons": [r for r in reasons if r][:5],
        "wordCount": int(inspection.get("wordCount") or 0),
        "meaningfulWordCount": int(inspection.get("meaningfulWordCount") or 0),
        "wordLikeRatio": inspection.get("wordLikeRatio"),
        "sentenceStructure": "keyword_list" if inspection.get("unstructured") else "sentences",
        "functionWordShare": inspection.get("functionWordShare"),
        "scoreBasis": score_basis,
    }
