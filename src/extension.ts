import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// ── Data structures ──────────────────────────────────────────────

interface MethodInfo {
    name: string;
    params: string[];       // e.g. ["obj", "hash"]
    returnType: string;     // e.g. "object", "float", "bool", "void"
    raw: string;            // original comment line
}

interface ModuleInfo {
    name: string;
    description: string;    // first comment line after "# name —"
    methods: MethodInfo[];
    types: string[];        // e.g. ["HitInfo", "PhysicsChassis"]
}

// ── Built-in keywords / functions / constants ────────────────────

const KEYWORDS = [
    'def', 'if', 'elif', 'else', 'while', 'return', 'pass', 'assert',
    'module', 'import', 'and', 'or', 'not'
];

const CONSTANTS = [
    { name: 'true', detail: 'Boolean true' },
    { name: 'false', detail: 'Boolean false' },
    { name: 'none', detail: 'Null value' },
];

const BUILTINS = [
    { name: 'len', signature: 'len(obj) -> float', detail: 'Returns the length of a list or collection' },
    { name: 'float', signature: 'float(value) -> float', detail: 'Converts a value to float' },
    { name: 'int', signature: 'int(value) -> float', detail: 'Truncates a float to integer (still returns float type)' },
    { name: 'abs', signature: 'abs(value) -> float', detail: 'Returns the absolute value' },
];

// ── Type code mapping (from xvm_globals.txt format reference) ────

const TYPE_CODES: Record<string, string> = {
    '0': 'void', '1': 'bool', '3': 'float', '4': 'hash', '7': 'object', 'F': 'any'
};

// ── Parse xvm_globals.txt ────────────────────────────────────────

