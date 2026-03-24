import * as vscode from 'vscode';

class JsonClassMapper {
    private dependencies: Map<string, string> = new Map();
    private watcher: vscode.FileSystemWatcher;

    constructor(
        private watcherPattern: string,
        private findFilesPattern: string,
        private showLoadedMessage: boolean = false
    ) {
        this.watcher = vscode.workspace.createFileSystemWatcher(this.watcherPattern);
        if (this.showLoadedMessage && this.watcher) {
            vscode.window.showInformationMessage('carregado!');
        }
        this.initialize();
    }

    private async initialize() {
        await this.loadDependencies();
        this.setupWatchers();
    }

    private async loadDependencies() {
        this.dependencies.clear();
        const files = await vscode.workspace.findFiles(this.findFilesPattern, '**/vendor/**, **/node_modules/**');

        for (const file of files) {
            try {
                const document = await vscode.workspace.openTextDocument(file);
                const json = JSON.parse(document.getText());

                for (const key in json) {
                    if (typeof json[key] === 'string') {
                        this.dependencies.set(key, json[key]);
                    }
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Error loading keys from ${file.fsPath}: ${error}`);
            }
        }
    }

    private setupWatchers() {
        this.watcher.onDidChange(() => this.loadDependencies());
        this.watcher.onDidCreate(() => this.loadDependencies());
        this.watcher.onDidDelete(() => this.loadDependencies());
    }

    public getClassName(key: string): string | undefined {
        return this.dependencies.get(key);
    }
}

// --- HELPER FUNCTIONS ---

function resolveAndInjectImport(
    document: vscode.TextDocument,
    editBuilder: vscode.TextEditorEdit,
    className: string,
    hoveredText: string,
    injectedClasses: Map<string, string> = new Map()
): string {
    className = className.replace(/^\\/, '');
    if (injectedClasses.has(className)) {
        return injectedClasses.get(className)!;
    }

    const text = document.getText();
    const namespaceMatch = text.match(/^namespace\s+([^;]+);/m);
    const currentNamespace = namespaceMatch ? namespaceMatch[1].trim() : '';
    const useStatementsMatch = text.match(/^use\s+([^;]+);$/gm) || [];

    let existingImportName: string | undefined;

    for (const stmt of useStatementsMatch) {
        const content = stmt.replace(/^use\s+/, '').replace(/;$/, '').trim();
        const parts = content.split(/\s+[aA][sS]\s+/);
        const importedClass = parts[0].trim();
        const alias = parts[1] ? parts[1].trim() : importedClass.split('\\').pop();

        if (importedClass === className) {
            existingImportName = alias;
            break;
        }
    }

    if (!existingImportName) {
        const classParts = className.split('\\');
        const classShortName = classParts.pop();
        const classNamespace = classParts.join('\\');
        if (currentNamespace && classNamespace === currentNamespace) {
            existingImportName = classShortName;
        }
    }

    const nameToUse = existingImportName || hoveredText;

    if (!existingImportName) {
        const classShortName = className.split('\\').pop() || '';
        const aliasPart = hoveredText === classShortName ? '' : ` as ${hoveredText}`;
        const newUseStatement = `use ${className}${aliasPart};\n`;

        vscode.window.showInformationMessage(`Classe importada ${classShortName}`);

        let insertPosition: vscode.Position;
        const namespaceRegex = /^namespace\s+([^;]+);/m;
        const namespaceLineMatch = namespaceRegex.exec(text);

        if (namespaceLineMatch) {
            const namespaceLineIndex = text.substr(0, namespaceLineMatch.index).split('\n').length - 1;
            const nextLineIndex = namespaceLineIndex + 1;

            if (nextLineIndex < document.lineCount) {
                const nextLine = document.lineAt(nextLineIndex).text;
                if (nextLine.trim() === '') {
                    insertPosition = new vscode.Position(nextLineIndex + 1, 0);
                    editBuilder.insert(insertPosition, newUseStatement);
                } else {
                    insertPosition = new vscode.Position(nextLineIndex, 0);
                    editBuilder.insert(insertPosition, `\n${newUseStatement}`);
                }
            } else {
                insertPosition = new vscode.Position(nextLineIndex, 0);
                editBuilder.insert(insertPosition, `\n${newUseStatement}`);
            }
        } else {
            const phpTagMatch = /^<\?php/m.exec(text);
            if (phpTagMatch) {
                const phpLineIndex = text.substr(0, phpTagMatch.index).split('\n').length - 1;
                const nextLineIndex = phpLineIndex + 1;
                if (nextLineIndex < document.lineCount) {
                    const nextLine = document.lineAt(nextLineIndex).text;
                    if (nextLine.trim() === '') {
                        insertPosition = new vscode.Position(nextLineIndex + 1, 0);
                        editBuilder.insert(insertPosition, newUseStatement);
                    } else {
                        insertPosition = new vscode.Position(nextLineIndex, 0);
                        editBuilder.insert(insertPosition, `\n${newUseStatement}`);
                    }
                } else {
                    insertPosition = new vscode.Position(nextLineIndex, 0);
                    editBuilder.insert(insertPosition, `\n${newUseStatement}`);
                }
            } else {
                insertPosition = new vscode.Position(0, 0);
                editBuilder.insert(insertPosition, `${newUseStatement}\n`);
            }
        }
    }

    injectedClasses.set(className, nameToUse);
    return nameToUse;
}

async function executeBulkReplacements(
    editor: vscode.TextEditor,
    dependencyMapper: JsonClassMapper,
    entityMapper: JsonClassMapper,
    modes: ('container' | 'entidade' | 'getCampo' | 'setCampo')[]
) {
    const document = editor.document;
    const text = document.getText();
    const injectedClasses = new Map<string, string>();
    let totalReplacements = 0;

    await editor.edit(editBuilder => {
        if (modes.includes('container')) {
            const pattern = /(\w+\\?)+(::|->)get\s*\(\s*['"]([^'"]+)['"]\s*(?:,\s*(?:false|FALSE|False)\s*)?\)/g;
            let match;
            while ((match = pattern.exec(text)) !== null) {
                const hoveredText = match[3];
                const className = dependencyMapper.getClassName(hoveredText);
                if (className) {
                    const nameToUse = resolveAndInjectImport(document, editBuilder, className, hoveredText, injectedClasses);
                    const startPos = document.positionAt(match.index);
                    const endPos = document.positionAt(match.index + match[0].length);
                    editBuilder.replace(new vscode.Range(startPos, endPos), `(new ${nameToUse})`);
                    totalReplacements++;
                }
            }
        }

        if (modes.includes('entidade')) {
            const pattern = /ConteinerEntidade(::|->)getInstancia\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
            let match;
            while ((match = pattern.exec(text)) !== null) {
                const hoveredText = match[2];
                const className = entityMapper.getClassName(hoveredText);
                if (className) {
                    const nameToUse = resolveAndInjectImport(document, editBuilder, className, hoveredText, injectedClasses);
                    const startPos = document.positionAt(match.index);
                    const endPos = document.positionAt(match.index + match[0].length);
                    editBuilder.replace(new vscode.Range(startPos, endPos), `(new ${nameToUse})`);
                    totalReplacements++;
                }
            }
        }

        if (modes.includes('getCampo')) {
            const pattern = /(\$[a-zA-Z0-9_]+)->getCampo\s*\(\s*(['"][^'"]+['"])\s*\)->get\s*\(\s*['"]valor['"]\s*\)/g;
            let match;
            while ((match = pattern.exec(text)) !== null) {
                const varName = match[1];
                const campoName = match[2];
                const startPos = document.positionAt(match.index);
                const endPos = document.positionAt(match.index + match[0].length);
                editBuilder.replace(new vscode.Range(startPos, endPos), `${varName}[${campoName}]`);
                totalReplacements++;
            }
        }

        if (modes.includes('setCampo')) {
            const pattern = /(\$[a-zA-Z0-9_]+)->setCampo\s*\(\s*(['"][^'"]+['"])\s*,\s*(.*?)\)\s*(?=;|\r?\n|$)/gm;
            let match;
            while ((match = pattern.exec(text)) !== null) {
                const varName = match[1];
                const campoName = match[2];
                const varValue = match[3];
                const startPos = document.positionAt(match.index);
                const endPos = document.positionAt(match.index + match[0].length);
                editBuilder.replace(new vscode.Range(startPos, endPos), `${varName}[${campoName}] = ${varValue}`);
                totalReplacements++;
            }
        }
    });

    if (totalReplacements > 0) {
        vscode.window.showInformationMessage(`${totalReplacements} substituições realizadas em lote!`);
    } else {
        vscode.window.showInformationMessage('Nenhuma substituição aplicável foi encontrada no arquivo.');
    }
}

function promptAndReplaceText(
    editor: vscode.TextEditor | undefined,
    range: vscode.Range,
    replacement: string,
    promptMessage: string
) {
    if (!editor) return;
    vscode.window.showInformationMessage(promptMessage, 'Yes', 'No').then(ans => {
        if (ans === 'Yes') {
            editor.edit(editBuilder => {
                editBuilder.replace(range, replacement);
            });
        }
    });
}

// --- HOVER HANDLERS ---

async function handleContainerGet(
    document: vscode.TextDocument,
    position: vscode.Position,
    wordRange: vscode.Range,
    lineText: string,
    dependencyMapper: JsonClassMapper
): Promise<vscode.Hover | undefined> {
    const containerGetPattern = /(\w+\\?)+(::|->)get\s*\(\s*['"]([^'"]+)['"]\s*(?:,\s*(?:false|FALSE|False)\s*)?\)/;
    const match = containerGetPattern.exec(lineText);
    if (!match) return undefined;

    const hoveredText = document.getText(wordRange).slice(1, -1);
    const className = dependencyMapper.getClassName(hoveredText);
    if (!className) return undefined;

    const md = new vscode.MarkdownString();
    const files = await vscode.workspace.findFiles(`**/${className.replace(/\\/g, '/')}.php`, '**/vendor/**, **/node_modules/**');
    if (files.length > 0) {
        md.appendText('\n\n[Open file](' + files[0].toString() + ')');
    }

    vscode.window.showInformationMessage(`Você gostaria de trocar "${match[0]}" por "(new ${hoveredText})"?`, 'Yes', 'No').then(ans => {
        if (ans === 'Yes') {
            vscode.window.activeTextEditor?.edit(editBuilder => {
                const nameToUse = resolveAndInjectImport(document, editBuilder, className, hoveredText);
                const startPos = new vscode.Position(position.line, match.index);
                const endPos = new vscode.Position(position.line, match.index + match[0].length);
                editBuilder.replace(new vscode.Range(startPos, endPos), `(new ${nameToUse})`);
            });
        }
    });

    return new vscode.Hover(md);
}

async function handleConteinerEntidade(
    document: vscode.TextDocument,
    position: vscode.Position,
    wordRange: vscode.Range,
    lineText: string,
    entityMapper: JsonClassMapper
): Promise<vscode.Hover | undefined> {
    const conteinerEntidadePattern = /ConteinerEntidade(::|->)getInstancia\s*\(\s*['"]([^'"]+)['"]\s*\)/;
    const match = conteinerEntidadePattern.exec(lineText);
    if (!match) return undefined;

    const hoveredText = document.getText(wordRange).slice(1, -1);
    const className = entityMapper.getClassName(hoveredText);
    if (!className) return undefined;

    const md = new vscode.MarkdownString();
    const files = await vscode.workspace.findFiles(`**/${className.replace(/\\/g, '/')}.php`, '**/vendor/**, **/node_modules/**');
    if (files.length > 0) {
        md.appendText('\n\n[Open file](' + files[0].toString() + ')');
    }

    vscode.window.showInformationMessage(`Você gostaria de trocar "${match[0]}" por "(new ${hoveredText})"?`, 'Yes', 'No').then(ans => {
        if (ans === 'Yes') {
            vscode.window.activeTextEditor?.edit(editBuilder => {
                const nameToUse = resolveAndInjectImport(document, editBuilder, className, hoveredText);
                const startPos = new vscode.Position(position.line, match.index);
                const endPos = new vscode.Position(position.line, match.index + match[0].length);
                editBuilder.replace(new vscode.Range(startPos, endPos), `(new ${nameToUse})`);
            });
        }
    });

    return new vscode.Hover(md);
}

function handleGetCampo(
    document: vscode.TextDocument,
    position: vscode.Position,
    lineText: string
): vscode.Hover | undefined {
    const getCampoPattern = /(\$[a-zA-Z0-9_]+)->getCampo\s*\(\s*(['"][^'"]+['"])\s*\)->get\s*\(\s*['"]valor['"]\s*\)/;
    const matchGetCampo = getCampoPattern.exec(lineText);
    if (!matchGetCampo) return undefined;

    const varName = matchGetCampo[1];
    const campoName = matchGetCampo[2]; // includes quotes

    const md = new vscode.MarkdownString();
    md.appendText(`Identificado: \`${matchGetCampo[0]}\``);

    promptAndReplaceText(
        vscode.window.activeTextEditor,
        new vscode.Range(new vscode.Position(position.line, matchGetCampo.index), new vscode.Position(position.line, matchGetCampo.index + matchGetCampo[0].length)),
        `${varName}[${campoName}]`,
        `Você gostaria de trocar "${matchGetCampo[0]}" por "${varName}[${campoName}]"?`
    );

    return new vscode.Hover(md);
}

function handleSetCampo(
    document: vscode.TextDocument,
    position: vscode.Position,
    lineText: string
): vscode.Hover | undefined {
    const setCampoPattern = /(\$[a-zA-Z0-9_]+)->setCampo\s*\(\s*(['"][^'"]+['"])\s*,\s*(.*?)\)\s*(?=;|$)/;
    const matchSetCampo = setCampoPattern.exec(lineText);
    if (!matchSetCampo) return undefined;

    const varName = matchSetCampo[1];
    const campoName = matchSetCampo[2]; // includes quotes
    const varValue = matchSetCampo[3];

    const md = new vscode.MarkdownString();
    md.appendText(`Identificado: \`${matchSetCampo[0]}\``);

    promptAndReplaceText(
        vscode.window.activeTextEditor,
        new vscode.Range(new vscode.Position(position.line, matchSetCampo.index), new vscode.Position(position.line, matchSetCampo.index + matchSetCampo[0].length)),
        `${varName}[${campoName}] = ${varValue}`,
        `Você gostaria de trocar "${matchSetCampo[0]}" por "${varName}[${campoName}] = ${varValue}"?`
    );

    return new vscode.Hover(md);
}

export function activate(context: vscode.ExtensionContext) {
    const dependencyMapper = new JsonClassMapper('./crm/src/dependencias.json', '**/dependencias.json', true);
    const entityMapper = new JsonClassMapper('./crm/src/entidades/Entidades.json', '**/Entidades.json');

    const hoverProvider = vscode.languages.registerHoverProvider('php', {
        async provideHover(document, position) {
            const wordRange = document.getWordRangeAtPosition(position, /(['"])([^'"]+)\1/);
            if (!wordRange) return;

            const lineText = document.lineAt(position.line).text; // Remove quotes

            let hover = await handleContainerGet(document, position, wordRange, lineText, dependencyMapper);
            if (hover) return hover;

            hover = await handleConteinerEntidade(document, position, wordRange, lineText, entityMapper);
            if (hover) return hover;

            hover = handleGetCampo(document, position, lineText);
            if (hover) return hover;

            hover = handleSetCampo(document, position, lineText);
            if (hover) return hover;

            return undefined;
        }
    });

    const cmdContainerGet = vscode.commands.registerCommand('extension.replaceContainerGet', () => {
        if (vscode.window.activeTextEditor) executeBulkReplacements(vscode.window.activeTextEditor, dependencyMapper, entityMapper, ['container']);
    });

    const cmdConteinerEntidade = vscode.commands.registerCommand('extension.replaceConteinerEntidade', () => {
        if (vscode.window.activeTextEditor) executeBulkReplacements(vscode.window.activeTextEditor, dependencyMapper, entityMapper, ['entidade']);
    });

    const cmdGetCampo = vscode.commands.registerCommand('extension.replaceGetCampo', () => {
        if (vscode.window.activeTextEditor) executeBulkReplacements(vscode.window.activeTextEditor, dependencyMapper, entityMapper, ['getCampo']);
    });

    const cmdSetCampo = vscode.commands.registerCommand('extension.replaceSetCampo', () => {
        if (vscode.window.activeTextEditor) executeBulkReplacements(vscode.window.activeTextEditor, dependencyMapper, entityMapper, ['setCampo']);
    });

    const cmdAllPatterns = vscode.commands.registerCommand('extension.replaceAllPatterns', () => {
        if (vscode.window.activeTextEditor) executeBulkReplacements(vscode.window.activeTextEditor, dependencyMapper, entityMapper, ['container', 'entidade', 'getCampo', 'setCampo']);
    });

    context.subscriptions.push(hoverProvider, cmdContainerGet, cmdConteinerEntidade, cmdGetCampo, cmdSetCampo, cmdAllPatterns);
    // const inlineProvider = vscode.languages.registerInlineCompletionItemProvider(
    //     { pattern: '**' },
    //     {
    //         provideInlineCompletionItems: async (document, position) => {
    //             return [{ text: '< 2) {\n\treturn 1;\n\t}' }]
    //         },
    //     },
    // )
}

export function deactivate() { }