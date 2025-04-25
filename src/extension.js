// @author: Gael Lopes Da Silva
// @project: Depended
// @github: https://github.com/Gael-Lopes-Da-Silva/DependedVSCode

const vscode = require('vscode');
const https = require('https');
const toml = require('toml');
const semver = require('semver');

const handlers = {
    "package.json": checkJSDependencies,
    "Cargo.toml": checkRustDependencies,
    "composer.json": checkPhpDependencies,
    "requirements.txt": checkPythonDependencies,
}

const versionCache = [
    new Map(), // Javascript
    new Map(), // Rust
    new Map(), // Php
    new Map(), // Python
];

const decorationType = vscode.window.createTextEditorDecorationType({
    after: {
        margin: '0 0 0 1em',
    }
});

let display = true;
let displayJavascript = true;
let displayRust = true;
let displayPhp = true;
let displayPython = true;
let javascriptStable = false;
let rustStable = false;
let phpStable = false;
let pythonStable = false;
let normalIcon = "✅";
let updateIcon = "⬆️";
let invalidIcon = "⚠️";
let problemIcon = "❌";

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
    displayJavascript = config.inspect('javascript.display').globalValue || config.get('javascript.display');
    displayRust = config.inspect('rust.display').globalValue || config.get('rust.display');
    displayPhp = config.inspect('php.display').globalValue || config.get('php.display');
    displayPython = config.inspect('python.display').globalValue || config.get('python.display');
    javascriptStable = config.inspect('javascript.stable').globalValue || config.get('javascript.stable');
    rustStable = config.inspect('rust.stable').globalValue || config.get('rust.stable');
    phpStable = config.inspect('php.stable').globalValue || config.get('php.stable');
    pythonStable = config.inspect('python.stable').globalValue || config.get('python.stable');
    normalIcon = config.inspect('normalIcon').globalValue || config.get('normalIcon');
    updateIcon = config.inspect('updateIcon').globalValue || config.get('updateIcon');
    invalidIcon = config.inspect('invalidIcon').globalValue || config.get('invalidIcon');
    problemIcon = config.inspect('problemIcon').globalValue || config.get('problemIcon');
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

    vscode.window.showInformationMessage(`Dependencies icons are now ${display ? 'on' : 'off'}.`);
}

function updateVersionCache() {
    versionCache.forEach((cache) => cache.clear());

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

    if (!displayJavascript) return;

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

    const processDependencyError = (dependency, currentVersion) => {
        const regex = new RegExp(`"${dependency}"\\s*:\\s*"[\\^~]?${currentVersion}"(?:\\s*,)?`);
        const match = regex.exec(text);

        if (match) {
            const startPos = document.positionAt(match.index);
            const endPos = document.positionAt(match.index + match[0].length);
            const decoration = {
                range: new vscode.Range(startPos, endPos),
                renderOptions: {
                    after: { contentText: problemIcon }
                }
            };
            decorations.push(decoration);
        }
    }

    const dependencyChecks = Object.keys(dependencies).map(dependency => {
        return new Promise((resolve) => {
            const currentVersion = dependencies[dependency].replace(/[\^~]/, "");

            if (currentVersion === "") return resolve();

            if (versionCache[0].has(dependency)) {
                const { latestVersion, versions } = versionCache[0].get(dependency);

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

                        let latestVersion = "";
                        if (javascriptStable) {
                            const stableVersions = Object.keys(versions).filter(version => {
                                return !/(?:alpha|beta|rc|dev|post|preview|snapshot|canary|insider|insiders|internal|development)/i.test(version);
                            });

                            latestVersion = stableVersions.pop() || Object.keys(versions).pop();
                        } else {
                            latestVersion = Object.keys(versions).pop();
                        }

                        versionCache[0].set(dependency, { latestVersion, versions });
                        processDependencyData(dependency, currentVersion, latestVersion, versions, text, document, decorations);

                        resolve();
                    } catch (error) {
                        processDependencyError(dependency, currentVersion);
                        resolve();
                    }
                });
            }).on('error', () => {
                processDependencyError(dependency, currentVersion);
                resolve();
            });
        });
    });

    await Promise.all(dependencyChecks);
    activeTextEditor.setDecorations(decorationType, decorations);
}

