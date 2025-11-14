const vscode = require('vscode');
const fetch = require('node-fetch');

// --- PROFESSIONAL WELCOME POP-UP ---
// Shows a welcome message on first use with options to add API key, view GitHub, or support on Ko-fi
async function showWelcomePopup(context) {
    // 1. Get the current settings
    const configuration = vscode.workspace.getConfiguration('stackOverflowSearch');
    const apiKey = configuration.get('apiKey');

    // 2. If API key is already set, no need to show welcome popup
    if (apiKey) {
        return;
    }

    // 3. Check if we've shown this popup before
    const hasShownWelcome = context.globalState.get('hasShownApiKeyWelcome');
    if (hasShownWelcome) {
        return;
    }

    // 4. Show professional welcome popup with options
    const addKeyButton = '🔑 Add API Key';
    const learnMoreButton = '📖 Learn More';
    const viewOnGitHubButton = '⭐ View on GitHub';
    const supportButton = '☕ Support Me';

    const selection = await vscode.window.showInformationMessage(
        '👋 Welcome to Stack Overflow Quick Search!\n\nTo get started, you\'ll need a free Stack Exchange API key (10,000 requests/day).',
        { modal: false },
        addKeyButton,
        learnMoreButton,
        viewOnGitHubButton,
        supportButton
    );

    // Mark as shown only after user interacts (so dismissed popup can reappear)
    if (selection) {
        await context.globalState.update('hasShownApiKeyWelcome', true);
    }

    // 5. Handle button selection
    if (selection === addKeyButton) {
        const newKey = await vscode.window.showInputBox({
            prompt: '🔑 Enter your Stack Exchange API Key',
            placeHolder: 'Your API key here (get one at stackapps.com/apps/oauth/register)',
            ignoreFocusOut: true,
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'API key cannot be empty';
                }
                if (value.trim().length < 10) {
                    return 'API key seems too short. Please check and try again.';
                }
                return null;
            }
        });

        if (newKey && newKey.trim()) {
            await configuration.update('apiKey', newKey.trim(), vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage('✅ API Key saved successfully! You can now search Stack Overflow.');
        }
    } else if (selection === learnMoreButton) {
        // Open the setup instructions in README
        const repoUrl = vscode.Uri.parse('https://github.com/I-Am-Krishn/Stack-Overflow-Quick-Search#-setup-instructions');
        vscode.env.openExternal(repoUrl);
    } else if (selection === viewOnGitHubButton) {
        const repoUrl = vscode.Uri.parse('https://github.com/I-Am-Krishn/Stack-Overflow-Quick-Search');
        vscode.env.openExternal(repoUrl);
    } else if (selection === supportButton) {
        const kofiUrl = vscode.Uri.parse('https://ko-fi.com/iamkrishn');
        vscode.env.openExternal(kofiUrl);
    }
}
// --- END OF WELCOME POP-UP ---


