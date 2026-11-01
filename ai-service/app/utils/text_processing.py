"""
Small, dependency-free text processing helpers.

Deliberately does NOT use NLTK: NLTK's tokenizers/stopword lists require
a separate `nltk.download(...)` step at runtime, which would either need
network access on first run or a manual setup step — exactly the kind of
setup complexity this service avoids. Everything here is plain Python
(regex + a hardcoded stopword list) and works completely offline.
"""
import re

# A small, standard list of English stopwords — enough to filter out
# noise words for concept/keyword matching. Not exhaustive; that's fine,
# since it's only used to de-emphasize common words, not for anything
# that needs to be linguistically complete.
STOPWORDS = {
    "a", "an", "the", "and", "or", "but", "if", "then", "so", "of", "to",
    "in", "on", "at", "by", "for", "with", "about", "as", "is", "are",
    "was", "were", "be", "been", "being", "it", "its", "this", "that",
    "these", "those", "i", "you", "he", "she", "we", "they", "them",
    "his", "her", "their", "our", "your", "my", "me", "us", "him",
    "do", "does", "did", "have", "has", "had", "can", "could", "will",
    "would", "should", "may", "might", "must", "not", "no", "yes",
    "there", "here", "what", "which", "who", "whom", "when", "where",
    "why", "how", "than", "too", "very", "just", "also", "into", "out",
    "up", "down", "over", "under", "again", "some", "such", "own",
}

_WORD_RE = re.compile(r"[a-zA-Z][a-zA-Z\-']*")
_SENTENCE_SPLIT_RE = re.compile(r"[.!?]+")


def tokenize(text: str):
    """Lowercase word tokens, punctuation stripped. No external tokenizer needed for text this simple."""
    return [w.lower() for w in _WORD_RE.findall(text or "")]


def meaningful_tokens(text: str):
    """Tokens with common stopwords removed — used for concept/keyword matching."""
    return [t for t in tokenize(text) if t not in STOPWORDS]


def split_sentences(text: str):
    """Splits on ./!/? — a simple heuristic, not a full sentence boundary detector, but sufficient for scoring sentence length."""
    sentences = [s.strip() for s in _SENTENCE_SPLIT_RE.split(text or "") if s.strip()]
    return sentences


def word_count(text: str) -> int:
    return len(tokenize(text))
