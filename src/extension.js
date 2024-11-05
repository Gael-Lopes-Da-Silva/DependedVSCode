// @author: Gael Lopes Da Silva
// @project: Depended
// @github: https://github.com/Gael-Lopes-Da-Silva/DependedVSCode

const vscode = require('vscode');
const https = require('https');
const toml = require('toml');

const handlers = {
    "package.json": checkJSDependencies,
    "Cargo.toml": checkRustDependencies
}

const decorationType = vscode.window.createTextEditorDecorationType({
    after: {
        margin: '0 0 0 1em',
    }
});

const versionCache = new Map();

let display = true;
let normalIcon = "✅";
let updateIcon = "⬆️";
let invalidIcon = "⚠️";

// ----------------------------------------------------

function activate(context) {
    const activeTextEditor = vscode.window.activeTextEditor;
    if (activeTextEditor) {
        checkFileDependencies(activeTextEditor.document);
    }

    context.subscriptions.push(
        vscode.commands.registerCommand('depended.toggleDislay', toggleDislay),
        vscode.commands.registerCommand('depended.updateVersionCache', updateVersionCache),
        vscode.window.onDidChangeActiveTextEditor(onDidChangeActiveTextEditor),
        vscode.workspace.onDidChangeTextDocument(onDidChangeTextDocument)
    );
}

function deactivate() {
    clearAllDecorations();
}

// ----------------------------------------------------

function loadConfiguration() {
    const config = vscode.workspace.getConfiguration('depended');

    display = config.inspect('display').globalValue || config.get('display');
    normalIcon = config.inspect('normalIcon').globalValue || config.get('normalIcon');
    updateIcon = config.inspect('updateIcon').globalValue || config.get('updateIcon');
    invalidIcon = config.inspect('invalidIcon').globalValue || config.get('invalidIcon');
}

function onDidChangeActiveTextEditor() {
    const activeTextEditor = vscode.window.activeTextEditor;
    if (!activeTextEditor) return;

    checkFileDependencies(activeTextEditor.document);
}

function onDidChangeTextDocument(event) {
    if (!vscode.window.activeTextEditor) return;

    if (event.document === vscode.window.activeTextEditor.document) {
        checkFileDependencies(event.document);
    }
}

function checkFileDependencies(document) {
    const handler = handlers[document.fileName.split('/').pop()];

    if (handler) {
        loadConfiguration();
        handler(document);
    }
}

function toggleDislay() {
    display = !display;

    if (display) {
        const activeTextEditor = vscode.window.activeTextEditor;
        if (!activeTextEditor) return;

        checkFileDependencies(activeTextEditor.document);
    } else {
        clearAllDecorations();
    }

    vscode.window.showInformationMessage(`Dependencies icons is now ${display ? 'on' : 'off'}.`);
}

function updateVersionCache() {
    versionCache.clear();

    const activeTextEditor = vscode.window.activeTextEditor;
    if (!activeTextEditor) return;

    clearAllDecorations();
    checkFileDependencies(activeTextEditor.document);
}

function getDecorationText(validVersion, upToDate, latestVersion) {
    return validVersion ? (upToDate ? `${normalIcon}` : `${updateIcon} ${latestVersion}`) : `${invalidIcon} ${latestVersion}`;
}