async function checkRustDependencies(document) {
    if (!display) return;

    if (!displayRust) return;

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
        const validVersion = versions.some(version => version.num.startsWith(currentVersion));
        const upToDate = currentVersion === latestVersion || latestVersion.startsWith(currentVersion);
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

    const processDependencyError = (dependency, currentVersion) => {
        const regex = new RegExp(`${dependency}\\s*=\\s*(?:"[\\^~]?${currentVersion}"|{[^}]*version\\s*=\\s*"[\\^~]?${currentVersion}"[^}]*})`);
        const match = regex.exec(text);

        if (match) {
            const startPos = document.positionAt(match.index);
            const endPos = document.positionAt(match.index + match[0].length);
            const decoration = {
                range: new vscode.Range(startPos, endPos),
                renderOptions: {
                    after: { contentText: problemIcon }
                }
            };
            decorations.push(decoration);
        }
    }

    const dependencyChecks = Object.keys(dependencies).map(dependency => {
        return new Promise((resolve) => {
            const currentVersion = (dependencies[dependency]['version'] || dependencies[dependency]).replace(/[\^~]/, "");

            if (currentVersion === "") return resolve();

            if (versionCache[1].has(dependency)) {
                const { latestVersion, versions } = versionCache[1].get(dependency);

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

                        let latestVersion = "";
                        if (rustStable) {
                            const stableVersions = versions.filter(version => {
                                return !/(?:alpha|beta|rc|dev|post|preview|snapshot|canary)/i.test(version.num);
                            });

                            latestVersion = stableVersions[0].num || parsedData.crate.newest_version;
                        } else {
                            latestVersion = parsedData.crate.newest_version;
                        }

                        versionCache[1].set(dependency, { latestVersion, versions });
                        processDependencyData(dependency, currentVersion, latestVersion, versions, text, document, decorations);

                        resolve();
                    } catch (error) {
                        processDependencyError(dependency, currentVersion);
                        resolve();
                    }
                });
            }).on('error', () => {
                processDependencyError(dependency, currentVersion);
                resolve();
            });
        });
    });

    await Promise.all(dependencyChecks);
    activeTextEditor.setDecorations(decorationType, decorations);
}

async function checkPhpDependencies(document) {
    if (!display) return;
    if (!displayPhp) return;

    const activeTextEditor = vscode.window.activeTextEditor;
    if (!activeTextEditor || activeTextEditor.document !== document) return;

    const text = document.getText();
    const decorations = [];

    let composerJson = {};
    try {
        composerJson = JSON.parse(text);
    } catch (error) {
        clearAllDecorations();
        return;
    }

    const dependencies = {
        ...composerJson['require'],
        ...composerJson['require-dev']
    };

    function parseVersionConstraint(constraint) {
        const orGroups = constraint.split(/\s*\|\|\s*/).map(group => group.trim());
        return orGroups.map(group => {
            const conditions = group.split(/\s+/).filter(c => c);
            return conditions.map(condition => {
                const match = condition.match(/^([<>=!~^]*)(.*)$/);
                if (!match) return null;
                return { operator: match[1] || '=', version: match[2] };
            }).filter(c => c);
        });
    }

    function satisfiesConstraint(version, constraint) {
        return parseVersionConstraint(constraint).some(orGroup => {
            return orGroup.every(condition => {
                const { operator, version: constraintVersion } = condition;
                try {
                    if (operator === '^') {
                        return semver.satisfies(version, `^${constraintVersion}`);
                    } else if (operator === '~') {
                        return semver.satisfies(version, `~${constraintVersion}`);
                    } else if (operator === '>=') {
                        return semver.gte(version, constraintVersion);
                    } else if (operator === '<=') {
                        return semver.lte(version, constraintVersion);
                    } else if (operator === '>') {
                        return semver.gt(version, constraintVersion);
                    } else if (operator === '<') {
                        return semver.lt(version, constraintVersion);
                    } else if (operator === '=') {
                        return semver.eq(version, constraintVersion);
                    } else if (operator === '!=') {
                        return !semver.eq(version, constraintVersion);
                    }
                    return false;
                } catch (e) {
                    return false;
                }
            });
        });
    }

    const processDependencyData = (dependency, versionConstraint, latestVersion, versions, text, document, decorations) => {
        latestVersion = latestVersion.replace(/v/, '');

        const latestSatisfies = satisfiesConstraint(latestVersion, versionConstraint);
        const validVersion = versions.some(version => satisfiesConstraint(version.replace(/v/, ''), versionConstraint));
        const statusText = getDecorationText(validVersion, latestSatisfies, latestVersion);

        const escapedConstraint = versionConstraint.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
        const regex = new RegExp(`"${dependency}"\\s*:\\s*"${escapedConstraint}"(?:\\s*,)?`);
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
    };

    const processDependencyError = (dependency, versionConstraint) => {
        const escapedConstraint = versionConstraint.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
        const regex = new RegExp(`"${dependency}"\\s*:\\s*"${escapedConstraint}"(?:\\s*,)?`);
        const match = regex.exec(text);

        if (match) {
            const startPos = document.positionAt(match.index);
            const endPos = document.positionAt(match.index + match[0].length);
            const decoration = {
                range: new vscode.Range(startPos, endPos),
                renderOptions: {
                    after: { contentText: problemIcon }
                }
            };
            decorations.push(decoration);
        }
    };

    const dependencyChecks = Object.keys(dependencies).map(dependency => {
        return new Promise((resolve) => {
            if (dependency === "php" || dependency.startsWith("ext-")) return resolve();

            const versionConstraint = dependencies[dependency];
            if (!versionConstraint) return resolve();

            if (versionCache[2].has(dependency)) {
                const { latestVersion, versions } = versionCache[2].get(dependency);
                processDependencyData(dependency, versionConstraint, latestVersion, versions, text, document, decorations);
                return resolve();
            }

            const url = `https://repo.packagist.org/p2/${dependency}.json`;

            https.get(url, (response) => {
                let data = '';

                response.on('data', chunk => {
                    data += chunk;
                });

                response.on('end', () => {
                    try {
                        const parsedData = JSON.parse(data);
                        const versions = parsedData.packages[dependency].map(pkg => pkg.version);

                        let latestVersion = "";
                        if (phpStable) {
                            const stableVersions = versions.filter(version => {
                                return !/(?:alpha|beta|rc|dev|post|preview|snapshot|canary)/i.test(version);
                            });
                            latestVersion = stableVersions[0] || versions[0];
                        } else {
                            latestVersion = versions[0];
                        }

                        versionCache[2].set(dependency, { latestVersion, versions });
                        processDependencyData(dependency, versionConstraint, latestVersion, versions, text, document, decorations);

                        resolve();
                    } catch (error) {
                        processDependencyError(dependency, versionConstraint);
                        resolve();
                    }
                });
            }).on('error', () => {
                processDependencyError(dependency, versionConstraint);
                resolve();
            });
        });
    });

    await Promise.all(dependencyChecks);
    activeTextEditor.setDecorations(decorationType, decorations);
}

