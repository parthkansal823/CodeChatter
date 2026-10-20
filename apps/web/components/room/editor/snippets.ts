/**
 * Snippets: short prefixes that expand into common code (`main`, `for`, `try`…), offered
 * with completions as you type and from Insert snippet… in the palette. Bodies use VS
 * Code's snippet syntax: Tab moves through $1, $2…, ${1:default} is pre-filled, $0 is
 * where the cursor ends.
 */
export type Snippet = { prefix: string; label: string; body: string };

const JAVASCRIPT: Snippet[] = [
  { prefix: "log", label: "console.log", body: "console.log($1);$0" },
  { prefix: "fn", label: "Function", body: "function ${1:name}(${2:params}) {\n\t$0\n}" },
  { prefix: "afn", label: "Arrow function", body: "const ${1:name} = (${2:params}) => {\n\t$0\n};" },
  { prefix: "asyncfn", label: "Async function", body: "async function ${1:name}(${2:params}) {\n\t$0\n}" },
  { prefix: "class", label: "Class", body: "class ${1:Name} {\n\tconstructor(${2:params}) {\n\t\t$0\n\t}\n}" },
  { prefix: "forof", label: "for…of loop", body: "for (const ${1:item} of ${2:items}) {\n\t$0\n}" },
  { prefix: "fori", label: "Counting for loop", body: "for (let ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t$0\n}" },
  { prefix: "try", label: "try…catch", body: "try {\n\t$1\n} catch (${2:error}) {\n\t$0\n}" },
  { prefix: "imp", label: "Import", body: 'import { $2 } from "${1:module}";$0' },
  { prefix: "fetchjson", label: "Fetch JSON", body: 'const response = await fetch("${1:url}");\nconst ${2:data} = await response.json();$0' },
  { prefix: "test", label: "Test (describe and it)", body: 'describe("${1:subject}", () => {\n\tit("${2:does something}", () => {\n\t\t$0\n\t});\n});' },
];

const TYPESCRIPT: Snippet[] = [
  ...JAVASCRIPT,
  { prefix: "interface", label: "Interface", body: "interface ${1:Name} {\n\t${2:field}: ${3:string};$0\n}" },
  { prefix: "type", label: "Type alias", body: "type ${1:Name} = ${2:string};$0" },
];

const PYTHON: Snippet[] = [
  { prefix: "main", label: "if __name__ == \"__main__\"", body: 'def main():\n    $0\n\n\nif __name__ == "__main__":\n    main()' },
  { prefix: "def", label: "Function", body: "def ${1:name}(${2:args}):\n    ${0:pass}" },
  { prefix: "class", label: "Class", body: "class ${1:Name}:\n    def __init__(self${2:, args}):\n        ${0:pass}" },
  { prefix: "dataclass", label: "Data class", body: "from dataclasses import dataclass\n\n\n@dataclass\nclass ${1:Name}:\n    ${2:field}: ${3:int}$0" },
  { prefix: "for", label: "for loop", body: "for ${1:item} in ${2:items}:\n    ${0:pass}" },
  { prefix: "forr", label: "for over a range", body: "for ${1:i} in range(${2:n}):\n    ${0:pass}" },
  { prefix: "with", label: "Open a file", body: 'with open("${1:path}") as ${2:f}:\n    ${0:data = f.read()}' },
  { prefix: "try", label: "try…except", body: "try:\n    $1\nexcept ${2:Exception} as ${3:error}:\n    ${0:raise}" },
  { prefix: "lc", label: "List comprehension", body: "[${1:x} for ${1:x} in ${2:items}${3: if ${4:condition}}]$0" },
  { prefix: "input", label: "Read numbers from input", body: "${1:n} = int(input())\n${2:values} = list(map(int, input().split()))$0" },
  { prefix: "test", label: "pytest test", body: "def test_${1:name}():\n    assert ${0:True}" },
];