async function checkJSDependencies(document) {
    if (!display) return;

    const activeTextEditor = vscode.window.activeTextEditor;
    if (!activeTextEditor || activeTextEditor.document !== document) return;

    const text = document.getText();
    const decorations = [];

    let packageJson = {};
    try {
        packageJson = JSON.parse(text);
    } catch (error) {
        clearAllDecorations();
        return;
    }

    const dependencies = {
        ...packageJson['dependencies'],
        ...packageJson['devDependencies'],
        ...packageJson['peerDependencies'],
        ...packageJson['optionalDependencies'],
        ...packageJson['bundledDependencies']
    };

    const processDependencyData = (dependency, currentVersion, latestVersion, versions, text, document, decorations) => {
        const validVersion = versions[currentVersion] !== undefined;
        const upToDate = currentVersion === latestVersion;
        const statusText = getDecorationText(validVersion, upToDate, latestVersion);

        const regex = new RegExp(`"${dependency}"\\s*:\\s*"[\\^~]?${currentVersion}"(?:\\s*,)?`);
        const match = regex.exec(text);

        if (match) {
            const startPos = document.positionAt(match.index);
            const endPos = document.positionAt(match.index + match[0].length);
            const decoration = {
                range: new vscode.Range(startPos, endPos),
                renderOptions: {
                    after: { contentText: statusText }
                }
            };
            decorations.push(decoration);
        }
    }

    const dependencyChecks = Object.keys(dependencies).map(dependency => {
        return new Promise((resolve) => {
            const currentVersion = dependencies[dependency].replace(/[\^~]/, "");

            if (versionCache.has(dependency)) {
                const { latestVersion, versions } = versionCache.get(dependency);

                processDependencyData(dependency, currentVersion, latestVersion, versions, text, document, decorations);
                return resolve();
            }

            const url = `https://registry.npmjs.org/${dependency}`;

            https.get(url, (response) => {
                let data = '';

                response.on('data', chunk => {
                    data += chunk;
                });

                response.on('end', () => {
                    try {
                        const parsedData = JSON.parse(data);
                        const versions = parsedData.versions;
                        const latestVersion = Object.keys(versions).pop();

                        versionCache.set(dependency, { latestVersion, versions });
                        processDependencyData(dependency, currentVersion, latestVersion, versions, text, document, decorations);

                        resolve();
                    } catch (error) {
                        resolve();
                    }
                });
            }).on('error', () => {
                resolve();
            });
        });
    });

    await Promise.all(dependencyChecks);
    activeTextEditor.setDecorations(decorationType, decorations);
}

async function checkRustDependencies(document) {
    if (!display) return;

    const activeTextEditor = vscode.window.activeTextEditor;
    if (!activeTextEditor || activeTextEditor.document !== document) return;

    const text = document.getText();
    const decorations = [];

    let cargoToml = {};
    try {
        cargoToml = toml.parse(text);
    } catch (error) {
        clearAllDecorations();
        return;
    }

    const dependencies = {
        ...cargoToml['dependencies'],
        ...cargoToml['dev-dependencies'],
        ...cargoToml['build-dependencies']
    };

    const processDependencyData = (dependency, currentVersion, latestVersion, versions, text, document, decorations) => {
        const validVersion = versions.some(version => version.num === currentVersion);
        const upToDate = currentVersion === latestVersion;
        const statusText = getDecorationText(validVersion, upToDate, latestVersion);

        const regex = new RegExp(`${dependency}\\s*=\\s*(?:"[\\^~]?${currentVersion}"|{[^}]*version\\s*=\\s*"[\\^~]?${currentVersion}"[^}]*})`);
        const match = regex.exec(text);

        if (match) {
            const startPos = document.positionAt(match.index);
            const endPos = document.positionAt(match.index + match[0].length);
            const decoration = {
                range: new vscode.Range(startPos, endPos),
                renderOptions: {
                    after: { contentText: statusText }
                }
            };
            decorations.push(decoration);
        }
    }

    const dependencyChecks = Object.keys(dependencies).map(dependency => {
        return new Promise((resolve) => {
            const currentVersion = (dependencies[dependency]['version'] || dependencies[dependency]).replace(/[\^~]/, "");

            if (versionCache.has(dependency)) {
                const { latestVersion, versions } = versionCache.get(dependency);

                processDependencyData(dependency, currentVersion, latestVersion, versions, text, document, decorations);
                return resolve();
            }

            const url = `https://crates.io/api/v1/crates/${dependency}`;

            const options = {
                headers: {
                    'User-Agent': 'visual_studio_code: gael-lopes-da-silva.depended (gael.lopes-da-silva@outlook.fr)',
                }
            };

            https.get(url, options, (response) => {
                let data = '';

                response.on('data', chunk => {
                    data += chunk;
                });

                response.on('end', () => {
                    try {
                        const parsedData = JSON.parse(data);
                        const versions = parsedData.versions;
                        const latestVersion = parsedData.crate.newest_version;

                        versionCache.set(dependency, { latestVersion, versions });
                        processDependencyData(dependency, currentVersion, latestVersion, versions, text, document, decorations);

                        resolve();
                    } catch (error) {
                        resolve();
                    }
                });
            }).on('error', () => {
                resolve();
            });
        });
    });

    await Promise.all(dependencyChecks);
    activeTextEditor.setDecorations(decorationType, decorations);
}

function clearAllDecorations() {
    const activeTextEditor = vscode.window.activeTextEditor;
    if (!activeTextEditor) return;

    activeTextEditor.setDecorations(decorationType, []);
}

module.exports = {
    activate,
    deactivate
};