function parseGlobals(filePath: string): Map<string, ModuleInfo> {
    const modules = new Map<string, ModuleInfo>();

    if (!fs.existsSync(filePath)) {
        return modules;
    }

    const text = fs.readFileSync(filePath, 'utf-8');
    const lines = text.split(/\r?\n/);

    let currentModule: ModuleInfo | null = null;

    for (const line of lines) {
        const trimmed = line.trim();

        // Module description: "# name — description"
        const descMatch = trimmed.match(/^#\s+(\w+)\s+[—–-]\s+(.+)$/);
        if (descMatch) {
            // This is a header for an upcoming module
            // We'll use it when we see the bare module name
            const pendingName = descMatch[1];
            const pendingDesc = descMatch[2];
            // Pre-create or update
            if (!modules.has(pendingName)) {
                modules.set(pendingName, {
                    name: pendingName,
                    description: pendingDesc,
                    methods: [],
                    types: []
                });
            } else {
                modules.get(pendingName)!.description = pendingDesc;
            }
            currentModule = modules.get(pendingName)!;
            continue;
        }

        // Method: "#   .MethodName(params) -> return"
        const methodMatch = trimmed.match(/^#\s+\.(\w+)\(([^)]*)\)(?:\s*->\s*(\w+))?/);
        if (methodMatch && currentModule) {
            const name = methodMatch[1];
            const paramsStr = methodMatch[2].trim();
            const returnType = methodMatch[3] || 'void';
            const params = paramsStr ? paramsStr.split(/,\s*/) : [];
            currentModule.methods.push({
                name,
                params,
                returnType,
                raw: trimmed.replace(/^#\s+/, '')
            });
            continue;
        }

        // Types line: "#   Types: Foo, Bar, Baz"
        const typesMatch = trimmed.match(/^#\s+Types?:\s*(.+)$/);
        if (typesMatch && currentModule) {
            const typeNames = typesMatch[1].split(/,\s+/).map(t => t.trim());
            currentModule.types.push(...typeNames);
            continue;
        }

        // Bare module name (not a comment, not empty)
        if (trimmed && !trimmed.startsWith('#')) {
            const moduleName = trimmed;
            if (currentModule && currentModule.name === moduleName) {
                // Already created from header comment — confirmed
            } else {
                // Module without description header (rare)
                if (!modules.has(moduleName)) {
                    modules.set(moduleName, {
                        name: moduleName,
                        description: '',
                        methods: [],
                        types: []
                    });
                }
            }
            currentModule = null; // reset for next section
        }
    }

    return modules;
}

// ── Find xvm_globals.txt ────────────────────────────────────────

function findGlobalsFile(): string | undefined {
    // 1. Check user setting xvm.globalsPath
    const configPath = vscode.workspace.getConfiguration('xvm').get<string>('globalsPath');
    if (configPath && fs.existsSync(configPath)) { return configPath; }

    // 2. Check workspace folders
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
        for (const folder of workspaceFolders) {
            const candidates = [
                path.join(folder.uri.fsPath, 'xvm_globals.txt'),
                path.join(folder.uri.fsPath, 'bin', 'xvm_globals.txt'),
            ];
            for (const c of candidates) {
                if (fs.existsSync(c)) { return c; }
            }
        }
    }

    // 3. Check next to extension
    const extPath = path.join(__dirname, '..', 'xvm_globals.txt');
    if (fs.existsSync(extPath)) { return extPath; }

    // 4. Check parent directory (for development - extension is in vscode-xvm/)
    const parentPath = path.join(__dirname, '..', '..', 'bin', 'xvm_globals.txt');
    if (fs.existsSync(parentPath)) { return parentPath; }

    return undefined;
}

// ── Activation ──────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext) {
    const globalsPath = findGlobalsFile();
    const modules = globalsPath ? parseGlobals(globalsPath) : new Map<string, ModuleInfo>();

    if (modules.size > 0) {
        console.log(`XVM: loaded ${modules.size} engine modules from ${globalsPath}`);
    } else {
        console.log('XVM: no xvm_globals.txt found, IntelliSense for engine modules disabled');
    }

    const selector: vscode.DocumentSelector = { language: 'xvm', scheme: 'file' };

    // ── Completion Provider ──────────────────────────────────────
    const completionProvider = vscode.languages.registerCompletionItemProvider(
        selector,
        {
            provideCompletionItems(document, position, _token, _context) {
                const items: vscode.CompletionItem[] = [];
                const lineText = document.lineAt(position).text;
                const textBefore = lineText.substring(0, position.character);

                // After dot: module.Method completions
                const dotMatch = textBefore.match(/\b(\w+)\.(\w*)$/);
                if (dotMatch) {
                    const moduleName = dotMatch[1];
                    const mod = modules.get(moduleName);
                    if (mod) {
                        for (const method of mod.methods) {
                            const item = new vscode.CompletionItem(
                                method.name,
                                vscode.CompletionItemKind.Method
                            );
                            const paramList = method.params.join(', ');
                            item.detail = `${moduleName}.${method.name}(${paramList})` +
                                (method.returnType !== 'void' ? ` -> ${method.returnType}` : '');
                            item.documentation = new vscode.MarkdownString(
                                `**${moduleName}**.${method.name}\n\n` +
                                `\`\`\`\n${method.raw}\n\`\`\``
                            );
                            // Insert snippet with parameter placeholders
                            if (method.params.length > 0) {
                                const snippetParams = method.params.map((p, i) =>
                                    `\${${i + 1}:${p}}`
                                ).join(', ');
                                item.insertText = new vscode.SnippetString(
                                    `${method.name}(${snippetParams})`
                                );
                            } else {
                                item.insertText = new vscode.SnippetString(
                                    `${method.name}()`
                                );
                            }
                            items.push(item);
                        }
                        return items;
                    }
                }

                // Top-level completions (not after dot)
                if (!dotMatch) {
                    // Engine module names
                    for (const [name, mod] of modules) {
                        const item = new vscode.CompletionItem(
                            name,
                            vscode.CompletionItemKind.Module
                        );
                        item.detail = mod.description || `Engine module: ${name}`;
                        item.documentation = new vscode.MarkdownString(
                            `**${name}** — ${mod.description}\n\n` +
                            `${mod.methods.length} methods available. Type \`${name}.\` to see them.`
                        );
                        items.push(item);
                    }

                    // Keywords
                    for (const kw of KEYWORDS) {
                        const item = new vscode.CompletionItem(
                            kw,
                            vscode.CompletionItemKind.Keyword
                        );
                        item.detail = 'keyword';
                        items.push(item);
                    }

                    // Constants
                    for (const c of CONSTANTS) {
                        const item = new vscode.CompletionItem(
                            c.name,
                            vscode.CompletionItemKind.Constant
                        );
                        item.detail = c.detail;
                        items.push(item);
                    }

                    // Built-in functions
                    for (const b of BUILTINS) {
                        const item = new vscode.CompletionItem(
                            b.name,
                            vscode.CompletionItemKind.Function
                        );
                        item.detail = b.signature;
                        item.documentation = b.detail;
                        items.push(item);
                    }
                }

                return items;
            }
        },
        '.'  // trigger on dot
    );

    // ── Hover Provider ───────────────────────────────────────────
    const hoverProvider = vscode.languages.registerHoverProvider(
        selector,
        {
            provideHover(document, position, _token) {
                const wordRange = document.getWordRangeAtPosition(position, /[A-Za-z_]\w*/);
                if (!wordRange) { return undefined; }

                const word = document.getText(wordRange);
                const lineText = document.lineAt(position).text;
                const charBefore = wordRange.start.character;
                const charAfter = wordRange.end.character;

                // Check if this is "module.Method" pattern
                // Is there a dot before this word?
                if (charBefore > 0 && lineText[charBefore - 1] === '.') {
                    // Find the module name before the dot
                    const beforeDot = lineText.substring(0, charBefore - 1);
                    const modMatch = beforeDot.match(/(\w+)$/);
                    if (modMatch) {
                        const mod = modules.get(modMatch[1]);
                        if (mod) {
                            const method = mod.methods.find(m => m.name === word);
                            if (method) {
                                const paramList = method.params.join(', ');
                                const sig = `${mod.name}.${method.name}(${paramList})` +
                                    (method.returnType !== 'void' ? ` -> ${method.returnType}` : '');
                                const md = new vscode.MarkdownString();
                                md.appendCodeblock(sig, 'xvm');
                                if (mod.description) {
                                    md.appendMarkdown(`\n*Module: ${mod.name} — ${mod.description}*`);
                                }
                                return new vscode.Hover(md, wordRange);
                            }
                        }
                    }
                }

                // Is there a dot after this word? → it's a module name
                if (charAfter < lineText.length && lineText[charAfter] === '.') {
                    const mod = modules.get(word);
                    if (mod) {
                        const md = new vscode.MarkdownString();
                        md.appendMarkdown(`**${mod.name}** — ${mod.description}\n\n`);
                        md.appendMarkdown(`${mod.methods.length} methods`);
                        if (mod.types.length > 0) {
                            md.appendMarkdown(` | Types: ${mod.types.join(', ')}`);
                        }
                        return new vscode.Hover(md, wordRange);
                    }
                }

                // Standalone module name (no dot context)
                const mod = modules.get(word);
                if (mod) {
                    const md = new vscode.MarkdownString();
                    md.appendMarkdown(`**${mod.name}** — ${mod.description}\n\n`);
                    md.appendMarkdown(`${mod.methods.length} methods available`);
                    return new vscode.Hover(md, wordRange);
                }

                // Built-in functions
                const builtin = BUILTINS.find(b => b.name === word);
                if (builtin) {
                    const md = new vscode.MarkdownString();
                    md.appendCodeblock(builtin.signature, 'xvm');
                    md.appendMarkdown(`\n${builtin.detail}`);
                    return new vscode.Hover(md, wordRange);
                }

                // Keywords
                if (KEYWORDS.includes(word)) {
                    return new vscode.Hover(
                        new vscode.MarkdownString(`**${word}** — keyword`),
                        wordRange
                    );
                }

                // Constants
                const constant = CONSTANTS.find(c => c.name === word);
                if (constant) {
                    return new vscode.Hover(
                        new vscode.MarkdownString(`**${constant.name}** — ${constant.detail}`),
                        wordRange
                    );
                }

                return undefined;
            }
        }
    );

    // ── Signature Help Provider ──────────────────────────────────
    const signatureProvider = vscode.languages.registerSignatureHelpProvider(
        selector,
        {
            provideSignatureHelp(document, position, _token, _context) {
                const lineText = document.lineAt(position).text;
                const textBefore = lineText.substring(0, position.character);

                // Find the unclosed function call: module.Method(arg1, arg2|
                // Walk backwards to find matching open paren
                let depth = 0;
                let parenPos = -1;
                let commaCount = 0;

                for (let i = textBefore.length - 1; i >= 0; i--) {
                    const ch = textBefore[i];
                    if (ch === ')') { depth++; }
                    else if (ch === '(') {
                        if (depth === 0) {
                            parenPos = i;
                            break;
                        }
                        depth--;
                    }
                    else if (ch === ',' && depth === 0) {
                        commaCount++;
                    }
                }

                if (parenPos < 0) { return undefined; }

                // Get the text before the open paren to find "module.Method"
                const beforeParen = textBefore.substring(0, parenPos).trimEnd();

                // Check built-in functions first
                const builtinMatch = beforeParen.match(/\b(\w+)$/);
                if (builtinMatch) {
                    const builtin = BUILTINS.find(b => b.name === builtinMatch[1]);
                    if (builtin) {
                        const sigHelp = new vscode.SignatureHelp();
                        const sigInfo = new vscode.SignatureInformation(builtin.signature);
                        sigInfo.documentation = builtin.detail;
                        // Parse params from signature
                        const paramMatch = builtin.signature.match(/\(([^)]*)\)/);
                        if (paramMatch && paramMatch[1]) {
                            const params = paramMatch[1].split(/,\s*/);
                            sigInfo.parameters = params.map(p =>
                                new vscode.ParameterInformation(p)
                            );
                        }
                        sigHelp.signatures = [sigInfo];
                        sigHelp.activeSignature = 0;
                        sigHelp.activeParameter = commaCount;
                        return sigHelp;
                    }
                }

                // Check module.Method pattern
                const callMatch = beforeParen.match(/\b(\w+)\.(\w+)$/);
                if (!callMatch) { return undefined; }

                const moduleName = callMatch[1];
                const methodName = callMatch[2];
                const mod = modules.get(moduleName);
                if (!mod) { return undefined; }

                const method = mod.methods.find(m => m.name === methodName);
                if (!method) { return undefined; }

                const paramList = method.params.join(', ');
                const label = `${moduleName}.${methodName}(${paramList})` +
                    (method.returnType !== 'void' ? ` -> ${method.returnType}` : '');

                const sigHelp = new vscode.SignatureHelp();
                const sigInfo = new vscode.SignatureInformation(label);
                sigInfo.documentation = method.raw;

                // Add parameter info
                sigInfo.parameters = method.params.map(p =>
                    new vscode.ParameterInformation(p)
                );

                sigHelp.signatures = [sigInfo];
                sigHelp.activeSignature = 0;
                sigHelp.activeParameter = commaCount;

                return sigHelp;
            }
        },
        '(', ','  // trigger on open-paren and comma
    );

    context.subscriptions.push(completionProvider, hoverProvider, signatureProvider);
}

export function deactivate() {}
