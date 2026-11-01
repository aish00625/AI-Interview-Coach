/**
 * Generic per-language starter code templates.
 *
 * database/schema.sql has no per-problem starter-code column, and adding
 * one isn't necessary for this — these generic templates are supplied
 * instead, keyed only by language. If a future phase adds real
 * problem-specific templates (a new column or table), this module is the
 * single place that would change; nothing calling it needs to.
 *
 * PHASE 9 UPDATE: these were rewritten from bare "implement this method"
 * stubs into full stdin/stdout programs. The code-executor service
 * (code-executor/app/utils/language_config.py) runs each submission as a
 * complete program and compares its stdout to an expected value — it
 * does not call a specific function/method — so the templates must be
 * runnable programs with a real entry point (and, for Java, a class
 * literally named `Main`, matching `javac Main.java` / `java Main`).
 */

const SUPPORTED_LANGUAGES = ['cpp', 'java', 'python', 'javascript']

const STARTER_TEMPLATES = {
  python: '# Read input from stdin, write your answer to stdout.\n\ndef main():\n    pass\n\n\nif __name__ == "__main__":\n    main()\n',
  javascript: '// Read input from stdin, write your answer to stdout.\n\nfunction main() {\n\n}\n\nmain()\n',
  java: 'import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner scanner = new Scanner(System.in);\n        // Read input from scanner, write your answer with System.out.\n    }\n}\n',
  cpp: '#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    // Read input from cin, write your answer to cout.\n    return 0;\n}\n',
}

function getStarterCode() {
  return { ...STARTER_TEMPLATES }
}

module.exports = { getStarterCode, SUPPORTED_LANGUAGES }
