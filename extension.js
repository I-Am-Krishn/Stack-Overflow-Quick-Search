const vscode = require('vscode');
const fetch = require('node-fetch');

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {

    let disposable = vscode.commands.registerCommand('stackOverflowSearch.search', async function () {
        
        // 1. Get the user's selected text
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showInformationMessage('No editor is active.');
            return;
        }
        const selection = editor.document.getText(editor.selection);
        if (!selection) {
            vscode.window.showInformationMessage('Please select some text to search.');
            return;
        }

        // 2. Get the API key from the user's settings
        // THIS IS THE FIX: We are now looking for 'apiKey' (singular), which matches your package.json
        const configuration = vscode.workspace.getConfiguration('stackOverflowSearch');
        const apiKey = configuration.get('apiKey'); // Was 'apiKeys'

        // 3. Check if the key is missing
        if (!apiKey) {
            vscode.window.showErrorMessage(
                'Please set your Stack Overflow API Key in the settings. (Search for "stackOverflowSearch.apiKey")',
                'Open Settings'
            ).then(selection => {
                if (selection === 'Open Settings') {
                    vscode.commands.executeCommand('workbench.action.openSettings', 'stackOverflowSearch.apiKey');
                }
            });
            return;
        }

        // 4. Create a Webview Panel to show the results
        const panel = vscode.window.createWebviewPanel(
            'stackOverflowResults', // Internal ID
            `Stack Overflow: ${selection.substring(0, 20)}...`, // Title
            vscode.ViewColumn.Beside, // Show in a new column
            {
                enableScripts: true // Allow scripts for styling, etc.
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
                sort: 'relevance',
                filter: 'withbody' // A filter that includes question body
            });
            const apiUrl = `https://api.stackexchange.com/2.3/search/advanced?${searchParams.toString()}`;

            const response = await fetch(apiUrl);
            const data = await response.json();

            // 6. Check for API errors (like bad key or rate limit)
            if (data.error_message) {
                panel.webview.html = getErrorView(`API Error: ${data.error_message}. Please check your API key.`);
                return;
            }

            if (!data.items || data.items.length === 0) {
                panel.webview.html = getErrorView(`No results found for "${selection}"`);
                return;
            }

            // 7. Build the HTML for the results and show it
            panel.webview.html = getResultsView(data.items);

        } catch (error) {
            panel.webview.html = getErrorView(`Failed to fetch results: ${error.message}`);
        }
    });

    context.subscriptions.push(disposable);
}

// This function builds the HTML for the results page
function getResultsView(items) {
    const questionsHtml = items.map(item => {
        const tagsHtml = item.tags.map(tag => `<span class="tag">${tag}</span>`).join('');
        return `
            <div class="question">
                <div class="stats">
                    <div class="stat"><strong>${item.score}</strong> votes</div>
                    <div class="stat"><strong>${item.answer_count}</strong> answers</div>
                    <div class="stat"><strong>${item.view_count}</strong> views</div>
                </div>
                <div class="summary">
                    <h3><a href="${item.link}">${item.title}</a></h3>
                    <div class="tags">${tagsHtml}</div>
                </div>
            </div>
        `;
    }).join('');

    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Stack Overflow Results</title>
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; padding: 15px; }
                .question { display: flex; border-bottom: 1px solid #333; padding: 15px 0; }
                .stats { flex: 0 0 100px; text-align: right; padding-right: 15px; font-size: 0.9em; color: #888; }
                .stat { margin-bottom: 8px; }
                .stat strong { color: #ccc; font-size: 1.2em; display: block; }
                .summary h3 { margin-top: 0; margin-bottom: 10px; }
                .summary h3 a { text-decoration: none; font-size: 1.2em; }
                .tags { display: flex; flex-wrap: wrap; gap: 5px; }
                .tag { background-color: #3e3e3e; padding: 3px 7px; border-radius: 4px; font-size: 0.85em; }
                a { color: #3794ff; }
            </style>
        </head>
        <body>
            <h1>Stack Overflow Results</h1>
            ${questionsHtml}
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
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Loading...</title>
            <style>
                body { display: flex; justify-content: center; align-items: center; height: 100vh; font-family: sans-serif; }
                .loader { border: 5px solid #f3f3f3; border-top: 5px solid #3498db; border-radius: 50%; width: 50px; height: 50px; animation: spin 1s linear infinite; }
                @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
            </style>
        </head>
        <body>
            <div class="loader"></div>
        </body>
        </html>
    `;
}

// HTML for showing an error message
function getErrorView(message) {
    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Error</title>
        </head>
        <body>
            <h1 style="color: #ff5555;">An Error Occurred</h1>
            <p>${message}</p>
        </body>
        </html>
    `;
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
}