/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {

    // --- RUN THE NEW POP-UP LOGIC ---
    // Run this check when the extension starts.
    // We run it *without* waiting so it doesn't slow down VS Code's startup.
    showWelcomePopup(context);
    // ---

    let disposable = vscode.commands.registerCommand('stackOverflowSearch.search', async function () {
        
        // 1. Get the user's selected text
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showInformationMessage('No editor is active.');
            return;
        }
        
        // Trim and sanitize the selection
        const rawSelection = editor.document.getText(editor.selection);
        const selection = rawSelection.trim();
        
        if (!selection) {
            vscode.window.showInformationMessage('Please select some text to search.');
            return;
        }

        // 2. Get the API key from the user's settings
        const configuration = vscode.workspace.getConfiguration('stackOverflowSearch');
        const apiKey = configuration.get('apiKey');

        // 3. Check if the key is missing
        if (!apiKey) {
            const action = await vscode.window.showErrorMessage(
                'Stack Overflow API Key is required. Please add your free API key to continue.',
                'Add API Key',
                'Open Settings',
                'Learn More'
            );
            
            if (action === 'Add API Key') {
                const newKey = await vscode.window.showInputBox({
                    prompt: '🔑 Enter your Stack Exchange API Key',
                    placeHolder: 'Your API key here (get one at stackapps.com/apps/oauth/register)',
                    ignoreFocusOut: true
                });
                if (newKey && newKey.trim()) {
                    await configuration.update('apiKey', newKey.trim(), vscode.ConfigurationTarget.Global);
                    vscode.window.showInformationMessage('✅ API Key saved! Please try searching again.');
                }
            } else if (action === 'Open Settings') {
                vscode.commands.executeCommand('workbench.action.openSettings', 'stackOverflowSearch.apiKey');
            } else if (action === 'Learn More') {
                vscode.env.openExternal(vscode.Uri.parse('https://github.com/I-Am-Krishn/Stack-Overflow-Quick-Search#-setup-instructions'));
            }
            return;
        }

        // 4. Create a Webview Panel to show the results
        const shortTitle = selection.substring(0, 30);
        const panelTitle = selection.length > 30 ? `${shortTitle}...` : shortTitle;
        
        const panel = vscode.window.createWebviewPanel(
            'stackOverflowResults',
            `SO: ${panelTitle}`,
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                enableFindWidget: true,
                retainContextWhenHidden: true
            }
        );

        panel.webview.html = getLoadingView();

        try {
            // 5. Build the API URL and fetch results
            const searchParams = new URLSearchParams({
                q: selection,
                site: 'stackoverflow',
                key: apiKey,
                pagesize: 10,
                order: 'desc',
                sort: 'relevance'
            });
            const apiUrl = `https://api.stackexchange.com/2.3/search/advanced?${searchParams.toString()}`;

            const response = await fetch(apiUrl);
            
            // Check for HTTP errors
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();

            // 6. Check for API errors
            if (data.error_message) {
                panel.webview.html = getErrorView(`API Error: ${data.error_message}. Please check your API key.`);
                return;
            }

            if (!data.items || data.items.length === 0) {
                panel.webview.html = getErrorView(`No results found for "${selection}"`);
                return;
            }

            // 7. Build and display results
            panel.webview.html = getResultsView(data.items, selection);

        } catch (error) {
            panel.webview.html = getErrorView(`Failed to fetch results: ${error.message}`);
        }
    });

    context.subscriptions.push(disposable);
}