const JAVA: Snippet[] = [
  { prefix: "main", label: "main method", body: "public static void main(String[] args) {\n\t$0\n}" },
  { prefix: "sout", label: "System.out.println", body: "System.out.println($1);$0" },
  { prefix: "class", label: "Class", body: "public class ${1:Main} {\n\t$0\n}" },
  { prefix: "fori", label: "Counting for loop", body: "for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t$0\n}" },
  { prefix: "foreach", label: "for-each loop", body: "for (${1:var} ${2:item} : ${3:items}) {\n\t$0\n}" },
  { prefix: "try", label: "try…catch", body: "try {\n\t$1\n} catch (${2:Exception} ${3:e}) {\n\t$0\n}" },
  { prefix: "scanner", label: "Read input with a Scanner", body: "java.util.Scanner ${1:in} = new java.util.Scanner(System.in);\nint ${2:n} = ${1:in}.nextInt();$0" },
];

const C: Snippet[] = [
  { prefix: "main", label: "main with stdio", body: "#include <stdio.h>\n\nint main(void) {\n\t$0\n\treturn 0;\n}" },
  { prefix: "printf", label: "printf", body: 'printf("${1:%d}\\n", ${2:value});$0' },
  { prefix: "fori", label: "Counting for loop", body: "for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t$0\n}" },
  { prefix: "struct", label: "struct", body: "typedef struct {\n\t${2:int field};$0\n} ${1:Name};" },
];

const CPP: Snippet[] = [
  { prefix: "main", label: "main with iostream", body: "#include <iostream>\n\nint main() {\n\t$0\n\treturn 0;\n}" },
  {
    prefix: "cp",
    label: "Competitive programming template",
    body: "#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n\tios::sync_with_stdio(false);\n\tcin.tie(nullptr);\n\tint ${1:t} = 1;\n\tcin >> ${1:t};\n\twhile (${1:t}--) {\n\t\t$0\n\t}\n\treturn 0;\n}",
  },
  { prefix: "cout", label: "cout", body: "std::cout << $1 << '\\n';$0" },
  { prefix: "fori", label: "Counting for loop", body: "for (int ${1:i} = 0; ${1:i} < ${2:n}; ++${1:i}) {\n\t$0\n}" },
  { prefix: "forr", label: "Range for loop", body: "for (const auto& ${1:item} : ${2:items}) {\n\t$0\n}" },
  { prefix: "class", label: "Class", body: "class ${1:Name} {\npublic:\n\t${1:Name}();\n\t$0\n};" },
];

const GO: Snippet[] = [
  { prefix: "main", label: "package main", body: 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println(${1:"hello"})$0\n}' },
  { prefix: "func", label: "Function", body: "func ${1:name}(${2:params}) ${3:error} {\n\t$0\n}" },
  { prefix: "iferr", label: "if err != nil", body: "if err != nil {\n\treturn ${1:err}\n}$0" },
  { prefix: "forr", label: "for range", body: "for ${1:_}, ${2:v} := range ${3:items} {\n\t$0\n}" },
  { prefix: "struct", label: "struct type", body: "type ${1:Name} struct {\n\t${2:Field} ${3:string}$0\n}" },
  { prefix: "test", label: "Test function", body: "func Test${1:Name}(t *testing.T) {\n\t$0\n}" },
];

const RUST: Snippet[] = [
  { prefix: "main", label: "fn main", body: "fn main() {\n\t$0\n}" },
  { prefix: "fn", label: "Function", body: "fn ${1:name}(${2:args}) ${3:-> ${4:()} }{\n\t$0\n}" },
  { prefix: "struct", label: "struct", body: "#[derive(Debug)]\nstruct ${1:Name} {\n\t${2:field}: ${3:i32},$0\n}" },
  { prefix: "impl", label: "impl block", body: "impl ${1:Name} {\n\t$0\n}" },
  { prefix: "match", label: "match", body: "match ${1:value} {\n\t${2:pattern} => $3,\n\t_ => $0,\n}" },
  { prefix: "test", label: "Test module", body: "#[cfg(test)]\nmod tests {\n\tuse super::*;\n\n\t#[test]\n\tfn ${1:it_works}() {\n\t\t$0\n\t}\n}" },
];

