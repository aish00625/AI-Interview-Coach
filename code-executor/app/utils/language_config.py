"""
Centralized per-language execution configuration — the ONLY place that
knows Docker images, filenames, and compile/run commands for each
supported language. Adding a language means adding one entry here.

Images are pinned to specific tags (never "latest") so execution is
reproducible, and chosen as minimal official runtime images rather than
full SDKs with extra tooling where a slim variant exists.

Commands are plain argument lists (never a shell string) — they are
passed straight to the Docker SDK / exec API, never through a shell, so
there is no shell-injection surface even though the arguments themselves
are fixed and contain no user input (source code is written to a file,
never interpolated into a command).
"""
from typing import Optional, List, NamedTuple


class LanguageConfig(NamedTuple):
    image: str
    source_filename: str
    compile_cmd: Optional[List[str]]  # None if the language needs no compile step
    run_cmd: List[str]


LANGUAGES = {
    "python": LanguageConfig(
        image="python:3.12.3-slim",
        source_filename="main.py",
        compile_cmd=None,
        run_cmd=["python3", "main.py"],
    ),
    "javascript": LanguageConfig(
        image="node:20.11.1-slim",
        source_filename="main.js",
        compile_cmd=None,
        run_cmd=["node", "main.js"],
    ),
    "java": LanguageConfig(
        image="eclipse-temurin:21.0.2_13-jdk-jammy",
        source_filename="Main.java",  # must match the `public class Main` in the starter template
        compile_cmd=["javac", "Main.java"],
        run_cmd=["java", "Main"],
    ),
    "cpp": LanguageConfig(
        image="gcc:13.2.0",
        source_filename="main.cpp",
        compile_cmd=["g++", "-O2", "-std=c++17", "-o", "main", "main.cpp"],
        run_cmd=["./main"],
    ),
}


def get_language_config(language: str) -> Optional[LanguageConfig]:
    return LANGUAGES.get(language)


def is_supported(language: str) -> bool:
    return language in LANGUAGES