// Utility function to escape HTML and prevent XSS attacks
function escapeHtml(text) {
    if (text === null || text === undefined) {
        return '';
    }
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return String(text).replace(/[&<>"']/g, (m) => map[m]);
}

// This function builds the HTML for the results page
function getResultsView(items, query) {
    const questionsHtml = items.map(item => {
        // Escape all user-generated content to prevent XSS
        const safeTitle = escapeHtml(item.title);
        const safeLink = escapeHtml(item.link);
        const safeScore = escapeHtml(item.score);
        const safeAnswerCount = escapeHtml(item.answer_count);
        const safeViewCount = escapeHtml(item.view_count);
        
        // Check if tags exist and escape them
        const tagsHtml = item.tags 
            ? item.tags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('') 
            : '';
        
        // Determine answer status class
        const answerClass = item.is_answered ? 'answered' : 'unanswered';
        
        return `
            <div class="question">
                <div class="stats">
                    <div class="stat"><strong>${safeScore}</strong> votes</div>
                    <div class="stat ${answerClass}"><strong>${safeAnswerCount}</strong> answers</div>
                    <div class="stat"><strong>${safeViewCount}</strong> views</div>
                </div>
                <div class="summary">
                    <h3><a href="${safeLink}" target="_blank" rel="noopener noreferrer">${safeTitle}</a></h3>
                    <div class="tags">${tagsHtml}</div>
                </div>
            </div>
        `;
    }).join('');

    const safeQuery = escapeHtml(query);

    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src https: data:;">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Stack Overflow Results</title>
            <style>
                body { 
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; 
                    padding: 20px; 
                    color: var(--vscode-foreground);
                    background: var(--vscode-editor-background);
                    line-height: 1.6;
                }
                h1 { 
                    color: var(--vscode-editor-foreground); 
                    border-bottom: 2px solid var(--vscode-textSeparator-foreground);
                    padding-bottom: 10px;
                    margin-bottom: 20px;
                }
                .search-info {
                    color: var(--vscode-descriptionForeground);
                    margin-bottom: 20px;
                    font-size: 0.95em;
                }
                .question { 
                    display: flex; 
                    border-bottom: 1px solid var(--vscode-panel-border); 
                    padding: 15px 0; 
                    transition: background-color 0.2s;
                }
                .question:hover {
                    background-color: var(--vscode-list-hoverBackground);
                    border-radius: 4px;
                    padding-left: 10px;
                    margin-left: -10px;
                    margin-right: -10px;
                    padding-right: 10px;
                }
                .stats { 
                    flex: 0 0 110px; 
                    text-align: right; 
                    padding-right: 20px; 
                    font-size: 0.9em; 
                    color: var(--vscode-descriptionForeground);
                }
                .stat { 
                    margin-bottom: 8px; 
                }
                .stat strong { 
                    color: var(--vscode-foreground); 
                    font-size: 1.3em; 
                    display: block; 
                }
                .stat.answered strong {
                    color: var(--vscode-testing-iconPassed);
                }
                .summary { 
                    flex: 1; 
                }
                .summary h3 { 
                    margin-top: 0; 
                    margin-bottom: 10px; 
                    font-weight: 500;
                }
                .summary h3 a { 
                    text-decoration: none; 
                    font-size: 1.15em; 
                    color: var(--vscode-textLink-foreground);
                }
                .summary h3 a:hover {
                    color: var(--vscode-textLink-activeForeground);
                    text-decoration: underline;
                }
                .tags { 
                    display: flex; 
                    flex-wrap: wrap; 
                    gap: 6px; 
                    margin-top: 8px;
                }
                .tag { 
                    background-color: var(--vscode-badge-background); 
                    color: var(--vscode-badge-foreground);
                    padding: 4px 8px; 
                    border-radius: 3px; 
                    font-size: 0.85em; 
                    font-weight: 500;
                }
                .footer {
                    margin-top: 30px;
                    padding-top: 20px;
                    border-top: 1px solid var(--vscode-panel-border);
                    text-align: center;
                    color: var(--vscode-descriptionForeground);
                    font-size: 0.9em;
                }
                .footer a {
                    color: var(--vscode-textLink-foreground);
                    text-decoration: none;
                }
                .footer a:hover {
                    text-decoration: underline;
                }
            </style>
        </head>
        <body>
            <h1>🔍 Stack Overflow Results</h1>
            <div class="search-info">Showing top ${items.length} results for: <strong>"${safeQuery}"</strong></div>
            ${questionsHtml}
            <div class="footer">
                Made with ❤️ by <a href="https://github.com/I-Am-Krishn" target="_blank" rel="noopener noreferrer">Krishn Dhola</a>
                 | <a href="https://ko-fi.com/iamkrishn" target="_blank" rel="noopener noreferrer">☕ Support Me</a>
            </div>
        </body>
        </html>
    `;
}

// HTML for the loading screen
function getLoadingView() {
    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Loading...</title>
            <style>
                body { 
                    display: flex; 
                    flex-direction: column;
                    justify-content: center; 
                    align-items: center; 
                    height: 100vh; 
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                    background: var(--vscode-editor-background);
                    color: var(--vscode-foreground);
                }
                .loader { 
                    border: 4px solid var(--vscode-progressBar-background); 
                    border-top: 4px solid var(--vscode-progressBar-foreground); 
                    border-radius: 50%; 
                    width: 50px; 
                    height: 50px; 
                    animation: spin 1s linear infinite; 
                }
                @keyframes spin { 
                    0% { transform: rotate(0deg); } 
                    100% { transform: rotate(360deg); } 
                }
                .loading-text {
                    margin-top: 20px;
                    color: var(--vscode-descriptionForeground);
                }
            </style>
        </head>
        <body>
            <div class="loader"></div>
            <div class="loading-text">Searching Stack Overflow...</div>
        </body>
        </html>
    `;
}

// HTML for showing an error message
function getErrorView(message) {
    const safeMessage = escapeHtml(message);
    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Error</title>
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                    padding: 40px;
                    background: var(--vscode-editor-background);
                    color: var(--vscode-foreground);
                }
                .error-container {
                    max-width: 600px;
                    margin: 0 auto;
                }
                h1 {
                    color: var(--vscode-errorForeground);
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }
                .error-icon {
                    font-size: 2em;
                }
                p {
                    background: var(--vscode-inputValidation-errorBackground);
                    border: 1px solid var(--vscode-inputValidation-errorBorder);
                    padding: 15px;
                    border-radius: 4px;
                    line-height: 1.6;
                }
                .help-text {
                    margin-top: 20px;
                    padding: 15px;
                    background: var(--vscode-textBlockQuote-background);
                    border-left: 4px solid var(--vscode-textLink-foreground);
                    color: var(--vscode-descriptionForeground);
                }
            </style>
        </head>
        <body>
            <div class="error-container">
                <h1><span class="error-icon">⚠️</span> Error</h1>
                <p>${safeMessage}</p>
                <div class="help-text">
                    <strong>Need Help?</strong><br>
                    • Check your API key in VS Code settings<br>
                    • Make sure you have an active internet connection<br>
                    • Visit the GitHub repo for support
                </div>
            </div>
        </body>
        </html>
    `;
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
}