async function checkPythonDependencies(document) {
    if (!display) return;

    if (!displayPython) return;

    const activeTextEditor = vscode.window.activeTextEditor;
    if (!activeTextEditor || activeTextEditor.document !== document) return;

    const text = document.getText();
    const decorations = [];

    const dependencies = {};
    const lines = text.split('\n');

    lines.forEach(line => {
        const match = line.match(/([\w\-]+)(?:==|>=|<=|~=|<)([\d.]+)/);
        if (match) {
            const [, name, version] = match;
            dependencies[name] = version;
        }
    });

    const processDependencyData = (dependency, currentVersion, latestVersion, versions, text, document, decorations) => {
        const validVersion = versions[currentVersion] !== undefined;
        const upToDate = currentVersion === latestVersion;
        const statusText = getDecorationText(validVersion, upToDate, latestVersion);

        const regex = new RegExp(`${dependency}(?:==|>=|<=|~=|<)${currentVersion}`, 'm');
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

    const processDependencyError = (dependency, currentVersion) => {
        const regex = new RegExp(`${dependency}(?:==|>=|<=|~=|<)${currentVersion}`, 'm');
        const match = regex.exec(text);

        if (match) {
            const startPos = document.positionAt(match.index);
            const endPos = document.positionAt(match.index + match[0].length);
            const decoration = {
                range: new vscode.Range(startPos, endPos),
                renderOptions: {
                    after: { contentText: problemIcon }
                }
            };
            decorations.push(decoration);
        }
    }

    const dependencyChecks = Object.keys(dependencies).map(dependency => {
        return new Promise((resolve) => {
            const currentVersion = dependencies[dependency];

            if (!currentVersion) return resolve();

            if (versionCache[3].has(dependency)) {
                const { latestVersion, versions } = versionCache[3].get(dependency);

                processDependencyData(dependency, currentVersion, latestVersion, versions, text, document, decorations);
                return resolve();
            }

            const url = `https://pypi.org/pypi/${dependency}/json`;

            https.get(url, (response) => {
                let data = '';

                response.on('data', chunk => {
                    data += chunk;
                });

                response.on('end', () => {
                    try {
                        const parsedData = JSON.parse(data);
                        const versions = parsedData.releases;

                        let latestVersion = "";
                        if (pythonStable) {
                            const stableVersions = Object.keys(versions).filter(version => {
                                return !/(?:alpha|beta|rc|dev|post|preview|snapshot|canary)/i.test(version);
                            });

                            const sortedVersions = stableVersions.sort((a, b) => {
                                const parseVersion = version => version.split('.').map(num => parseInt(num.replace(/\D/g, ''), 10) || 0);
                                const [aParts, bParts] = [parseVersion(a), parseVersion(b)];

                                for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
                                    const diff = (bParts[i] || 0) - (aParts[i] || 0);
                                    if (diff !== 0) return diff;
                                }

                                return 0;
                            });

                            latestVersion = sortedVersions[0] || Object.keys(versions).pop();
                        } else {
                            latestVersion = Object.keys(versions).pop();
                        }

                        versionCache[3].set(dependency, { latestVersion, versions });
                        processDependencyData(dependency, currentVersion, latestVersion, versions, text, document, decorations);

                        resolve();
                    } catch (error) {
                        processDependencyError(dependency, currentVersion);
                        resolve();
                    }
                });
            }).on('error', () => {
                processDependencyError(dependency, currentVersion);
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