const HTML: Snippet[] = [
  {
    prefix: "html5",
    label: "HTML page",
    body: '<!doctype html>\n<html lang="${1:en}">\n<head>\n\t<meta charset="utf-8">\n\t<meta name="viewport" content="width=device-width, initial-scale=1">\n\t<title>${2:Page}</title>\n\t<link rel="stylesheet" href="${3:style.css}">\n</head>\n<body>\n\t$0\n\t<script src="${4:script.js}"></script>\n</body>\n</html>',
  },
  { prefix: "link", label: "Stylesheet link", body: '<link rel="stylesheet" href="${1:style.css}">$0' },
  { prefix: "script", label: "Script", body: '<script src="${1:script.js}"></script>$0' },
  { prefix: "ul", label: "List", body: "<ul>\n\t<li>$1</li>\n\t<li>$0</li>\n</ul>" },
  { prefix: "form", label: "Form", body: '<form action="${1:#}" method="${2:post}">\n\t<label for="${3:name}">${4:Name}</label>\n\t<input id="${3:name}" name="${3:name}">\n\t<button type="submit">${5:Send}</button>\n</form>$0' },
];

const CSS: Snippet[] = [
  { prefix: "flexcenter", label: "Center with flex", body: "display: flex;\nalign-items: center;\njustify-content: center;$0" },
  { prefix: "grid", label: "Grid of columns", body: "display: grid;\ngrid-template-columns: repeat(${1:3}, 1fr);\ngap: ${2:1rem};$0" },
  { prefix: "media", label: "Media query", body: "@media (max-width: ${1:600px}) {\n\t$0\n}" },
  { prefix: "dark", label: "Dark mode", body: "@media (prefers-color-scheme: dark) {\n\t$0\n}" },
];

const MARKDOWN: Snippet[] = [
  { prefix: "code", label: "Code block", body: "```${1:python}\n$0\n```" },
  { prefix: "table", label: "Table", body: "| ${1:Column} | ${2:Column} |\n| --- | --- |\n| $3 | $0 |" },
  { prefix: "link", label: "Link", body: "[${1:text}](${2:https://})$0" },
  { prefix: "img", label: "Image", body: "![${1:alt}](${2:path})$0" },
  { prefix: "task", label: "Task list", body: "- [ ] ${1:task}\n- [ ] $0" },
];

const SHELL: Snippet[] = [
  { prefix: "bash", label: "Script header", body: "#!/usr/bin/env bash\nset -euo pipefail\n\n$0" },
  { prefix: "if", label: "if", body: "if [[ ${1:condition} ]]; then\n\t$0\nfi" },
  { prefix: "for", label: "for loop", body: "for ${1:item} in ${2:items}; do\n\t$0\ndone" },
  { prefix: "fn", label: "Function", body: "${1:name}() {\n\t$0\n}" },
];

/** Snippets by Monaco language id. */
export const SNIPPETS: Record<string, Snippet[]> = {
  javascript: JAVASCRIPT,
  typescript: TYPESCRIPT,
  python: PYTHON,
  java: JAVA,
  c: C,
  cpp: CPP,
  go: GO,
  rust: RUST,
  html: HTML,
  css: CSS,
  scss: CSS,
  markdown: MARKDOWN,
  shell: SHELL,
};

export const snippetsFor = (language: string): Snippet[] => SNIPPETS[language] ?? [];

/** The body as plain text (placeholders filled with their defaults), for a preview. */
export function snippetPreview(body: string): string {
  let text = body;
  // Inner placeholders first: ${1:a ${2:b}} becomes "a b".
  for (let i = 0; i < 5 && /\$\{\d+:[^{}]*\}/.test(text); i++) text = text.replace(/\$\{\d+:([^{}]*)\}/g, "$1");
  return text.replace(/\$\{\d+\}|\$\d+/g, "").replace(/\t/g, "  ");
}
