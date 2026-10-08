import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";

// The language services — typescriptDefaults, cssDefaults and friends — used to
// come with the package's main entry. monaco-editor 0.56 split them out, so a
// bare `import * as monaco from "monaco-editor"` now yields an editor whose
// `languages.typescript` is undefined, and configureLanguageDefaults() below
// throws on mount. Importing the contributions registers them onto the same
// monaco instance; each is a side-effect import with nothing to bind.
import "monaco-editor/language/typescript/monaco.contribution";
import "monaco-editor/language/css/monaco.contribution";
import "monaco-editor/language/html/monaco.contribution";
import "monaco-editor/language/json/monaco.contribution";
// Worker entry points, addressed through the package's own subpath exports.
// monaco-editor 0.56 added an exports map of `"./*": "./esm/vs/*.js"`, so the
// old "monaco-editor/esm/vs/..." paths now expand to esm/vs/esm/vs/... — Rollup
// tolerated reaching past the map, Rolldown (Vite 8) does not.
import editorWorker from "monaco-editor/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/language/json/json.worker?worker";
import cssWorker from "monaco-editor/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/language/html/html.worker?worker";
import tsWorker from "monaco-editor/language/typescript/ts.worker?worker";

const globalScope = typeof self !== "undefined"
  ? self
  : typeof window !== "undefined"
    ? window
    : null;

const COMPLETION_SETS = {
  python: [
    ["def", "def ${1:name}(${2:args}):\n    ${3:pass}"],
    ["class", "class ${1:Name}:\n    def __init__(self, ${2:args}):\n        ${3:pass}"],
    ["import", "import ${1:module}"],
    ["from", "from ${1:module} import ${2:name}"],
    ["if", "if ${1:condition}:\n    ${2:pass}"],
    ["for", "for ${1:item} in ${2:items}:\n    ${3:pass}"],
    ["while", "while ${1:condition}:\n    ${2:pass}"],
    ["try", "try:\n    ${1:pass}\nexcept ${2:Exception} as ${3:error}:\n    ${4:pass}"],
    ["with", "with ${1:expression} as ${2:value}:\n    ${3:pass}"],
    ["print", "print(${1:value})"],
    ["range", "range(${1:stop})"],
    ["enumerate", "enumerate(${1:iterable})"],
    ["len", "len(${1:value})"],
    ["list", "list(${1:iterable})"],
    ["dict", "dict(${1:mapping})"],
    ["set", "set(${1:iterable})"],
    ["input", "input(${1:prompt})"],
  ],
  javascript: [
    ["const", "const ${1:name} = ${2:value};"],
    ["let", "let ${1:name} = ${2:value};"],
    ["function", "function ${1:name}(${2:args}) {\n  ${3:// code}\n}"],
    ["arrow", "const ${1:name} = (${2:args}) => {\n  ${3:// code}\n};"],
    ["if", "if (${1:condition}) {\n  ${2:// code}\n}"],
    ["for", "for (let ${1:index} = 0; ${1:index} < ${2:items}.length; ${1:index} += 1) {\n  ${3:// code}\n}"],
    ["async", "async function ${1:name}(${2:args}) {\n  ${3:// code}\n}"],
    ["try", "try {\n  ${1:// code}\n} catch (${2:error}) {\n  ${3:// handle error}\n}"],
    ["import", "import ${1:module} from \"${2:path}\";"],
    ["log", "console.log(${1:value});"],
    ["map", "${1:items}.map((${2:item}) => ${3:item});"],
    ["filter", "${1:items}.filter((${2:item}) => ${3:condition});"],
  ],
  typescript: [
    ["interface", "interface ${1:Name} {\n  ${2:key}: ${3:string};\n}"],
    ["type", "type ${1:Name} = {\n  ${2:key}: ${3:string};\n};"],
    ["const", "const ${1:name}: ${2:type} = ${3:value};"],
    ["function", "function ${1:name}(${2:args}): ${3:void} {\n  ${4:// code}\n}"],
    ["async", "async function ${1:name}(${2:args}): Promise<${3:void}> {\n  ${4:// code}\n}"],
    ["if", "if (${1:condition}) {\n  ${2:// code}\n}"],
    ["for", "for (let ${1:index} = 0; ${1:index} < ${2:items}.length; ${1:index} += 1) {\n  ${3:// code}\n}"],
    ["import", "import ${1:module} from \"${2:path}\";"],
    ["log", "console.log(${1:value});"],
  ],
  json: [
    ["object", "{\n  \"${1:key}\": \"${2:value}\"\n}"],
    ["array", "[\n  \"${1:value}\"\n]"],
  ],
  html: [
    ["div", "<div class=\"${1:container}\">\n  ${2}\n</div>"],
    ["section", "<section class=\"${1:section}\">\n  ${2}\n</section>"],
    ["button", "<button type=\"button\">${1:Label}</button>"],
  ],
  css: [
    ["rule", ".${1:selector} {\n  ${2:property}: ${3:value};\n}"],
    ["flex", "display: flex;\nalign-items: ${1:center};\njustify-content: ${2:center};"],
    ["grid", "display: grid;\ngap: ${1:1rem};"],
  ],
};

