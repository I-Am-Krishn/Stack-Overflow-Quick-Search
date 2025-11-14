// This is the "brain" of your extension.
// It imports the VS Code API and the 'node-fetch' library for making web requests.
const vscode = require('vscode');
const fetch = require('node-fetch');

// This holds the index of the last API key we used.
// This is how we "rotate" the keys.
let currentKeyIndex = 0;

/**
 * Gets the next API key from the user's settings.
 * This is the rotation logic you wanted.
 * @returns {string | undefined} An API key, or undefined if none are set.
 */
function getApiKey() {
  // 1. Get the configuration from the user's settings.json
  const config = vscode.workspace.getConfiguration('stackOverflowSearch');
  
  // 2. Get the array of keys. If it's not there, use an empty array.
  const keys = config.get('apiKeys', []);

  // 3. Check if the user has added any keys.
  if (keys.length === 0) {
    // If not, show an error and stop.
    vscode.window.showErrorMessage(
      'No Stack Overflow API keys found. Please add them in Settings > Extensions > Stack Overflow Search.'
    );
    return undefined;
  }

  // 4. Get the key at the current index
  const key = keys[currentKeyIndex];
  
  // 5. Move the index to the next key, and "wrap around" to 0 if we're at the end.
  currentKeyIndex = (currentKeyIndex + 1) % keys.length;
  
  return key;
}

/**
 * This is the main function of your extension.
 * It's called when the extension is first activated.
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  // Register the command that was defined in package.json
  let disposable = vscode.commands.registerCommand('stackOverflowSearch.search', async () => {
    
    // 1. Get the current active text editor
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return; // No editor is open.
    }

    // 2. Get the text the user has highlighted
    const selection = editor.selection;
    const query = editor.document.getText(selection);

    if (!query) {
      vscode.window.showInformationMessage('No text selected.');
      return;
    }

    // 3. Get an API key using the rotation logic
    const apiKey = getApiKey();
    if (!apiKey) {
      return; // The getApiKey function already showed an error.
    }

    // Let the user know we are searching
    vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: "Searching Stack Overflow...",
      cancellable: false
    }, async (progress) => {
      
      try {
        // 4. Build the API URL
        const apiQuery = encodeURIComponent(query);
        const url = `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${apiQuery}&site=stackoverflow&key=${apiKey}&filter=default`;

        // 5. Call the API
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`API Error: ${response.statusText}`);
        }
        const data = await response.json();

        // 6. Create the results panel
        const panel = vscode.window.createWebviewPanel(
          'stackOverflowResults', // Internal ID
          `Stack Overflow: ${query}`, // Title in the tab
          vscode.ViewColumn.Beside, // Show it in a new tab to the side
          {} // Options
        );

        // 7. Show the results
        if (data.items && data.items.length > 0) {
          panel.webview.html = getWebviewContent(data.items);
        } else {
          panel.webview.html = `<h1>No results found for "${query}"</h1>`;
        }

      } catch (error) {
        console.error(error);
        vscode.window.showErrorMessage(`Failed to search Stack Overflow: ${error.message}`);
      }
    });
  });

  context.subscriptions.push(disposable);
}

/**
 * Creates the HTML content to show in the results panel.
 * @param {Array<Object>} items - The list of questions from the API.
 * @returns {string} The HTML string.
 */
function getWebviewContent(items) {
  // We will just show the top 5 results
  const topItems = items.slice(0, 5);

  const listItems = topItems
    .map(item => `
      <div class="question">
        <a href="${item.link}" target="_blank" class="title">${item.title}</a>
        <div class="stats">
          <span>${item.score} Votes</span> | 
          <span>${item.answer_count} Answers</span> | 
          <span>${item.view_count} Views</span>
        </div>
      </div>
    `)
    .join('');

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Stack Overflow Results</title>
      <style>
        body { padding: 20px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
        .question { margin-bottom: 25px; border-bottom: 1px solid #333; padding-bottom: 15px; }
        .title { display: block; font-size: 1.2em; text-decoration: none; font-weight: bold; margin-bottom: 8px; }
        .stats { font-size: 0.9em; color: #888; }
      </style>
    </head>
    <body>
      <h1>Search Results</h1>
      ${listItems}
    </body>
    </html>
  `;
}

// This function is called when your extension is deactivated
function deactivate() {}

module.exports = {
  activate,
  deactivate
};