function createSnippetSuggestions(languageId) {
  const snippets = COMPLETION_SETS[languageId] || [];

  return snippets.map(([label, insertText]) => ({
    label,
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertText,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    detail: `${languageId} snippet`,
    documentation: `Insert ${label}`,
  }));
}

function registerCompletionProvider(languageId) {
  monaco.languages.registerCompletionItemProvider(languageId, {
    triggerCharacters: [".", "(", "\"", "'", "_"],
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      return {
        suggestions: createSnippetSuggestions(languageId).map((suggestion) => ({
          ...suggestion,
          range,
        })),
      };
    },
  });
}

/**
 * The TypeScript language service, wherever this monaco build keeps it.
 *
 * monaco-editor 0.56 moved it: it used to hang off `languages.typescript`, and
 * is now a top-level `typescript` export. Checking both keeps this working
 * across the upgrade instead of throwing on whichever one is missing.
 */
function getTypeScriptApi() {
  return monaco.typescript ?? monaco.languages?.typescript ?? null;
}

function configureLanguageDefaults() {
  const typescriptApi = getTypeScriptApi();

  // Editor autocomplete and diagnostics are a nicety. Losing them must not stop
  // the room from opening — this file is imported for its side effects during
  // mount, so anything thrown here blanks the whole page.
  if (!typescriptApi?.javascriptDefaults) {
    console.warn(
      "monaco: TypeScript language service unavailable; editing works, " +
        "IntelliSense and type diagnostics are off.",
    );
    return;
  }

  const { javascriptDefaults, typescriptDefaults } = typescriptApi;

  javascriptDefaults.setEagerModelSync(true);
  typescriptDefaults.setEagerModelSync(true);

  const compilerOptions = {
    allowJs: true,
    allowNonTsExtensions: true,
    target: typescriptApi.ScriptTarget.ES2022,
    module: typescriptApi.ModuleKind.ESNext,
    moduleResolution: typescriptApi.ModuleResolutionKind.NodeJs,
    jsx: typescriptApi.JsxEmit.ReactJSX,
    strict: false,
    noEmit: true,
    esModuleInterop: true,
    resolveJsonModule: true,
  };

  javascriptDefaults.setCompilerOptions(compilerOptions);
  typescriptDefaults.setCompilerOptions(compilerOptions);

  const diagnosticsOptions = {
    noSemanticValidation: false,
    noSyntaxValidation: false,
    onlyVisible: false,
  };

  javascriptDefaults.setDiagnosticsOptions(diagnosticsOptions);
  typescriptDefaults.setDiagnosticsOptions(diagnosticsOptions);
}

if (globalScope && !globalScope.__CODECHATTER_MONACO_READY__) {
  globalScope.MonacoEnvironment = {
    getWorker(_, label) {
      if (label === "json") {
        return new jsonWorker();
      }

      if (label === "css" || label === "scss" || label === "less") {
        return new cssWorker();
      }

      if (label === "html" || label === "handlebars" || label === "razor") {
        return new htmlWorker();
      }

      if (label === "typescript" || label === "javascript") {
        return new tsWorker();
      }

      return new editorWorker();
    },
  };

  // Everything below is optional polish on top of a working editor. This module
  // runs at import time, so an exception here escapes before React can render
  // and takes the whole room down with a blank page — which is exactly what a
  // monaco API move did. Hand the editor over even if the extras fail.
  try {
    configureLanguageDefaults();
    Object.keys(COMPLETION_SETS).forEach(registerCompletionProvider);
  } catch (error) {
    console.error("monaco: language setup failed; the editor still works.", error);
  }

  loader.config({ monaco });
  globalScope.__CODECHATTER_MONACO_READY__ = true;
}
